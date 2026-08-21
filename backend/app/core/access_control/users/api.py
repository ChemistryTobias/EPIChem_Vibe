from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .logic import hash_password
from .schema import CreateUser, User, UserDB, UpdateUser

router = APIRouter(prefix="/users", tags=["users"])

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("")
def get_all_users(session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0):
    """List all users."""
    return paginate(session.query(UserDB), response, limit, offset)


@router.get("/{identifier}", response_model=User)
def get_user(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single user by its UUID or name."""
    try:
        target = session.get(UserDB, UUID(identifier))
    except ValueError:
        target = session.query(UserDB).filter_by(name=identifier).first()
    if target is None:
        raise HTTPException(status_code=404, detail="No user found with the given UUID or name.")
    return target


# --- POST --------------------------------------------------------------------
# No auth dependency: this is the bootstrap path to create the first account before any token exists.
@router.post("", response_model=User, status_code=201)
def create_user(body: CreateUser, session: SessionDepends):
    """Create a new user."""
    data = body.model_dump(exclude={"password"}, exclude_none=True)
    new_user = UserDB(**data, password_hash=hash_password(body.password))
    try:
        session.add(new_user)
        session.commit()
        session.refresh(new_user)
        record_revision(
            session,
            entity_type="user",
            entity_uuid=new_user.uuid,
            action="created",
            snapshot=User.model_validate(new_user).model_dump(mode="json"),
            actor_uuid=None,
        )
        session.commit()
        return new_user
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="User with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/{identifier}", response_model=User)
def patch_user(identifier: str, body: UpdateUser, session: SessionDepends, user: CurrentUser):
    """Partially update a user."""
    update_data = body.model_dump(exclude_unset=True, exclude={"password"})
    target = get_user(identifier, session, user)

    if body.password is not None:
        target.password_hash = hash_password(body.password)
    elif not update_data:
        return target

    for key, value in update_data.items():
        setattr(target, key, value)

    try:
        session.commit()
        session.refresh(target)
        record_revision(
            session,
            entity_type="user",
            entity_uuid=target.uuid,
            action="updated",
            snapshot=User.model_validate(target).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return target
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="User with the same identifier (UUID or name) already exists.")


# --- DELETE ------------------------------------------------------------------
@router.delete("/{identifier}", status_code=204)
def delete_user(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a user by UUID or name."""
    target = get_user(identifier, session, user)
    snapshot = User.model_validate(target).model_dump(mode="json")
    try:
        session.delete(target)
        session.commit()
        record_revision(
            session,
            entity_type="user",
            entity_uuid=target.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete user because it is referenced by other active resources.")
