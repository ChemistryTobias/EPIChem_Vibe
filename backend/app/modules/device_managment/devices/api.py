"""Device HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from app.core.errors import NotFoundError
from fastapi import APIRouter

from .schema import Device, DeviceDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/devices")
def get_all_devices(session: SessionDepends):
    """List all devices."""
    return session.query(DeviceDB).all()


get_device_responses = {404: {"description": "No device found with the given UUID or name."}}
@router.get("/devices/{identifier}", response_model=Device, responses=get_device_responses)
def get_device(identifier: str, session: SessionDepends):
    """Get a single device by its UUID or name."""
    try:
        device = session.get(DeviceDB, UUID(identifier))
    except ValueError:
        device = session.query(DeviceDB).filter_by(name=identifier).first()
    if device is None:
        raise NotFoundError("No device found with the given UUID or name.")
    return device


# --- POST --------------------------------------------------------------------
create_device_responses = {409: {"description": "A device with the same name already exists."}}
@router.post("/devices", response_model=Device, status_code=201, responses=create_device_responses)
def create_device(body: Device, session: SessionDepends):
    """Create a new device."""
    device = DeviceDB(**body.model_dump())
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
