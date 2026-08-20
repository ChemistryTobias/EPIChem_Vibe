"""Generic, cross-entity change log -- one row per create/update/delete on
any entity in this app, keyed by (entity_type, entity_uuid) rather than a
per-entity table (mirrors the old backend's Revision design, see
docs/PROJECT_HISTORY.md's "database is the source of truth" decision).

This is a simple starting version, not that full design: `record_revision`
below is ready to be called from an entity's api.py, but nothing calls it
yet -- no existing device-management route writes a revision. Wiring that in
is a separate, deliberately deferred step (see CLAUDE.md/the Roadmap).
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict
from sqlalchemy import JSON, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class RevisionDB(Database):
    __tablename__ = "core_revisions"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_uuid: Mapped[UUID] = mapped_column(index=True)
    action: Mapped[str] = mapped_column(String(20))  # "created" | "updated" | "deleted"
    snapshot: Mapped[dict] = mapped_column(JSON)
    # String FK target, not an imported UserDB -- same reasoning as
    # app.core.auth.schema.AuthTokenDB.
    actor_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("core_users.uuid"), default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Revision(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    entity_type: str
    entity_uuid: UUID
    action: str
    snapshot: dict[str, Any]
    actor_uuid: Optional[UUID] = None
    created_at: datetime
