"""Zone HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException

from .schema import Zone, ZoneDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/zones")
def get_all_zones(session: SessionDepends):
    """List all zones."""
    return session.query(ZoneDB).all()


get_zone_responses = {404: {"description": "No zone found with the given UUID or name."}}
@router.get("/zones/{identifier}", response_model=Zone, responses=get_zone_responses)
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
create_zone_responses = {409: {"description": "A zone with the same name already exists."}}
@router.post("/zones", response_model=Zone, status_code=201, responses=create_zone_responses)
def create_zone(body: Zone, session: SessionDepends):
    """Create a new zone."""
    zone = ZoneDB(**body.model_dump())
    session.add(zone)
    session.commit()
    session.refresh(zone)
    return zone


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
