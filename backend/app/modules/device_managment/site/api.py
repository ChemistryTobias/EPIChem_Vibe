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


@router.get("/sites/{identifier}", response_model=Site)
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
@router.post("/sites", response_model=Site, status_code=201)
def create_site(body: Site, session: SessionDepends):
    """Create a new site. A duplicate raises IntegrityError, turned into a 409
    by the fallback handler in core/errors.py."""
    site = SiteDB(**body.model_dump(exclude_none=True))
    session.add(site)
    session.commit()
    session.refresh(site)
    return site


# --- PATCH -------------------------------------------------------------------
# partial update — add when needed


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
# remove — add when needed
