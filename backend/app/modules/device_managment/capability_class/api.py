"""CapabilityClass HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException

from .schema import CapabilityClass, CapabilityClassDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/capability_classes")
def get_all_capability_classes(session: SessionDepends):
    """List all capability classes."""
    return session.query(CapabilityClassDB).all()


get_capability_class_responses = {404: {"description": "No capability class found with the given UUID or name."}}
@router.get("/capability_classes/{identifier}", response_model=CapabilityClass, responses=get_capability_class_responses)
def get_capability_class(identifier: str, session: SessionDepends):
    """Get a single capability class by its UUID or name."""
    try:
        capability_class = session.get(CapabilityClassDB, UUID(identifier))
    except ValueError:
        capability_class = session.query(CapabilityClassDB).filter_by(name=identifier).first()
    if capability_class is None:
        raise HTTPException(status_code=404, detail="No capability class found with the given UUID or name.")
    return capability_class


# --- POST --------------------------------------------------------------------
create_capability_class_responses = {409: {"description": "A capability class with the same name already exists."}}
@router.post("/capability_classes", response_model=CapabilityClass, status_code=201, responses=create_capability_class_responses)
def create_capability_class(body: CapabilityClass, session: SessionDepends):
    """Create a new capability class."""
    capability_class = CapabilityClassDB(**body.model_dump())
    session.add(capability_class)
    session.commit()
    session.refresh(capability_class)
    return capability_class


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
