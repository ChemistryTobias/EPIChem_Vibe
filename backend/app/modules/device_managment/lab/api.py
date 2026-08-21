from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from app.modules.device_managment.site.schema import SiteDB
from app.modules.device_managment.zone.logic import validate_zone_parent

from .schema import CreateLab, Lab, LabDB, UpdateLab

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/labs")
def get_all_labs(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all labs."""
    return paginate(session.query(LabDB), response, limit, offset)


@router.get("/labs/{identifier}", response_model=Lab)
def get_lab(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single lab by its UUID or name."""
    try:
        lab = session.get(LabDB, UUID(identifier))
    except ValueError:
        lab = session.query(LabDB).filter_by(name=identifier).first()
    if lab is None:
        raise HTTPException(status_code=404, detail="No lab found with the given UUID or name.")
    return lab


# --- POST --------------------------------------------------------------------
@router.post("/labs", response_model=Lab, status_code=201)
def create_lab(body: CreateLab, session: SessionDepends, user: CurrentUser):
    """Create a new lab."""
    data = body.model_dump(exclude_none=True)
    if data.get("zone_uuid") is not None:
        validate_zone_parent(session, data["zone_uuid"], SiteDB.__object_type__, body.site_uuid)
    lab = LabDB(**data)
    try:
        session.add(lab)
        session.commit()
        session.refresh(lab)
        record_revision(
            session,
            entity_type=LabDB.__object_type__,
            entity_uuid=lab.uuid,
            action="created",
            snapshot=Lab.model_validate(lab).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return lab
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Lab with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/labs/{identifier}", response_model=Lab)
def patch_lab(identifier: str, body: UpdateLab, session: SessionDepends, user: CurrentUser):
    """Partially update a lab."""
    update_data = body.model_dump(exclude_unset=True)
    lab = get_lab(identifier, session, user)

    if not update_data:
        return lab

    # checks if the lab can be part of the zone
    if update_data.get("zone_uuid") is not None:
        validate_zone_parent(
            session, update_data["zone_uuid"], SiteDB.__object_type__, update_data.get("site_uuid", lab.site_uuid)
        )

    for key, value in update_data.items():
        setattr(lab, key, value)

    try:
        session.commit()
        session.refresh(lab)
        record_revision(
            session,
            entity_type=LabDB.__object_type__,
            entity_uuid=lab.uuid,
            action="updated",
            snapshot=Lab.model_validate(lab).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return lab
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Lab with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/labs/{identifier}", status_code=204)
def delete_lab(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a lab by UUID or name."""
    lab = get_lab(identifier, session, user)
    snapshot = Lab.model_validate(lab).model_dump(mode="json")
    try:
        session.delete(lab)
        session.commit()
        record_revision(
            session,
            entity_type=LabDB.__object_type__,
            entity_uuid=lab.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete lab because it is referenced by other active resources.")
