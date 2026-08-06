"""Revision model (ADR 0004): a single, kind-agnostic table recording a
full-snapshot version history for every registry entity (Site, Lab, ...,
Device, CapabilityClass), mirroring Kadi4Mat's Revision/create_revision()
design cited in the ADR — full JSON snapshot per write, not a diff/patch
log. `entity_type`/`entity_id` are plain columns rather than a polymorphic
FK because `entity_id` can point into any of 8 different tables.
"""

import uuid as uuid_mod
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from epichem.idgen import uuid7
from epichem.models.base import Base


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id", "revision_number", name="uq_revision_entity_number"
        ),
        Index("ix_revisions_entity_type_id", "entity_type", "entity_id"),
    )

    id: Mapped[uuid_mod.UUID] = mapped_column(primary_key=True, default=uuid7)
    entity_type: Mapped[str]
    entity_id: Mapped[uuid_mod.UUID]
    revision_number: Mapped[int]
    action: Mapped[str]  # "created" | "updated" | "deleted"
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Nullable: no auth/identity system exists yet (ADR 0004 decision 4).
    created_by: Mapped[str | None] = mapped_column(default=None)
