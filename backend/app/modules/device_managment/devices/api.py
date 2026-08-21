from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .schema import CreateDevice, Device, DeviceDB, UpdateDevice

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/devices")
def get_all_devices(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all devices."""
    return paginate(session.query(DeviceDB), response, limit, offset)


@router.get("/devices/{identifier}", response_model=Device)
def get_device(identifier: str, session: SessionDepends, user: CurrentUser):
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
def create_device(body: CreateDevice, session: SessionDepends, user: CurrentUser):
    """Create a new device."""
    device = DeviceDB(**body.model_dump(exclude_none=True))
    try:
        session.add(device)
        session.commit()
        session.refresh(device)
        record_revision(
            session,
            entity_type=DeviceDB.__object_type__,
            entity_uuid=device.uuid,
            action="created",
            snapshot=Device.model_validate(device).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return device
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Device with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/devices/{identifier}", response_model=Device)
def patch_device(identifier: str, body: UpdateDevice, session: SessionDepends, user: CurrentUser):
    """Partially update a device."""
    update_data = body.model_dump(exclude_unset=True)
    device = get_device(identifier, session, user)

    if not update_data:
        return device

    for key, value in update_data.items():
        setattr(device, key, value)

    try:
        session.commit()
        session.refresh(device)
        record_revision(
            session,
            entity_type=DeviceDB.__object_type__,
            entity_uuid=device.uuid,
            action="updated",
            snapshot=Device.model_validate(device).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return device
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Device with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/devices/{identifier}", status_code=204)
def delete_device(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a device by UUID or name."""
    device = get_device(identifier, session, user)
    snapshot = Device.model_validate(device).model_dump(mode="json")
    try:
        session.delete(device)
        session.commit()
        record_revision(
            session,
            entity_type=DeviceDB.__object_type__,
            entity_uuid=device.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete device because it is referenced by other active resources.")
