from uuid import UUID

from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from fastapi import APIRouter, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from app.modules.device_managment.site.schema import SiteDB
from app.modules.device_managment.zone.logic import validate_zone_parent

from .schema import CreateLab, Lab, LabDB, UpdateLab

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/labs")
def get_all_labs(session: SessionDepends, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0):
    """List all labs."""
    return paginate(session.query(LabDB), response, limit, offset)


@router.get("/labs/{identifier}", response_model=Lab)
def get_lab(identifier: str, session: SessionDepends):
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
def create_lab(body: CreateLab, session: SessionDepends):
    """Create a new lab."""
    data = body.model_dump(exclude_none=True)
    if data.get("zone_uuid") is not None:
        validate_zone_parent(session, data["zone_uuid"], SiteDB.__object_type__, body.site_uuid)
    lab = LabDB(**data)
    try:
        session.add(lab)
        session.commit()
        session.refresh(lab)
        return lab
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Lab with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/labs/{identifier}", response_model=Lab)
def patch_lab(identifier: str, body: UpdateLab, session: SessionDepends):
    """Partially update a lab."""
    update_data = body.model_dump(exclude_unset=True)
    lab = get_lab(identifier, session)

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
        return lab
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Lab with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/labs/{identifier}", status_code=204)
def delete_lab(identifier: str, session: SessionDepends):
    """Delete a lab by UUID or name."""
    lab = get_lab(identifier, session)
    try:
        session.delete(lab)
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete lab because it is referenced by other active resources.")
