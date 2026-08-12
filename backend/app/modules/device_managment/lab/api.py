"""Lab HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException

from .schema import Lab, LabDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/labs")
def get_all_labs(session: SessionDepends):
    """List all labs."""
    return session.query(LabDB).all()


get_lab_responses = {404: {"description": "No lab found with the given UUID or name."}}
@router.get("/labs/{identifier}", response_model=Lab, responses=get_lab_responses)
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
create_lab_responses = {409: {"description": "A lab with the same name already exists."}}
@router.post("/labs", response_model=Lab, status_code=201, responses=create_lab_responses)
def create_lab(body: Lab, session: SessionDepends):
    """Create a new lab."""
    lab = LabDB(**body.model_dump())
    session.add(lab)
    session.commit()
    session.refresh(lab)
    return lab


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
