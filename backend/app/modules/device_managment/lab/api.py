"""Lab HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from .schema import CreateLab, Lab, LabDB, UpdateLab

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/labs")
def get_all_labs(session: SessionDepends):
    """List all labs."""
    return session.query(LabDB).all()


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
    lab = LabDB(**body.model_dump(exclude_none=True))
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

    if "uuid" in update_data and update_data["uuid"] != lab.uuid:
        raise HTTPException(status_code=400, detail="Primary key (UUID) is immutable and cannot be updated.")

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
# remove — add when needed
