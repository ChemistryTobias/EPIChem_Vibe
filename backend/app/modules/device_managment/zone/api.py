from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .logic import resolve_parent_type
from .schema import CreateZone, Zone, ZoneDB, UpdateZone

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/zones")
def get_all_zones(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all zones."""
    return paginate(session.query(ZoneDB), response, limit, offset)


@router.get("/zones/{identifier}", response_model=Zone)
def get_zone(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single zone by its UUID or name."""
    try:
        zone = session.get(ZoneDB, UUID(identifier))
    except ValueError:
        zone = session.query(ZoneDB).filter_by(name=identifier).first()
    if zone is None:
        raise HTTPException(status_code=404, detail="No zone found with the given UUID or name.")
    return zone


# --- POST --------------------------------------------------------------------
@router.post("/zones", response_model=Zone, status_code=201)
def create_zone(body: CreateZone, session: SessionDepends, user: CurrentUser):
    """Create a new zone."""
    data = body.model_dump(exclude_none=True)
    data["parent_type"] = resolve_parent_type(session, body.parent_uuid)
    zone = ZoneDB(**data)
    try:
        session.add(zone)
        session.commit()
        session.refresh(zone)
        record_revision(
            session,
            entity_type=ZoneDB.__object_type__,
            entity_uuid=zone.uuid,
            action="created",
            snapshot=Zone.model_validate(zone).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return zone
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Zone with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/zones/{identifier}", response_model=Zone)
def patch_zone(identifier: str, body: UpdateZone, session: SessionDepends, user: CurrentUser):
    """Partially update a zone."""
    update_data = body.model_dump(exclude_unset=True)
    zone = get_zone(identifier, session, user)

    if not update_data:
        return zone

    if "parent_uuid" in update_data and update_data["parent_uuid"] != zone.parent_uuid:
        raise HTTPException(status_code=400, detail="The parent UUID is immutable and cannot be updated.")

    for key, value in update_data.items():
        setattr(zone, key, value)

    try:
        session.commit()
        session.refresh(zone)
        record_revision(
            session,
            entity_type=ZoneDB.__object_type__,
            entity_uuid=zone.uuid,
            action="updated",
            snapshot=Zone.model_validate(zone).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return zone
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Zone with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/zones/{identifier}", status_code=204)
def delete_zone(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a zone by UUID or name."""
    zone = get_zone(identifier, session, user)
    snapshot = Zone.model_validate(zone).model_dump(mode="json")
    try:
        session.delete(zone)
        session.commit()
        record_revision(
            session,
            entity_type=ZoneDB.__object_type__,
            entity_uuid=zone.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete zone because it is referenced by other active resources.")
