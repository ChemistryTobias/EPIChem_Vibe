"""Samples and their event log (Roadmap 3, plan §7.3) -- deliberately minimal.

Flat fields in the spirit of ADR 0005: no composition list, containers or
lineage graph yet. What *is* here from §7.3 is the part that's cheap and makes
the tracker trustworthy: a sample's state and location are never edited
directly, only through `SampleEvent`s, so "where did SMP-2026-0041 go, and
who moved it" is always answerable. State is a validated plain string, not a
DB enum, like every enumerated field in this backend.
"""

from datetime import datetime, UTC
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database

SampleState = Literal[
    "registered",
    "staged",
    "reserved",
    "in_process",
    "processed",
    "characterized",
    "archived",
    "consumed",
    "disposed",
    "quarantined",
]

# Plan §7.3's lifecycle. Any live state can be quarantined; consumed and
# disposed are final.
TRANSITIONS: dict[str, set[str]] = {
    "registered": {"staged", "reserved", "disposed"},
    "staged": {"reserved", "registered"},
    "reserved": {"in_process", "staged", "registered"},
    "in_process": {"processed"},
    "processed": {"in_process", "characterized", "consumed", "disposed", "archived"},
    "characterized": {"in_process", "archived", "consumed", "disposed"},
    "archived": {"staged"},
    "quarantined": {"registered", "disposed"},
    "consumed": set(),
    "disposed": set(),
}
for _state, _next in TRANSITIONS.items():
    if _state not in ("consumed", "disposed", "quarantined"):
        _next.add("quarantined")


class SampleDB(Database):
    __tablename__ = "samples"
    __object_type__ = "sample"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, default=None)
    state: Mapped[str] = mapped_column(String(20), default="registered", index=True)
    substance: Mapped[Optional[str]] = mapped_column(String(200), default=None)
    amount_value: Mapped[Optional[float]] = mapped_column(Float, default=None)
    amount_unit: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    notes: Mapped[Optional[str]] = mapped_column(Text, default=None)
    # Derived from the latest event that named a station -- never set directly.
    station_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("stations.uuid"), index=True, default=None)
    owner_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("core_users.uuid"), default=None)
    # The workflow run that produced this sample, and the parameters it ran with.
    run_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("runs.uuid"), index=True, default=None)
    parameters: Mapped[Optional[dict]] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    events: Mapped[list["SampleEventDB"]] = relationship(
        back_populates="sample", order_by="SampleEventDB.at", cascade="all, delete-orphan"
    )


def utc_now() -> datetime:
    """Naive UTC with microseconds -- the same convention as the server-side
    `now()` stamps elsewhere, but fine-grained enough to order events that
    land within one second."""
    return datetime.now(UTC).replace(tzinfo=None)


class SampleEventDB(Database):
    """One state transition or custody change (plan §7.3's `SampleEvent`). Append-only."""

    __tablename__ = "sample_events"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    sample_uuid: Mapped[UUID] = mapped_column(ForeignKey("samples.uuid"), index=True)
    sample: Mapped[SampleDB] = relationship(back_populates="events")
    from_state: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    to_state: Mapped[str] = mapped_column(String(20))
    at: Mapped[datetime] = mapped_column(default=utc_now, index=True)
    actor_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("core_users.uuid"), default=None)
    run_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("runs.uuid"), default=None)
    station_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("stations.uuid"), default=None)
    reason: Mapped[Optional[str]] = mapped_column(Text, default=None)


class SampleEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    from_state: Optional[str] = None
    to_state: str
    at: datetime
    actor_uuid: Optional[UUID] = None
    run_uuid: Optional[UUID] = None
    station_uuid: Optional[UUID] = None
    reason: Optional[str] = None


class SampleFields(BaseModel):
    """What a person may write. State, location and run linkage aren't here on purpose."""

    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    substance: Optional[str] = Field(default=None, max_length=200)
    amount_value: Optional[float] = Field(default=None, ge=0)
    amount_unit: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = None


class Sample(SampleFields):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    code: str
    state: SampleState
    station_uuid: Optional[UUID] = None
    owner_uuid: Optional[UUID] = None
    run_uuid: Optional[UUID] = None
    parameters: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class SampleDetail(Sample):
    events: list[SampleEvent] = Field(default_factory=list)


class CreateSample(SampleFields):
    station_uuid: Optional[UUID] = Field(default=None, description="Where it is registered, if anywhere.")


class UpdateSample(SampleFields):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)


class CreateSampleEvent(BaseModel):
    to_state: SampleState
    reason: Optional[str] = None
    station_uuid: Optional[UUID] = Field(default=None, description="The station it moved to, if it moved.")
