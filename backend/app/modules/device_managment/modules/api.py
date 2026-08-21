from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .schema import CreateModule, Module, ModuleDB, UpdateModule

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("/modules")
def get_all_modules(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all modules."""
    return paginate(session.query(ModuleDB), response, limit, offset)


@router.get("/modules/{identifier}", response_model=Module)
def get_module(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single module by its UUID or name."""
    try:
        module = session.get(ModuleDB, UUID(identifier))
    except ValueError:
        module = session.query(ModuleDB).filter_by(name=identifier).first()
    if module is None:
        raise HTTPException(status_code=404, detail="No module found with the given UUID or name.")
    return module


# --- POST --------------------------------------------------------------------
@router.post("/modules", response_model=Module, status_code=201)
def create_module(body: CreateModule, session: SessionDepends, user: CurrentUser):
    """Create a new module."""
    module = ModuleDB(**body.model_dump(exclude_none=True))
    try:
        session.add(module)
        session.commit()
        session.refresh(module)
        record_revision(
            session,
            entity_type=ModuleDB.__object_type__,
            entity_uuid=module.uuid,
            action="created",
            snapshot=Module.model_validate(module).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return module
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Module with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/modules/{identifier}", response_model=Module)
def patch_module(identifier: str, body: UpdateModule, session: SessionDepends, user: CurrentUser):
    """Partially update a module."""
    update_data = body.model_dump(exclude_unset=True)
    module = get_module(identifier, session, user)

    if not update_data:
        return module

    for key, value in update_data.items():
        setattr(module, key, value)

    try:
        session.commit()
        session.refresh(module)
        record_revision(
            session,
            entity_type=ModuleDB.__object_type__,
            entity_uuid=module.uuid,
            action="updated",
            snapshot=Module.model_validate(module).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return module
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Module with the same identifier (UUID or name) already exists.")


# --- PUT ---------------------------------------------------------------------
# full replace — add when needed


# --- DELETE ------------------------------------------------------------------
@router.delete("/modules/{identifier}", status_code=204)
def delete_module(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a module by UUID or name."""
    module = get_module(identifier, session, user)
    snapshot = Module.model_validate(module).model_dump(mode="json")
    try:
        session.delete(module)
        session.commit()
        record_revision(
            session,
            entity_type=ModuleDB.__object_type__,
            entity_uuid=module.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete module because it is referenced by other active resources.")
