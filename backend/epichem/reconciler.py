"""The reconciler (ADR 0001, plan §4/§6.5): loads descriptor YAML from a
directory ("desired state"), diffs it against the Postgres/SQLAlchemy
registry ("observed state"), and upserts — a plain in-process function, not
a Kubernetes operator.

Public entry point::

    reconcile(session, descriptors_dir) -> ReconcileReport

``ReconcileReport`` (returned, never raised on data problems):

    items: list[ReconcileItem]
        One entry per descriptor that was *attempted* (i.e. loaded
        successfully by the loader). ``kind``/``code`` come straight from
        the descriptor's ``kind``/``metadata.code``. ``action`` is one of
        ``"created" | "updated" | "unchanged" | "error"``. ``detail`` is a
        free-text message — empty on success, otherwise the reason the
        descriptor was skipped (e.g. an unresolved reference).
    loader_errors: list[DescriptorError]
        Passed straight through from ``load_descriptors`` (bad YAML/schema —
        never even became a ``Descriptor``, so there's no item for it).
    drift: list[ReconcileItem]
        Rows already in the registry (Site/Lab/Zone/Workcell/Bench/Station/
        Device) whose ``code`` had no corresponding descriptor in this load
        batch. ``action`` is ``"drift"``. Never deleted — see ADR 0001 /
        the module docstring below: reporting drift is the point, auto-
        deleting hardware/topology records because a file was momentarily
        absent would be dangerous.
    ok: bool (property)
        True iff there were no loader errors and no item with
        ``action == "error"``. Drift alone does not flip this to False —
        it's informational, not a failure of this run.

A descriptor is *skipped* (nothing written for it) whenever a reference it
makes (topology parent, ``DeviceSpec.location.station``, ``DeviceSpec.parent``,
or the trailing segment of ``DeviceSpec.class_``) doesn't resolve, or when
one of its declared ``capabilities`` isn't defined by any registered
``CapabilityClass``. That never blocks unrelated, valid descriptors in the
same batch — each descriptor's references are checked before anything is
written for it.

Upsert order (dependency order): CapabilityClass, Site, Lab, Zone, Workcell,
Bench, Station, Device, then StationDeviceBinding (role="owns") for each
Device with a resolved ``location.station``. Matching is by ``code`` for
every kind except CapabilityClass, which has no ``code`` column on its ORM
model and is matched by ``name`` instead (the descriptor's ``metadata.name``,
which is also what ``DeviceSpec.class_``'s trailing segment must match).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.descriptors.loader import DescriptorError, load_descriptors
from epichem.models.capability import CapabilityClass
from epichem.models.device import Device, StationDeviceBinding
from epichem.models.topology import Bench, Lab, Site, Station, Workcell, Zone

Action = str  # "created" | "updated" | "unchanged" | "error" | "drift"


@dataclass
class ReconcileItem:
    kind: str
    code: str
    action: Action
    detail: str = ""


@dataclass
class ReconcileReport:
    items: list[ReconcileItem] = field(default_factory=list)
    loader_errors: list[DescriptorError] = field(default_factory=list)
    drift: list[ReconcileItem] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.loader_errors and not any(i.action == "error" for i in self.items)


# ---- generic upsert helper --------------------------------------------------


def _upsert_row(session: Session, model_cls, match_attr: str, match_value, values: dict):
    """Match an existing row by a single attribute; update changed fields or
    insert. Returns (obj, action). Only assigns fields that actually differ,
    so an unchanged row is never touched (no spurious UPDATE / updated_at
    bump) and is reported "unchanged" rather than "updated".
    """
    stmt = select(model_cls).where(getattr(model_cls, match_attr) == match_value)
    obj = session.execute(stmt).scalar_one_or_none()
    if obj is None:
        obj = model_cls(**values)
        session.add(obj)
        return obj, "created"

    changed = False
    for k, v in values.items():
        if getattr(obj, k) != v:
            setattr(obj, k, v)
            changed = True
    return obj, ("updated" if changed else "unchanged")


def _lookup_id(session: Session, model_cls, code: str):
    stmt = select(model_cls.id).where(model_cls.code == code)
    return session.execute(stmt).scalar_one_or_none()


# ---- topology (Site -> Lab -> Zone -> Workcell -> Bench -> Station) --------

# (kind, parent spec field name on the spec / None, plain attrs copied 1:1
# from spec to ORM column). The parent FK column is always f"{field}_id".
_TOPOLOGY = [
    ("Site", Site, None, ["address", "timezone"]),
    ("Lab", Lab, "site", ["room_number", "environment_class", "access_control_group"]),
    ("Zone", Zone, "lab", ["atmosphere", "pressure", "temperature_class", "hazard_class"]),
    (
        "Workcell",
        Workcell,
        "zone",
        ["queueserver_endpoint", "redis_namespace", "state", "owning_group"],
    ),
    ("Bench", Bench, "workcell", ["grid_cols", "grid_rows", "height_mm"]),
    (
        "Station",
        Station,
        "bench",
        ["kind", "grid_col", "grid_row", "stack_height", "capacity", "accepted_labware_types"],
    ),
]

_MODEL_BY_LOWER_KIND = {
    "site": Site,
    "lab": Lab,
    "zone": Zone,
    "workcell": Workcell,
    "bench": Bench,
    "station": Station,
}


def _reconcile_topology(session: Session, descriptors, items: list[ReconcileItem]) -> None:
    for kind, model_cls, parent_field, attrs in _TOPOLOGY:
        for d in descriptors:
            if d.kind != kind:
                continue
            spec = d.typed_spec()
            code = d.metadata.code
            values: dict = {"code": code, "name": d.metadata.name}
            for attr in attrs:
                values[attr] = getattr(spec, attr)

            if parent_field:
                parent_code = getattr(spec, parent_field)
                parent_model = _MODEL_BY_LOWER_KIND[parent_field]
                parent_id = _lookup_id(session, parent_model, parent_code)
                if parent_id is None:
                    items.append(
                        ReconcileItem(
                            kind,
                            code,
                            "error",
                            f"{parent_field} {parent_code!r} not found "
                            f"(referenced by {kind} {code!r})",
                        )
                    )
                    continue
                values[f"{parent_field}_id"] = parent_id

            obj, action = _upsert_row(session, model_cls, "code", code, values)
            items.append(ReconcileItem(kind, code, action))
        session.flush()


# ---- CapabilityClass ---------------------------------------------------------


def _reconcile_capability_classes(
    session: Session, descriptors, items: list[ReconcileItem]
) -> None:
    for d in descriptors:
        if d.kind != "CapabilityClass":
            continue
        spec = d.typed_spec()
        values = {
            "name": d.metadata.name,
            "iri": d.metadata.iri,
            "extends": spec.extends,
            "actions": {
                name: action.model_dump(mode="json") for name, action in spec.actions.items()
            },
        }
        obj, action = _upsert_row(session, CapabilityClass, "name", d.metadata.name, values)
        items.append(ReconcileItem("CapabilityClass", d.metadata.code, action))
    session.flush()


# ---- Device (+ StationDeviceBinding) ----------------------------------------


def _device_values(d, spec, capability_class_id) -> dict:
    ophyd_import = spec.ophyd.import_ if spec.ophyd else None
    ophyd_args = spec.ophyd.args if spec.ophyd else {}
    pose = spec.location.pose
    calibration = spec.operational.calibration
    return {
        "code": d.metadata.code,
        "name": d.metadata.name,
        "labels": d.metadata.labels,
        "capability_class_ref": spec.class_,
        "capability_class_id": capability_class_id,
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


def _reconcile_devices(session: Session, descriptors, items: list[ReconcileItem]) -> None:
    device_descs = [d for d in descriptors if d.kind == "Device"]
    if not device_descs:
        return

    # Union of action names across every *registered* CapabilityClass
    # (already upserted+flushed by this point) — a device's capabilities
    # don't have to come only from its own declared class.
    all_actions: set[str] = set()
    for cc in session.execute(select(CapabilityClass)).scalars():
        all_actions.update(cc.actions.keys())

    # Phase 1: validate everything except parent-chain references, before
    # writing anything.
    candidates: dict[str, dict] = {}
    for d in device_descs:
        spec = d.typed_spec()
        code = d.metadata.code
        problems: list[str] = []

        class_name = spec.class_.rsplit(".", 1)[-1]
        cc = session.execute(
            select(CapabilityClass).where(CapabilityClass.name == class_name)
        ).scalar_one_or_none()
        if cc is None:
            problems.append(
                f"class {spec.class_!r} does not resolve to any registered "
                f"CapabilityClass (looked for name {class_name!r})"
            )

        missing_caps = [c for c in spec.capabilities if c not in all_actions]
        if missing_caps:
            problems.append(
                f"capabilities {missing_caps} are not defined by any registered CapabilityClass"
            )

        station_id = None
        if spec.location.station:
            station_id = _lookup_id(session, Station, spec.location.station)
            if station_id is None:
                problems.append(f"location.station {spec.location.station!r} not found")

        if problems:
            items.append(ReconcileItem("Device", code, "error", "; ".join(problems)))
            continue

        candidates[code] = {
            "descriptor": d,
            "spec": spec,
            "capability_class_id": cc.id,
            "station_id": station_id,
            "parent_code": spec.parent,
        }

    # Phase 1b: cascade-validate DeviceSpec.parent (may point at another
    # device in this same batch, or one already in the registry).
    changed = True
    while changed:
        changed = False
        for code in list(candidates):
            parent_code = candidates[code]["parent_code"]
            if parent_code is None or parent_code in candidates:
                continue
            if _lookup_id(session, Device, parent_code) is not None:
                continue
            items.append(
                ReconcileItem("Device", code, "error", f"parent {parent_code!r} not found")
            )
            del candidates[code]
            changed = True

    # Phase 2a: upsert every surviving device, parent_id deferred (a batch
    # sibling's id may not exist yet pre-flush).
    code_to_obj: dict[str, Device] = {}
    pending: dict[str, dict] = {}
    for code, data in candidates.items():
        d = data["descriptor"]
        values = _device_values(d, data["spec"], data["capability_class_id"])
        existing = session.execute(select(Device).where(Device.code == code)).scalar_one_or_none()
        is_new = existing is None
        if is_new:
            obj = Device(**values)
            session.add(obj)
            field_changed = False
        else:
            obj = existing
            field_changed = False
            for k, v in values.items():
                if getattr(obj, k) != v:
                    setattr(obj, k, v)
                    field_changed = True
        code_to_obj[code] = obj
        pending[code] = {"is_new": is_new, "field_changed": field_changed, "data": data}

    session.flush()  # populate ids for newly-created devices

    # Phase 2b: resolve parent_id and station bindings now that ids exist.
    for code, obj in code_to_obj.items():
        data = pending[code]["data"]
        parent_code = data["parent_code"]
        if parent_code is None:
            resolved_parent_id = None
        elif parent_code in code_to_obj:
            resolved_parent_id = code_to_obj[parent_code].id
        else:
            resolved_parent_id = _lookup_id(session, Device, parent_code)

        if obj.parent_id != resolved_parent_id:
            obj.parent_id = resolved_parent_id
            pending[code]["field_changed"] = True

        station_id = data["station_id"]
        if station_id is not None:
            binding = session.execute(
                select(StationDeviceBinding).where(
                    StationDeviceBinding.station_id == station_id,
                    StationDeviceBinding.device_id == obj.id,
                    StationDeviceBinding.role == "owns",
                )
            ).scalar_one_or_none()
            if binding is None:
                session.add(
                    StationDeviceBinding(station_id=station_id, device_id=obj.id, role="owns")
                )

    session.flush()

    for code, _obj in code_to_obj.items():
        p = pending[code]
        if p["is_new"]:
            action = "created"
        elif p["field_changed"]:
            action = "updated"
        else:
            action = "unchanged"
        items.append(ReconcileItem("Device", code, action))


# ---- drift -------------------------------------------------------------------

_DRIFT_KINDS = [
    ("Site", Site),
    ("Lab", Lab),
    ("Zone", Zone),
    ("Workcell", Workcell),
    ("Bench", Bench),
    ("Station", Station),
    ("Device", Device),
]


def _compute_drift(session: Session, descriptors) -> list[ReconcileItem]:
    drift: list[ReconcileItem] = []
    for kind, model_cls in _DRIFT_KINDS:
        seen_codes = {d.metadata.code for d in descriptors if d.kind == kind}
        db_codes = session.execute(select(model_cls.code)).scalars().all()
        for code in db_codes:
            if code not in seen_codes:
                drift.append(
                    ReconcileItem(
                        kind,
                        code,
                        "drift",
                        "in registry, no matching descriptor in this load batch",
                    )
                )
    return drift


# ---- entry point -------------------------------------------------------------


def reconcile(session: Session, descriptors_dir: Path | str) -> ReconcileReport:
    result = load_descriptors(descriptors_dir)

    items: list[ReconcileItem] = []
    _reconcile_capability_classes(session, result.descriptors, items)
    _reconcile_topology(session, result.descriptors, items)
    _reconcile_devices(session, result.descriptors, items)

    drift = _compute_drift(session, result.descriptors)

    return ReconcileReport(items=items, loader_errors=result.errors, drift=drift)
