import uuid as uuid_mod
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from epichem.idgen import uuid7


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """§12.4: "Timestamp everything at every read/write"."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RegistryEntity(Base, TimestampMixin):
    """Shared shape for topology entities (§5.1): a UUIDv7 primary key plus
    the short human-readable code the plan requires alongside it
    (`DEV-HP-002`, `SMP-2026-0041`, ...).
    """

    __abstract__ = True

    id: Mapped[uuid_mod.UUID] = mapped_column(primary_key=True, default=uuid7)
    code: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
