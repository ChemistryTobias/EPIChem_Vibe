"""A run: one dispatch of a procedure to its station (plan §5.3, Roadmap 2.2's scheduler layer).

The run freezes what it sent -- the procedure version and the exact compiled
queue items -- so it can be reconstructed whatever happens to the procedure
afterwards. Its state is *observed*, synced from the station's queueserver
(which is what actually executes), never decided here.
"""

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database

RunState = Literal["queued", "running", "completed", "failed", "stopped", "unknown"]
TERMINAL_STATES = {"completed", "failed", "stopped"}

# Per item: "pending" | "running" | "removed" | "missing", or the queueserver's
# own exit status once it's in history: "completed" | "failed" | "stopped" |
# "aborted" | "halted" | "unknown".
ITEM_FAILURES = {"failed", "aborted", "halted"}


class RunDB(Database):
    __tablename__ = "runs"
    __object_type__ = "run"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    procedure_uuid: Mapped[UUID] = mapped_column(ForeignKey("procedures.uuid"), index=True)
    procedure_name: Mapped[str] = mapped_column(String(50))
    procedure_version: Mapped[int] = mapped_column(Integer)
    station_uuid: Mapped[UUID] = mapped_column(ForeignKey("stations.uuid"), index=True)
    state: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    items: Mapped[list[dict]] = mapped_column(JSON, default=list)
    error: Mapped[Optional[str]] = mapped_column(Text, default=None)
    sync_error: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_by: Mapped[Optional[UUID]] = mapped_column(ForeignKey("core_users.uuid"), default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    finished_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class RunItem(BaseModel):
    step_id: str
    plan: str
    kwargs: dict[str, Any] = Field(default_factory=dict)
    item_uid: Optional[str] = None
    status: str = "pending"
    run_uids: list[str] = Field(default_factory=list)
    message: Optional[str] = None
    time_start: Optional[float] = None
    time_stop: Optional[float] = None


class Run(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    code: str
    procedure_uuid: UUID
    procedure_name: str
    procedure_version: int
    station_uuid: UUID
    state: RunState
    items: list[RunItem]
    error: Optional[str] = None
    sync_error: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    sample_uuids: list[UUID] = Field(default_factory=list)


class NewRunSample(BaseModel):
    """What the sample this run produces is called and made of. All optional --
    a run registers a sample either way."""

    name: Optional[str] = Field(default=None, max_length=100)
    substance: Optional[str] = Field(default=None, max_length=200)
    amount_value: Optional[float] = Field(default=None, ge=0)
    amount_unit: Optional[str] = Field(default=None, max_length=20)
    description: Optional[str] = None


class CreateRun(BaseModel):
    procedure_uuid: UUID
    sample: NewRunSample = Field(default_factory=NewRunSample)
    autostart: bool = Field(default=True, description="Start the station's queue right after dispatch.")
