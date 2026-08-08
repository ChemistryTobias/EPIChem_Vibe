"""Descriptor <-> registry-row translation and YAML import (ADR 0004 §3).
This is the shared write path for turning a `Descriptor` into the `values`
dict `epichem.registry.create_entity`/`update_entity` expect — the same
translation `api/routers/topology.py` and `api/routers/devices.py` use for
HTTP writes, so both the API and this module's `import_*` functions call
these functions rather than each maintaining their own copy.

Import is an upsert: try `create_entity`; if it raises `ValueError` (natural-
key conflict), resolve the existing row and call `update_entity` instead
(`_upsert` below). This makes importing the same file twice a no-op the
second time, without the caller needing to know in advance whether the row
exists yet.

`import_directory` upserts in dependency order (CapabilityClass, then topology
in Site->Lab->Zone->Station order, ADR 0007, then Device) with partial-failure
isolation: one descriptor failing to resolve is reported as an "error" item for
that descriptor only and never blocks the rest of the batch. A Device whose
`parent` points at another device in the *same* import batch is not
cascade-resolved across passes — it must already exist in the registry (imported
earlier, or ordered first by file path). Deliberate scope cut: ADR 0004 hands
bulk import a fixed dependency order, not the retired reconciler's fixed-point
cascade for intra-batch Device parents, and no current descriptor set exercises
device-to-device parenting.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.schemas import (
    CapabilityClassOut,
    DeviceOut,
    LabOut,
    SiteOut,
    StationOut,
    ZoneOut,
)
from epichem.descriptors.loader import DescriptorError, load_descriptors
from epichem.models import CapabilityClass, Device, Lab, Site, Station, Zone
from epichem.registry import (
    create_entity,
    resolve_device_references,
    update_entity,
)
from epichem.schemas.descriptor import Descriptor

Action = str  # "created" | "updated" | "unchanged" | "error"


@dataclass
class ImportItem:
    kind: str
    code: str
    action: Action
    detail: str = ""


@dataclass
class ImportReport:
    items: list[ImportItem] = field(default_factory=list)
    loader_errors: list[DescriptorError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.loader_errors and not any(i.action == "error" for i in self.items)


# ---- topology (Site -> Lab -> Zone -> Station, ADR 0007) -------------------


class TopologyKind(NamedTuple):
    """One row of the table below.

    A NamedTuple rather than a plain tuple because four modules unpack these
    (this one, the exporter, the topology router, and the route-registration
    loop) and `entry.parent_field` survives a reader's short-term memory in a
    way that `entry[4]` does not.
    """

    kind: str
    plural: str  # HTTP path segment
    model: type
    out_schema: type
    #: Name of the spec field naming this kind's required parent, or None for
    #: Site. The parent FK column is always f"{parent_field}_id", and the ORM
    #: relationship attribute on the child is always `parent_field` itself
    #: (Lab.site, Zone.lab, Station.lab), which the exporter relies on too.
    parent_field: str | None
    parent_model: type | None
    #: Attrs copied 1:1 from spec to ORM column.
    attrs: list[str]
    #: Optional cross-references, resolved like the parent but nullable — used
    #: by Station's optional `zone` (ADR 0007: a station may sit in a zone).
    #: Each is (spec_field, model); the FK column and relationship attr are
    #: f"{spec_field}_id" and `spec_field`, same convention as the parent.
    optional_refs: list[tuple[str, type]] = []


TOPOLOGY_WRITE = [
    TopologyKind(
        "Site",
        "sites",
        Site,
        SiteOut,
        None,
        None,
        ["address", "timezone", "width_m", "depth_m", "grid_size_m", "floors"],
    ),
    TopologyKind(
        "Lab",
        "labs",
        Lab,
        LabOut,
        "site",
        Site,
        [
            "room_number",
            "environment_class",
            "access_control_group",
            "width_m",
            "depth_m",
            "grid_size_m",
            "site_pos_x",
            "site_pos_y",
            "site_size_x_m",
            "site_size_y_m",
            "floor",
        ],
    ),
    TopologyKind(
        "Zone",
        "zones",
        Zone,
        ZoneOut,
        "lab",
        Lab,
        ["atmosphere", "pressure", "temperature_class", "hazard_class", "occupancy"],
    ),
    TopologyKind(
        "Station",
        "stations",
        Station,
        StationOut,
        "lab",
        Lab,
        [
            "kind",
            "pos_x",
            "pos_y",
            "size_x_m",
            "size_y_m",
            "height_m",
            "capacity",
            "accepted_labware_types",
            "queueserver_endpoint",
            "redis_namespace",
            "state",
            "owning_group",
            "virtual",
        ],
        [("zone", Zone)],
    ),
]

#: Public so the exporter uses this one instead of rebuilding its own copy.
TOPOLOGY_BY_KIND = {entry.kind: entry for entry in TOPOLOGY_WRITE}


def resolve_parent_id(
    session: Session, parent_model: type, parent_field: str, parent_code: str
) -> uuid.UUID:
    """Raises ValueError if `parent_code` doesn't resolve against
    `parent_model`. HTTP callers turn that into a 422; CLI/import callers
    report it as an "error" item for the one descriptor involved.
    """
    parent_id = session.execute(
        select(parent_model.id).where(parent_model.code == parent_code)
    ).scalar_one_or_none()
    if parent_id is None:
        raise ValueError(f"{parent_field} {parent_code!r} not found")
    return parent_id


def resolve_topology_values(entry: TopologyKind, descriptor: Descriptor, session: Session) -> dict:
    """Descriptor -> the `values` dict create_entity/update_entity take.
    Raises ValueError if the required parent or an optional ref that *was*
    given doesn't resolve.
    """
    spec = descriptor.typed_spec()
    values: dict[str, Any] = {"code": descriptor.metadata.code, "name": descriptor.metadata.name}
    for attr in entry.attrs:
        values[attr] = getattr(spec, attr)
    if entry.parent_field:
        parent_code = getattr(spec, entry.parent_field)
        values[f"{entry.parent_field}_id"] = resolve_parent_id(
            session, entry.parent_model, entry.parent_field, parent_code
        )
    for ref_field, ref_model in entry.optional_refs:
        ref_code = getattr(spec, ref_field)
        values[f"{ref_field}_id"] = (
            resolve_parent_id(session, ref_model, ref_field, ref_code) if ref_code else None
        )
    return values


# ---- CapabilityClass ---------------------------------------------------------


def capability_class_values(descriptor: Descriptor, spec) -> dict:
    return {
        "name": descriptor.metadata.name,
        "iri": descriptor.metadata.iri,
        "extends": spec.extends,
        "actions": {name: action.model_dump(mode="json") for name, action in spec.actions.items()},
    }


# ---- Device -------------------------------------------------------------------


def device_values(descriptor: Descriptor, spec, refs: dict) -> dict:
    ophyd_import = spec.ophyd.import_ if spec.ophyd else None
    ophyd_args = spec.ophyd.args if spec.ophyd else {}
    transport = spec.transport  # None for a passive module (ADR 0007)
    pose = spec.location.pose
    footprint = spec.location.footprint
    calibration = spec.operational.calibration
    return {
        "code": descriptor.metadata.code,
        "name": descriptor.metadata.name,
        "node_kind": spec.node_kind,
        "labels": descriptor.metadata.labels,
        "station_id": refs["station_id"],
        "parent_id": refs["parent_id"],
        "capability_class_ref": spec.class_,
        "capability_class_id": refs["capability_class_id"],
        "capabilities": spec.capabilities,
        "ophyd_import": ophyd_import,
        "ophyd_args": ophyd_args,
        "transport_protocol": transport.protocol if transport else None,
        "transport_uri": transport.uri if transport else None,
        "transport_ioc_host": transport.ioc_host if transport else None,
        "transport_quality": transport.quality if transport else "nominal",
        "network_netbox_device_id": spec.network.netbox_device_id,
        "network_primary_ip": spec.network.primary_ip,
        "network_mac": spec.network.mac,
        "network_vlan": spec.network.vlan,
        "pose_x_mm": pose.x_mm if pose else None,
        "pose_y_mm": pose.y_mm if pose else None,
        "pose_z_mm": pose.z_mm if pose else None,
        "pose_yaw_deg": pose.yaw_deg if pose else None,
        "size_x_mm": footprint.size_x_mm if footprint else None,
        "size_y_mm": footprint.size_y_mm if footprint else None,
        "size_z_mm": footprint.size_z_mm if footprint else None,
        "envelope": {k: v.model_dump(mode="json") for k, v in spec.envelope.items()},
        "safety_flags": spec.safety.flags,
        "safety_interlocks": spec.safety.interlocks,
        "safety_max_unattended_minutes": spec.safety.max_unattended_minutes,
        "operational_mode": spec.operational.mode,
        "operational_calibration": calibration.model_dump(mode="json") if calibration else None,
        "virtual": spec.virtual,
    }


def inherit_station_from_parent(session: Session, refs: dict) -> None:
    """A node without its own `location.station` but nested under a parent
    inherits the parent's station (ADR 0007: a module and its devices belong to
    the same station). Mutates `refs` in place.
    """
    if refs["station_id"] is None and refs["parent_id"] is not None:
        refs["station_id"] = session.execute(
            select(Device.station_id).where(Device.id == refs["parent_id"])
        ).scalar_one_or_none()


# ---- generic upsert ------------------------------------------------------


def _upsert(
    session: Session,
    model_cls: type,
    entity_type: str,
    out_schema: type,
    key_attr: str,
    values: dict,
):
    """Try create_entity; on a natural-key conflict, resolve the existing
    row and update_entity instead. Returns (obj, Revision | None, action).
    """
    try:
        obj, revision = create_entity(session, model_cls, entity_type, out_schema, values)
        return obj, revision, "created"
    except ValueError:
        obj = session.execute(
            select(model_cls).where(getattr(model_cls, key_attr) == values[key_attr])
        ).scalar_one_or_none()
        if obj is None:
            raise
        revision = update_entity(session, obj, entity_type, out_schema, values)
        return obj, revision, ("updated" if revision is not None else "unchanged")


def _apply_topology(session: Session, descriptor: Descriptor, entry: TopologyKind) -> ImportItem:
    code = descriptor.metadata.code
    try:
        values = resolve_topology_values(entry, descriptor, session)
    except ValueError as e:
        return ImportItem(entry.kind, code, "error", str(e))
    _obj, _revision, action = _upsert(
        session, entry.model, entry.kind, entry.out_schema, "code", values
    )
    return ImportItem(entry.kind, code, action)


def _apply_capability_class(session: Session, descriptor: Descriptor) -> ImportItem:
    code = descriptor.metadata.code
    spec = descriptor.typed_spec()
    values = capability_class_values(descriptor, spec)
    _obj, _revision, action = _upsert(
        session, CapabilityClass, "CapabilityClass", CapabilityClassOut, "name", values
    )
    return ImportItem("CapabilityClass", code, action)


def _apply_device(session: Session, descriptor: Descriptor) -> ImportItem:
    code = descriptor.metadata.code
    spec = descriptor.typed_spec()
    try:
        refs = resolve_device_references(
            session, spec.class_, spec.capabilities, spec.location.station, spec.parent
        )
    except ValueError as e:
        return ImportItem("Device", code, "error", str(e))

    inherit_station_from_parent(session, refs)
    values = device_values(descriptor, spec, refs)
    _obj, _revision, action = _upsert(session, Device, "Device", DeviceOut, "code", values)
    return ImportItem("Device", code, action)


def import_descriptor(session: Session, descriptor: Descriptor) -> ImportItem:
    """Apply a single already-parsed Descriptor. Used by both the bulk
    directory import below and the CLI's per-kind `import` subcommands.
    """
    if descriptor.kind == "CapabilityClass":
        item = _apply_capability_class(session, descriptor)
    elif descriptor.kind == "Device":
        item = _apply_device(session, descriptor)
    else:
        item = _apply_topology(session, descriptor, TOPOLOGY_BY_KIND[descriptor.kind])
    session.flush()
    return item


def import_file(session: Session, path: Path | str) -> ImportItem:
    path = Path(path)
    raw = yaml.safe_load(path.read_text())
    descriptor = Descriptor.model_validate(raw)
    descriptor.typed_spec()
    return import_descriptor(session, descriptor)


def import_directory(session: Session, directory: Path | str) -> ImportReport:
    result = load_descriptors(directory)
    items: list[ImportItem] = []

    for d in result.descriptors:
        if d.kind == "CapabilityClass":
            items.append(_apply_capability_class(session, d))
    session.flush()

    for entry in TOPOLOGY_WRITE:
        for d in result.descriptors:
            if d.kind == entry.kind:
                items.append(_apply_topology(session, d, entry))
        session.flush()

    for d in result.descriptors:
        if d.kind == "Device":
            items.append(_apply_device(session, d))
    session.flush()

    return ImportReport(items=items, loader_errors=result.errors)
