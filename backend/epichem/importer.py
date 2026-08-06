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

`import_directory` mirrors the retired `reconciler.py`'s upsert order
(CapabilityClass, then topology in Site->Lab->Zone->Workcell->Bench->Station
order, then Device) and its partial-failure isolation: one descriptor
failing to resolve is reported as an "error" item for that descriptor only
and never blocks the rest of the batch. Unlike the old reconciler, a Device
whose `parent` points at another device in the *same* import batch is not
cascade-resolved across multiple passes — it must already exist in the
registry (e.g. imported in an earlier run, or appear first when sorted by
file path). This is a deliberate scope cut: ADR 0004 hands bulk import the
CapabilityClass/topology/Device dependency order, not the reconciler's
fixed-point batch cascade for intra-batch Device parents, and no current
descriptor set exercises device-to-device parenting.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.schemas import (
    BenchOut,
    CapabilityClassOut,
    DeviceOut,
    LabOut,
    SiteOut,
    StationOut,
    WorkcellOut,
    ZoneOut,
)
from epichem.descriptors.loader import DescriptorError, load_descriptors
from epichem.models import (
    Bench,
    CapabilityClass,
    Device,
    Lab,
    Site,
    Station,
    StationDeviceBinding,
    Workcell,
    Zone,
)
from epichem.registry import (
    create_entity,
    record_revision,
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


# ---- topology (Site -> Lab -> Zone -> Workcell -> Bench -> Station) --------

# (kind, plural [HTTP path segment], model_cls, Out schema, parent spec field
# name / None, parent model / None, plain attrs copied 1:1 from spec to ORM
# column). The parent FK column is always f"{field}_id"; the parent
# relationship attribute on the child ORM model is always named
# f"{field}" (Lab.site, Zone.lab, ...), which the exporter relies on too.
TOPOLOGY_WRITE = [
    ("Site", "sites", Site, SiteOut, None, None, ["address", "timezone"]),
    (
        "Lab",
        "labs",
        Lab,
        LabOut,
        "site",
        Site,
        ["room_number", "environment_class", "access_control_group"],
    ),
    (
        "Zone",
        "zones",
        Zone,
        ZoneOut,
        "lab",
        Lab,
        ["atmosphere", "pressure", "temperature_class", "hazard_class"],
    ),
    (
        "Workcell",
        "workcells",
        Workcell,
        WorkcellOut,
        "zone",
        Zone,
        ["queueserver_endpoint", "redis_namespace", "state", "owning_group"],
    ),
    (
        "Bench",
        "benches",
        Bench,
        BenchOut,
        "workcell",
        Workcell,
        ["grid_cols", "grid_rows", "height_mm"],
    ),
    (
        "Station",
        "stations",
        Station,
        StationOut,
        "bench",
        Bench,
        ["kind", "grid_col", "grid_row", "stack_height", "capacity", "accepted_labware_types"],
    ),
]

_TOPOLOGY_BY_KIND = {entry[0]: entry for entry in TOPOLOGY_WRITE}


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


def resolve_topology_values(
    kind: str,
    parent_field: str | None,
    parent_model: type | None,
    attrs: list[str],
    descriptor: Descriptor,
    session: Session,
) -> dict:
    spec = descriptor.typed_spec()
    values: dict[str, Any] = {"code": descriptor.metadata.code, "name": descriptor.metadata.name}
    for attr in attrs:
        values[attr] = getattr(spec, attr)
    if parent_field:
        parent_code = getattr(spec, parent_field)
        values[f"{parent_field}_id"] = resolve_parent_id(
            session, parent_model, parent_field, parent_code
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
    pose = spec.location.pose
    calibration = spec.operational.calibration
    return {
        "code": descriptor.metadata.code,
        "name": descriptor.metadata.name,
        "labels": descriptor.metadata.labels,
        "parent_id": refs["parent_id"],
        "capability_class_ref": spec.class_,
        "capability_class_id": refs["capability_class_id"],
        "capabilities": spec.capabilities,
        "ophyd_import": ophyd_import,
        "ophyd_args": ophyd_args,
        "transport_protocol": spec.transport.protocol,
        "transport_uri": spec.transport.uri,
        "transport_ioc_host": spec.transport.ioc_host,
        "network_netbox_device_id": spec.network.netbox_device_id,
        "network_primary_ip": spec.network.primary_ip,
        "network_mac": spec.network.mac,
        "network_vlan": spec.network.vlan,
        "pose_x_mm": pose.x_mm if pose else None,
        "pose_y_mm": pose.y_mm if pose else None,
        "pose_z_mm": pose.z_mm if pose else None,
        "pose_yaw_deg": pose.yaw_deg if pose else None,
        "envelope": {k: v.model_dump(mode="json") for k, v in spec.envelope.items()},
        "safety_flags": spec.safety.flags,
        "safety_interlocks": spec.safety.interlocks,
        "safety_max_unattended_minutes": spec.safety.max_unattended_minutes,
        "operational_mode": spec.operational.mode,
        "operational_calibration": calibration.model_dump(mode="json") if calibration else None,
    }


def station_codes_by_device(session: Session, device_ids: list[UUID]) -> dict[UUID, str]:
    if not device_ids:
        return {}
    rows = session.execute(
        select(StationDeviceBinding.device_id, Station.code)
        .join(Station, Station.id == StationDeviceBinding.station_id)
        .where(StationDeviceBinding.device_id.in_(device_ids), StationDeviceBinding.role == "owns")
    ).all()
    return dict(rows)


def upsert_station_binding(session: Session, device: Device, station_id: UUID | None) -> bool:
    """Mirrors the retired reconciler's upsert-with-role="owns" pattern: only
    touches the binding when a station was resolved; never deletes it (a
    descriptor that omits `location.station` isn't asserting "no station").
    Returns whether the binding was created or changed, since that's not
    visible in `update_entity`'s own change-detection (station_id isn't a
    Device column).
    """
    if station_id is None:
        return False
    binding = session.execute(
        select(StationDeviceBinding).where(
            StationDeviceBinding.device_id == device.id, StationDeviceBinding.role == "owns"
        )
    ).scalar_one_or_none()
    if binding is None:
        session.add(StationDeviceBinding(station_id=station_id, device_id=device.id, role="owns"))
        return True
    if binding.station_id != station_id:
        binding.station_id = station_id
        return True
    return False


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


def _apply_topology(session: Session, descriptor: Descriptor, entry: tuple) -> ImportItem:
    kind, _plural, model_cls, out_schema, parent_field, parent_model, attrs = entry
    code = descriptor.metadata.code
    try:
        values = resolve_topology_values(
            kind, parent_field, parent_model, attrs, descriptor, session
        )
    except ValueError as e:
        return ImportItem(kind, code, "error", str(e))
    _obj, _revision, action = _upsert(session, model_cls, kind, out_schema, "code", values)
    return ImportItem(kind, code, action)


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

    values = device_values(descriptor, spec, refs)
    obj, revision, action = _upsert(session, Device, "Device", DeviceOut, "code", values)
    binding_changed = upsert_station_binding(session, obj, refs["station_id"])
    session.flush()

    station_code = station_codes_by_device(session, [obj.id]).get(obj.id)
    if revision is not None:
        revision.snapshot = {**revision.snapshot, "station_code": station_code}
    elif binding_changed:
        # No Device column changed, but the station binding did — that's
        # still a real change to the entity's observable state (mirrors
        # api/routers/devices.py's replace_device handling of the same gap).
        snapshot = {
            **DeviceOut.model_validate(obj).model_dump(mode="json"),
            "station_code": station_code,
        }
        record_revision(session, "Device", obj.id, "updated", snapshot)
        action = "updated"

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
        item = _apply_topology(session, descriptor, _TOPOLOGY_BY_KIND[descriptor.kind])
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
        kind = entry[0]
        for d in result.descriptors:
            if d.kind == kind:
                items.append(_apply_topology(session, d, entry))
        session.flush()

    for d in result.descriptors:
        if d.kind == "Device":
            items.append(_apply_device(session, d))
    session.flush()

    return ImportReport(items=items, loader_errors=result.errors)
