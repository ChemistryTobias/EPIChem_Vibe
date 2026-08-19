from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from .logic import resolve_parent_type
from .schema import CreateZone, Zone, ZoneDB, UpdateZone

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/zones")
def get_all_zones(session: SessionDepends):
    """List all zones."""
    return session.query(ZoneDB).all()


@router.get("/zones/{identifier}", response_model=Zone)
def get_zone(identifier: str, session: SessionDepends):
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
def create_zone(body: CreateZone, session: SessionDepends):
    """Create a new zone."""
    data = body.model_dump(exclude_none=True)
    data["parent_type"] = resolve_parent_type(session, body.parent_uuid)
    zone = ZoneDB(**data)
    try:
        session.add(zone)
        session.commit()
        session.refresh(zone)
        return zone
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Zone with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/zones/{identifier}", response_model=Zone)
def patch_zone(identifier: str, body: UpdateZone, session: SessionDepends):
    """Partially update a zone."""
    update_data = body.model_dump(exclude_unset=True)
    zone = get_zone(identifier, session)

    if not update_data:
        return zone

    if "parent_uuid" in update_data and update_data["parent_uuid"] != zone.parent_uuid:
        raise HTTPException(status_code=400, detail="The parent UUID is immutable and cannot be updated.")

    for key, value in update_data.items():
        setattr(zone, key, value)

    try:
        session.commit()
        session.refresh(zone)
        return zone
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Zone with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/zones/{identifier}", status_code=204)
def delete_zone(identifier: str, session: SessionDepends):
    """Delete a zone by UUID or name."""
    zone = get_zone(identifier, session)
    try:
        session.delete(zone)
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete zone because it is referenced by other active resources.")
