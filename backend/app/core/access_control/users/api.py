from uuid import UUID

from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from fastapi import APIRouter, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .logic import hash_password
from .schema import CreateUser, User, UserDB, UpdateUser

router = APIRouter(prefix="/users", tags=["users"])


# --- GET ---------------------------------------------------------------------
@router.get("")
def get_all_users(session: SessionDepends, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0):
    """List all users."""
    return paginate(session.query(UserDB), response, limit, offset)


@router.get("/{identifier}", response_model=User)
def get_user(identifier: str, session: SessionDepends):
    """Get a single user by its UUID or name."""
    try:
        user = session.get(UserDB, UUID(identifier))
    except ValueError:
        user = session.query(UserDB).filter_by(name=identifier).first()
    if user is None:
        raise HTTPException(status_code=404, detail="No user found with the given UUID or name.")
    return user


# --- POST --------------------------------------------------------------------
@router.post("", response_model=User, status_code=201)
def create_user(body: CreateUser, session: SessionDepends):
    """Create a new user."""
    data = body.model_dump(exclude={"password"}, exclude_none=True)
    user = UserDB(**data, password_hash=hash_password(body.password))
    try:
        session.add(user)
        session.commit()
        session.refresh(user)
        return user
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="User with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/{identifier}", response_model=User)
def patch_user(identifier: str, body: UpdateUser, session: SessionDepends):
    """Partially update a user."""
    update_data = body.model_dump(exclude_unset=True, exclude={"password"})
    user = get_user(identifier, session)

    if body.password is not None:
        user.password_hash = hash_password(body.password)
    elif not update_data:
        return user

    for key, value in update_data.items():
        setattr(user, key, value)

    try:
        session.commit()
        session.refresh(user)
        return user
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="User with the same identifier (UUID or name) already exists.")


# --- DELETE ------------------------------------------------------------------
@router.delete("/{identifier}", status_code=204)
def delete_user(identifier: str, session: SessionDepends):
    """Delete a user by UUID or name."""
    user = get_user(identifier, session)
    try:
        session.delete(user)
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete user because it is referenced by other active resources.")
