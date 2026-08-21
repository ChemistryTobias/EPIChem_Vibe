from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .schema import CreateSite, Site, SiteDB, UpdateSite

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/sites")
def get_all_sites(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all sites."""
    return paginate(session.query(SiteDB), response, limit, offset)


@router.get("/sites/{identifier}", response_model=Site)
def get_site(identifier: str, session: SessionDepends, user: CurrentUser):
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
def create_site(body: CreateSite, session: SessionDepends, user: CurrentUser):
    """Create a new site."""
    site = SiteDB(**body.model_dump(exclude_none=True))
    try:
        session.add(site)
        session.commit()
        session.refresh(site)
        record_revision(
            session,
            entity_type=SiteDB.__object_type__,
            entity_uuid=site.uuid,
            action="created",
            snapshot=Site.model_validate(site).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return site
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Site with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/sites/{identifier}", response_model=Site)
def patch_site(identifier: str, body: UpdateSite, session: SessionDepends, user: CurrentUser):
    """Partially update a site."""
    update_data = body.model_dump(exclude_unset=True)
    site = get_site(identifier, session, user)

    if not update_data:
        return site

    for key, value in update_data.items():
        setattr(site, key, value)

    try:
        session.commit()
        session.refresh(site)
        record_revision(
            session,
            entity_type=SiteDB.__object_type__,
            entity_uuid=site.uuid,
            action="updated",
            snapshot=Site.model_validate(site).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return site
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Site with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/sites/{identifier}", status_code=204)
def delete_site(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a site by UUID or name."""
    site = get_site(identifier, session, user)
    snapshot = Site.model_validate(site).model_dump(mode="json")
    try:
        session.delete(site)
        session.commit()
        record_revision(
            session,
            entity_type=SiteDB.__object_type__,
            entity_uuid=site.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete site because it is referenced by other active resources.")
