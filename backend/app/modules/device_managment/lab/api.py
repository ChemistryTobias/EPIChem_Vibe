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
def create_lab(body: Lab, session: SessionDepends):
    """Create a new lab. A duplicate raises IntegrityError, turned into a 409
    by the fallback handler in core/errors.py."""
    lab = LabDB(**body.model_dump(exclude_none=True))
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
