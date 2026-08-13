"""Device HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException

from .schema import Device, DeviceDB

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
def create_device(body: Device, session: SessionDepends):
    """Create a new device. A duplicate raises IntegrityError, turned into a 409
    by the fallback handler in core/errors.py."""
    device = DeviceDB(**body.model_dump(exclude_none=True))
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
