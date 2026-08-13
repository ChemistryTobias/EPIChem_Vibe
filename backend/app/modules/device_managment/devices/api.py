"""Device HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from .schema import CreateDevice, Device, DeviceDB

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
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
