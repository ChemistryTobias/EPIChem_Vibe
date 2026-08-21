from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from app.modules.device_managment.lab.schema import LabDB
from app.modules.device_managment.zone.logic import validate_zone_parent

from .schema import CreateStation, Station, StationDB, UpdateStation

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/stations")
def get_all_stations(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all stations."""
    return paginate(session.query(StationDB), response, limit, offset)


@router.get("/stations/{identifier}", response_model=Station)
def get_station(identifier: str, session: SessionDepends, user: CurrentUser):
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
def create_station(body: CreateStation, session: SessionDepends, user: CurrentUser):
    """Create a new station."""
    data = body.model_dump(exclude_none=True)
    if data.get("zone_uuid") is not None:
        validate_zone_parent(session, data["zone_uuid"], LabDB.__object_type__, body.lab_uuid)
    station = StationDB(**data)
    try:
        session.add(station)
        session.commit()
        session.refresh(station)
        record_revision(
            session,
            entity_type=StationDB.__object_type__,
            entity_uuid=station.uuid,
            action="created",
            snapshot=Station.model_validate(station).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return station
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Station with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/stations/{identifier}", response_model=Station)
def patch_station(identifier: str, body: UpdateStation, session: SessionDepends, user: CurrentUser):
    """Partially update a station."""
    update_data = body.model_dump(exclude_unset=True)
    station = get_station(identifier, session, user)

    if not update_data:
        return station

    if update_data.get("zone_uuid") is not None:
        validate_zone_parent(
            session, update_data["zone_uuid"], LabDB.__object_type__, update_data.get("lab_uuid", station.lab_uuid)
        )

    for key, value in update_data.items():
        setattr(station, key, value)

    try:
        session.commit()
        session.refresh(station)
        record_revision(
            session,
            entity_type=StationDB.__object_type__,
            entity_uuid=station.uuid,
            action="updated",
            snapshot=Station.model_validate(station).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return station
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Station with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/stations/{identifier}", status_code=204)
def delete_station(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a station by UUID or name."""
    station = get_station(identifier, session, user)
    snapshot = Station.model_validate(station).model_dump(mode="json")
    try:
        session.delete(station)
        session.commit()
        record_revision(
            session,
            entity_type=StationDB.__object_type__,
            entity_uuid=station.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete station because it is referenced by other active resources.")
