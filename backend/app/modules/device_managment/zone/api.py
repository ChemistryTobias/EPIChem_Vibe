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
def create_zone(body: Zone, session: SessionDepends):
    """Create a new zone. A duplicate raises IntegrityError, turned into a 409
    by the fallback handler in core/errors.py."""
    zone = ZoneDB(**body.model_dump(exclude_none=True))
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
