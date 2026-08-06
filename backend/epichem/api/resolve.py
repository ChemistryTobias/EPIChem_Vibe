"""Shared "look up a registry row by UUID or short code" helper, used by
every read endpoint that takes a path identifier (§8.1's `{id}` path
segments — the plan's examples always show devices/samples/etc. addressed
by `id`, but every descriptor and every cross-reference in this system is
authored by `code`, so both are accepted).
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.errors import NotFoundProblem


def resolve_by_code_or_id(session: Session, model: type, ident: str):
    try:
        row = session.get(model, UUID(ident))
    except ValueError:
        row = None
    if row is None:
        row = session.execute(select(model).where(model.code == ident)).scalar_one_or_none()
    if row is None:
        raise NotFoundProblem(
            title=f"{model.__name__} not found",
            detail=f"No {model.__name__} with id or code {ident!r}",
        )
    return row
