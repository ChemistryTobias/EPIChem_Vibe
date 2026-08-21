"""Generic cross-entity change log, keyed by (entity_type, entity_uuid) -- a simple start, not the old backend's full audit trail."""

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
    actor_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("core_users.uuid"), default=None)  # string FK, no import of UserDB
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
