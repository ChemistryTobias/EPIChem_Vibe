"""Shared "look up a registry row by UUID or short code" helper, used by
every read endpoint that takes a path identifier (§8.1's `{id}` path
segments — the plan's examples always show devices/samples/etc. addressed
by `id`, but every descriptor and every cross-reference in this system is
authored by `code`, so both are accepted). `key_attr` defaults to `code`
since that's the natural key for every kind except `CapabilityClass`, which
has no `code` column and is matched by `name` instead (models/capability.py).

The write-path counterpart — resolving a topology parent code to its FK id —
lives in `epichem.importer.resolve_parent_id` instead, since it's shared
with the YAML import path; see that module's docstring.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.errors import NotFoundProblem


def resolve_by_natural_key_or_id(
    session: Session, model: type, ident: str, key_attr: str = "code"
):
    try:
        row = session.get(model, UUID(ident))
    except ValueError:
        row = None
    if row is None:
        row = session.execute(
            select(model).where(getattr(model, key_attr) == ident)
        ).scalar_one_or_none()
    if row is None:
        raise NotFoundProblem(
            title=f"{model.__name__} not found",
            detail=f"No {model.__name__} with id or {key_attr} {ident!r}",
        )
    return row


def resolve_by_code_or_id(session: Session, model: type, ident: str):
    return resolve_by_natural_key_or_id(session, model, ident, key_attr="code")
