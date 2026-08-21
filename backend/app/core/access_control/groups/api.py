from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from .logic import add_member, list_members, remove_member
from .schema import CreateGroup, Group, GroupDB, UpdateGroup

router = APIRouter(prefix="/groups", tags=["groups"])

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- GET ---------------------------------------------------------------------
@router.get("")
def get_all_groups(session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0):
    """List all groups."""
    return paginate(session.query(GroupDB), response, limit, offset)


@router.get("/{identifier}", response_model=Group)
def get_group(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single group by its UUID or name."""
    try:
        group = session.get(GroupDB, UUID(identifier))
    except ValueError:
        group = session.query(GroupDB).filter_by(name=identifier).first()
    if group is None:
        raise HTTPException(status_code=404, detail="No group found with the given UUID or name.")
    return group


# --- POST --------------------------------------------------------------------
@router.post("", response_model=Group, status_code=201)
def create_group(body: CreateGroup, session: SessionDepends, user: CurrentUser):
    """Create a new group."""
    group = GroupDB(**body.model_dump(exclude_none=True))
    try:
        session.add(group)
        session.commit()
        session.refresh(group)
        record_revision(
            session,
            entity_type="group",
            entity_uuid=group.uuid,
            action="created",
            snapshot=Group.model_validate(group).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return group
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Group with the same identifier (UUID or name) already exists.")


# --- PATCH -------------------------------------------------------------------
@router.patch("/{identifier}", response_model=Group)
def patch_group(identifier: str, body: UpdateGroup, session: SessionDepends, user: CurrentUser):
    """Partially update a group."""
    update_data = body.model_dump(exclude_unset=True)
    group = get_group(identifier, session, user)

    if not update_data:
        return group

    for key, value in update_data.items():
        setattr(group, key, value)

    try:
        session.commit()
        session.refresh(group)
        record_revision(
            session,
            entity_type="group",
            entity_uuid=group.uuid,
            action="updated",
            snapshot=Group.model_validate(group).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        return group
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Group with the same identifier (UUID or name) already exists.")


# --- DELETE ------------------------------------------------------------------
@router.delete("/{identifier}", status_code=204)
def delete_group(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a group by UUID or name."""
    group = get_group(identifier, session, user)
    snapshot = Group.model_validate(group).model_dump(mode="json")
    try:
        session.delete(group)
        session.commit()
        record_revision(
            session,
            entity_type="group",
            entity_uuid=group.uuid,
            action="deleted",
            snapshot=snapshot,
            actor_uuid=user.uuid,
        )
        session.commit()
        return None
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete group because it is referenced by other active resources.")


# --- membership ----------------------------------------------------------------
@router.post("/{identifier}/members/{user_uuid}", status_code=204)
def add_group_member(identifier: str, user_uuid: UUID, session: SessionDepends, user: CurrentUser):
    """Add a user to a group."""
    group = get_group(identifier, session, user)
    add_member(session, group.uuid, user_uuid)
    session.commit()


@router.delete("/{identifier}/members/{user_uuid}", status_code=204)
def remove_group_member(identifier: str, user_uuid: UUID, session: SessionDepends, user: CurrentUser):
    """Remove a user from a group."""
    group = get_group(identifier, session, user)
    remove_member(session, group.uuid, user_uuid)
    session.commit()


@router.get("/{identifier}/members", response_model=list[UUID])
def get_group_members(identifier: str, session: SessionDepends, user: CurrentUser):
    """List a group's member user UUIDs."""
    group = get_group(identifier, session, user)
    return list_members(session, group.uuid)
