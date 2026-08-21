from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .schema import group_membership


def add_member(session: Session, group_uuid: UUID, user_uuid: UUID) -> None:
    exists = session.execute(
        select(group_membership).where(
            group_membership.c.group_uuid == group_uuid,
            group_membership.c.user_uuid == user_uuid,
        )
    ).first()
    if exists is None:
        session.execute(group_membership.insert().values(group_uuid=group_uuid, user_uuid=user_uuid))


def remove_member(session: Session, group_uuid: UUID, user_uuid: UUID) -> None:
    session.execute(
        delete(group_membership).where(
            group_membership.c.group_uuid == group_uuid,
            group_membership.c.user_uuid == user_uuid,
        )
    )


def list_members(session: Session, group_uuid: UUID) -> list[UUID]:
    rows = session.execute(
        select(group_membership.c.user_uuid).where(group_membership.c.group_uuid == group_uuid)
    ).scalars().all()
    return list(rows)


def list_groups_for_user(session: Session, user_uuid: UUID) -> list[UUID]:
    rows = session.execute(
        select(group_membership.c.group_uuid).where(group_membership.c.user_uuid == user_uuid)
    ).scalars().all()
    return list(rows)
