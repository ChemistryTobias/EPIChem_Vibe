"""Device read endpoints (§8.1 subset)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.deps import get_session
from epichem.api.resolve import resolve_by_code_or_id
from epichem.api.schemas import CapabilityClassOut, DeviceOut, SignalOut
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

router = APIRouter(prefix="/api/v1", tags=["devices"])


def _station_codes_by_device(session: Session, device_ids: list[UUID]) -> dict[UUID, str]:
    if not device_ids:
        return {}
    rows = session.execute(
        select(StationDeviceBinding.device_id, Station.code)
        .join(Station, Station.id == StationDeviceBinding.station_id)
        .where(StationDeviceBinding.device_id.in_(device_ids), StationDeviceBinding.role == "owns")
    ).all()
    return dict(rows)


def _to_device_out(session: Session, device: Device) -> DeviceOut:
    out = DeviceOut.model_validate(device)
    out.station_code = _station_codes_by_device(session, [device.id]).get(device.id)
    return out


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(
    session: Session = Depends(get_session),
    lab: str | None = Query(None, description="Filter by the Lab.code of the device's station"),
    capability_class: str | None = Query(None, description="Filter by CapabilityClass.name"),
    capability: str | None = Query(None, description="Filter by a declared capability action name"),
    mode: str | None = Query(None, description="Filter by operational_mode"),
):
    stmt = select(Device)
    if capability_class:
        stmt = stmt.join(
            CapabilityClass, CapabilityClass.id == Device.capability_class_id
        ).where(CapabilityClass.name == capability_class)
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

    devices = session.execute(stmt).scalars().unique().all()
    if capability:
        devices = [d for d in devices if capability in (d.capabilities or [])]

    codes = _station_codes_by_device(session, [d.id for d in devices])
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
