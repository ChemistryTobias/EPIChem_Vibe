"""Device and CapabilityClass endpoints (§8.1 subset): read + write. The
registry (Postgres) is the source of truth (ADR 0004) — writes go through
`create_entity`/`update_entity`/`delete_entity` (`epichem.registry`), each
recording a `Revision`. The Descriptor->values translation and station-
binding helpers are shared with the YAML import path — see `epichem.importer`.

Device create/update need one extra step after the generic write path:
`DeviceOut.station_code` isn't an ORM column (it comes from the
`StationDeviceBinding` join, see `_to_device_out` below), so the binding can
only be settled — and the Revision snapshot corrected — once the Device row
has an id. `finalize_station_binding` (`epichem.importer`) does that, and is
shared with the YAML import path so there is one copy of the reasoning
rather than one per caller.
"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from epichem.api.auth import require_write_token
from epichem.api.deps import get_session
from epichem.api.errors import ConflictProblem, UnprocessableProblem
from epichem.api.pagination import TOTAL_COUNT_HEADER, limit_param, offset_param
from epichem.api.resolve import resolve_by_code_or_id, resolve_by_natural_key_or_id
from epichem.api.schemas import CapabilityClassOut, DeviceOut, RevisionOut, SignalOut
from epichem.api.validation import check_descriptor_kind
from epichem.importer import (
    capability_class_values,
    device_values,
    finalize_station_binding,
    station_codes_by_device,
)
from epichem.models import (
    Bench,
    CapabilityClass,
    Device,
    Lab,
    Signal,
    Station,
    StationDeviceBinding,
    Workcell,
    Zone,
)
from epichem.registry import (
    create_entity,
    delete_entity,
    list_revisions,
    resolve_device_references,
    update_entity,
)
from epichem.schemas.descriptor import Descriptor

router = APIRouter(prefix="/api/v1", tags=["devices"])


def _to_device_out(session: Session, device: Device) -> DeviceOut:
    out = DeviceOut.model_validate(device)
    out.station_code = station_codes_by_device(session, [device.id]).get(device.id)
    return out


@router.get(
    "/devices",
    response_model=list[DeviceOut],
    summary="List devices",
    description=(
        "Registry records for registered devices. Filters are optional and "
        "combine with AND. Paged: see `limit`/`offset` and the "
        "`X-Total-Count` response header."
    ),
)
def list_devices(
    response: Response,
    session: Session = Depends(get_session),
    limit: int = Depends(limit_param),
    offset: int = Depends(offset_param),
    lab: str | None = Query(None, description="Filter by the Lab.code of the device's station"),
    capability_class: str | None = Query(None, description="Filter by CapabilityClass.name"),
    capability: str | None = Query(None, description="Filter by a declared capability action name"),
    mode: str | None = Query(None, description="Filter by operational_mode"),
):
    stmt = select(Device)
    if capability_class:
        stmt = stmt.join(CapabilityClass, CapabilityClass.id == Device.capability_class_id).where(
            CapabilityClass.name == capability_class
        )
    if mode:
        stmt = stmt.where(Device.operational_mode == mode)
    if lab:
        stmt = (
            stmt.join(StationDeviceBinding, StationDeviceBinding.device_id == Device.id)
            .join(Station, Station.id == StationDeviceBinding.station_id)
            .join(Bench, Bench.id == Station.bench_id)
            .join(Workcell, Workcell.id == Bench.workcell_id)
            .join(Zone, Zone.id == Workcell.zone_id)
            .join(Lab, Lab.id == Zone.lab_id)
            .where(Lab.code == lab)
        )

    # `capability` filters on a JSON array column, which has no portable
    # containment operator across sqlite and Postgres — so it stays a Python
    # filter, which in turn means the window has to be applied here rather
    # than in SQL, or the page would be short and the total wrong. Fine at
    # lab scale (tens to low hundreds of devices); revisit if a deployment
    # ever has enough devices for the unwindowed fetch to hurt.
    devices = list(session.execute(stmt).scalars().unique())
    if capability:
        devices = [d for d in devices if capability in (d.capabilities or [])]

    response.headers[TOTAL_COUNT_HEADER] = str(len(devices))
    devices = devices[offset : offset + limit]

    codes = station_codes_by_device(session, [d.id for d in devices])
    outs = []
    for device in devices:
        out = DeviceOut.model_validate(device)
        out.station_code = codes.get(device.id)
        outs.append(out)
    return outs


@router.get("/devices/{ident}", response_model=DeviceOut)
def get_device(ident: str, session: Session = Depends(get_session)):
    device = resolve_by_code_or_id(session, Device, ident)
    return _to_device_out(session, device)


@router.get("/devices/{ident}/signals", response_model=list[SignalOut])
def list_device_signals(ident: str, session: Session = Depends(get_session)):
    device = resolve_by_code_or_id(session, Device, ident)
    return session.execute(select(Signal).where(Signal.device_id == device.id)).scalars().all()


@router.get("/device-classes", response_model=list[CapabilityClassOut])
def list_device_classes(session: Session = Depends(get_session)):
    return session.execute(select(CapabilityClass)).scalars().all()


# ---- write endpoints (ADR 0004) --------------------------------------------


@router.post(
    "/device-classes",
    dependencies=[Depends(require_write_token)],
    response_model=CapabilityClassOut,
    status_code=201,
)
def create_capability_class(descriptor: Descriptor, session: Session = Depends(get_session)):
    check_descriptor_kind(descriptor, "CapabilityClass")
    values = capability_class_values(descriptor, descriptor.typed_spec())
    try:
        obj, _revision = create_entity(
            session, CapabilityClass, "CapabilityClass", CapabilityClassOut, values
        )
    except ValueError as e:
        raise ConflictProblem(title="CapabilityClass already exists", detail=str(e)) from e
    session.commit()
    return obj


@router.put(
    "/device-classes/{ident}",
    dependencies=[Depends(require_write_token)],
    response_model=CapabilityClassOut,
)
def replace_capability_class(
    ident: str, descriptor: Descriptor, session: Session = Depends(get_session)
):
    check_descriptor_kind(descriptor, "CapabilityClass")
    obj = resolve_by_natural_key_or_id(session, CapabilityClass, ident, key_attr="name")
    values = capability_class_values(descriptor, descriptor.typed_spec())
    update_entity(session, obj, "CapabilityClass", CapabilityClassOut, values)
    session.commit()
    return obj


@router.delete(
    "/device-classes/{ident}", dependencies=[Depends(require_write_token)], status_code=204
)
def delete_capability_class(ident: str, session: Session = Depends(get_session)):
    obj = resolve_by_natural_key_or_id(session, CapabilityClass, ident, key_attr="name")
    try:
        delete_entity(session, obj, "CapabilityClass", CapabilityClassOut)
    except IntegrityError:
        session.rollback()
        raise ConflictProblem(
            title="CapabilityClass cannot be deleted",
            detail=f"CapabilityClass {ident!r} is still referenced by other records",
        ) from None
    session.commit()
    return None


@router.get("/device-classes/{ident}/revisions", response_model=list[RevisionOut])
def list_capability_class_revisions(ident: str, session: Session = Depends(get_session)):
    obj = resolve_by_natural_key_or_id(session, CapabilityClass, ident, key_attr="name")
    return list_revisions(session, "CapabilityClass", obj.id)


def _resolve_device_refs(session: Session, spec) -> dict:
    try:
        return resolve_device_references(
            session, spec.class_, spec.capabilities, spec.location.station, spec.parent
        )
    except ValueError as e:
        raise UnprocessableProblem(
            title="Device references could not be resolved", detail=str(e)
        ) from e


@router.post(
    "/devices",
    dependencies=[Depends(require_write_token)],
    response_model=DeviceOut,
    status_code=201,
)
def create_device(descriptor: Descriptor, session: Session = Depends(get_session)):
    check_descriptor_kind(descriptor, "Device")
    spec = descriptor.typed_spec()
    refs = _resolve_device_refs(session, spec)
    values = device_values(descriptor, spec, refs)
    try:
        device, revision = create_entity(session, Device, "Device", DeviceOut, values)
    except ValueError as e:
        raise ConflictProblem(title="Device already exists", detail=str(e)) from e

    finalize_station_binding(session, device, refs["station_id"], revision)
    session.commit()
    return _to_device_out(session, device)


@router.put(
    "/devices/{ident}", dependencies=[Depends(require_write_token)], response_model=DeviceOut
)
def replace_device(ident: str, descriptor: Descriptor, session: Session = Depends(get_session)):
    check_descriptor_kind(descriptor, "Device")
    device = resolve_by_code_or_id(session, Device, ident)
    spec = descriptor.typed_spec()
    refs = _resolve_device_refs(session, spec)
    values = device_values(descriptor, spec, refs)
    revision = update_entity(session, device, "Device", DeviceOut, values)
    finalize_station_binding(session, device, refs["station_id"], revision)
    session.commit()
    return _to_device_out(session, device)


@router.delete("/devices/{ident}", dependencies=[Depends(require_write_token)], status_code=204)
def delete_device(ident: str, session: Session = Depends(get_session)):
    device = resolve_by_code_or_id(session, Device, ident)
    try:
        delete_entity(session, device, "Device", DeviceOut)
    except IntegrityError:
        session.rollback()
        raise ConflictProblem(
            title="Device cannot be deleted",
            detail=f"Device {ident!r} is still referenced by other records",
        ) from None
    session.commit()
    return None


@router.get("/devices/{ident}/revisions", response_model=list[RevisionOut])
def list_device_revisions(ident: str, session: Session = Depends(get_session)):
    device = resolve_by_code_or_id(session, Device, ident)
    return list_revisions(session, "Device", device.id)
