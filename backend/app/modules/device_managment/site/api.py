"""Site HTTP endpoints, as an APIRouter mounted by app/main.py."""

from uuid import UUID

from app.core.database import SessionDepends
from fastapi import APIRouter, HTTPException

from .schema import Site, SiteDB

router = APIRouter()


# --- GET ---------------------------------------------------------------------
@router.get("/sites")
def get_all_sites(session: SessionDepends):
    """List all sites."""
    return session.query(SiteDB).all()


getSide_responses = {404: {"description": "No site found with the given UUID or name."}}
@router.get("/sites/{identifier}", response_model=Site, responses=getSide_responses)
def get_site(identifier: str, session: SessionDepends):
    """Get a single site by its UUID or name."""
    try:
        site = session.get(SiteDB, UUID(identifier))
    except ValueError:
        site = session.query(SiteDB).filter_by(name=identifier).first()
    if site is None:
        raise HTTPException(status_code=404, detail="No site found with the given UUID or name.")
    return site


# --- POST --------------------------------------------------------------------
createSide_responses = {409: {"description": "A site with the same identifierifier (Name or UUID) already exists."}}
@router.post("/sites", response_model=Site, status_code=201, responses=createSide_responses)
def create_site(body: Site, session: SessionDepends):
    """Create a new site."""
    site = SiteDB(**body.model_dump())
    session.add(site)
    session.commit()
    session.refresh(site)
    return site


# --- PATCH -------------------------------------------------------------------
# partial update (e.g. change one field) — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace of a site — add when needed


# --- DELETE ------------------------------------------------------------------
# remove a site — add when needed
