from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from .schema import RevisionDB


def record_revision(
    session: Session,
    entity_type: str,
    entity_uuid: UUID,
    action: str,
    snapshot: dict[str, Any],
    actor_uuid: Optional[UUID] = None,
) -> RevisionDB:
    """Adds a revision row to `session` -- does not commit. Call this inside
    the same transaction as the write it's recording (before session.commit())
    so a rollback discards both together. Not called from anywhere yet (see
    module docstring in schema.py).
    """
    revision = RevisionDB(
        entity_type=entity_type,
        entity_uuid=entity_uuid,
        action=action,
        snapshot=snapshot,
        actor_uuid=actor_uuid,
    )
    session.add(revision)
    return revision
