"""Device HTTP endpoints ."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from .schema import CreateDevice, Device, DeviceDB, UpdateDevice

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/devices")
def get_all_devices(session: SessionDepends):
    """List all devices."""
    return session.query(DeviceDB).all()


@router.get("/devices/{identifier}", response_model=Device)
def get_device(identifier: str, session: SessionDepends):
    """Get a single device by its UUID or name."""
    try:
        device = session.get(DeviceDB, UUID(identifier))
    except ValueError:
        device = session.query(DeviceDB).filter_by(name=identifier).first()
    if device is None:
        raise HTTPException(status_code=404, detail="No device found with the given UUID or name.")
    return device


# --- POST --------------------------------------------------------------------
@router.post("/devices", response_model=Device, status_code=201)
def create_device(body: CreateDevice, session: SessionDepends):
    """Create a new device."""
    device = DeviceDB(**body.model_dump(exclude_none=True))
    try:
        session.add(device)
        session.commit()
        session.refresh(device)
        return device
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Device with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/devices/{identifier}", response_model=Device)
def patch_device(identifier: str, body: UpdateDevice, session: SessionDepends):
    """Partially update a device."""
    update_data = body.model_dump(exclude_unset=True)
    device = get_device(identifier, session)

    if not update_data:
        return device

    if "uuid" in update_data and update_data["uuid"] != device.uuid:
        raise HTTPException(status_code=400, detail="Primary key (UUID) is immutable and cannot be updated.")

    for key, value in update_data.items():
        setattr(device, key, value)

    try:
        session.commit()
        session.refresh(device)
        return device
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Device with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/devices/{identifier}", status_code=204)
def delete_device(identifier: str, session: SessionDepends):
    """Delete a device by UUID or name."""
    device = get_device(identifier, session)
    try:
        session.delete(device)
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete device because it is referenced by other active resources.")
