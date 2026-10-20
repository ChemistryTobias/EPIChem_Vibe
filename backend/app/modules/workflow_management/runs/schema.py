"""A run: one execution of a procedure, or one manual action on a station (plan §5.3, Roadmap 2.2).

The run freezes what it was asked to do -- the procedure version and every
step with its arguments -- so it can be reconstructed whatever happens to the
procedure afterwards. EPIChem's orchestrator (`orchestrator.py`) walks the
steps: plan steps go to their station's queue (which executes them), control
steps (wait, input, http) EPIChem carries out itself. Plan steps' state is
*observed* from the stations, never decided here.
"""

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database

RunState = Literal["queued", "running", "waiting", "completed", "failed", "stopped", "unknown"]
TERMINAL_STATES = {"completed", "failed", "stopped"}

# Item status. Plan items: "pending" (not sent yet) -> "queued" (in the station's
# queue) -> "running" -> the queueserver's exit status ("completed" | "failed" |
# "stopped" | "aborted" | "halted" | "unknown"), or "missing" if the station lost
# it. Control items: "pending" -> "running" / "waiting_input" -> "completed" |
# "failed". Stop/abort: "removed" (taken off a queue), "stopped", "skipped".
ITEM_FAILURES = {"failed", "aborted", "halted"}
ITEM_HALTS = {"removed", "stopped", "skipped", "missing", "unknown"}


class RunDB(Database):
    __tablename__ = "runs"
    __object_type__ = "run"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="procedure")  # "procedure" | "manual"
    procedure_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("procedures.uuid"), index=True, default=None)
    procedure_name: Mapped[str] = mapped_column(String(100))
    procedure_version: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    # The first station it touches -- for listing; each item names its own.
    station_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("stations.uuid"), index=True, default=None)
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
    type: str = "plan"
    plan: str = ""
    label: Optional[str] = None
    station_uuid: Optional[UUID] = None
    kwargs: dict[str, Any] = Field(default_factory=dict)
    item_uid: Optional[str] = None
    status: str = "pending"
    run_uids: list[str] = Field(default_factory=list)
    message: Optional[str] = None
    time_start: Optional[float] = None
    time_stop: Optional[float] = None
    # What the step produced, for later steps' `{{steps.<id>.…}}`: an input's
    # values, an HTTP response, a plan's run uids.
    output: Optional[dict[str, Any]] = None


class Run(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    code: str
    kind: str
    procedure_uuid: Optional[UUID] = None
    procedure_name: str
    procedure_version: Optional[int] = None
    station_uuid: Optional[UUID] = None
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
    a procedure run registers a sample either way."""

    name: Optional[str] = Field(default=None, max_length=100)
    substance: Optional[str] = Field(default=None, max_length=200)
    amount_value: Optional[float] = Field(default=None, ge=0)
    amount_unit: Optional[str] = Field(default=None, max_length=20)
    description: Optional[str] = None


class CreateRun(BaseModel):
    procedure_uuid: UUID
    sample: NewRunSample = Field(default_factory=NewRunSample)


class ManualRun(BaseModel):
    """One plan, run now on one station -- Device Monitoring's actions."""

    plan: str = Field(min_length=1, max_length=100)
    kwargs: dict[str, Any] = Field(default_factory=dict)


class InputAnswer(BaseModel):
    step_id: str
    values: dict[str, Any] = Field(default_factory=dict)
