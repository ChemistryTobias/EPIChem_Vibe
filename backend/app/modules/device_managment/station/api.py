"""Station HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from .schema import Station, StationDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/stations")
def get_all_stations(session: SessionDepends):
    """List all stations."""
    return session.query(StationDB).all()


@router.get("/stations/{identifier}", response_model=Station)
def get_station(identifier: str, session: SessionDepends):
    """Get a single station by its UUID or name."""
    try:
        station = session.get(StationDB, UUID(identifier))
    except ValueError:
        station = session.query(StationDB).filter_by(name=identifier).first()
    if station is None:
        raise HTTPException(status_code=404, detail="No station found with the given UUID or name.")
    return station


# --- POST --------------------------------------------------------------------
@router.post("/stations", response_model=Station, status_code=201)
def create_station(body: Station, session: SessionDepends):
    """Create a new station."""
    station = StationDB(**body.model_dump(exclude_none=True))
    try:
        session.add(station)
        session.commit()
        session.refresh(station)
        return station
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Station with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
