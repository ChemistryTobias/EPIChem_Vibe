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
    """Adds a revision row to `session`; caller commits. Not called from anywhere yet."""
    revision = RevisionDB(
        entity_type=entity_type,
        entity_uuid=entity_uuid,
        action=action,
        snapshot=snapshot,
        actor_uuid=actor_uuid,
    )
    session.add(revision)
    return revision
