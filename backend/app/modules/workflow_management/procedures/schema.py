"""A procedure: an ordered list of steps (Roadmap 2.1, plan §9.1 and §9.4's orchestrator level).

A step is either a plan call on a station (`type: plan`) or a flow-control
step EPIChem itself carries out between plans (plan §9.4's orchestrator and
human-in-the-loop rows): `wait` (a pause), `input` (an operator prompt the run
blocks on), `http` (call an external API, e.g. a notifier or an optimiser).
Steps may target different stations; consecutive plan steps on one station
are dispatched to its queue together.

Still linear on purpose -- no branches or loops (plan §9.4's codegen tier)
until a real procedure needs them.
`version` bumps whenever the steps change; a Run freezes the compiled items it
dispatched, so a run stays reconstructible even after its procedure is edited
(the plan's "never mutate a published version", met per-run rather than by a
ProcedureVersion table).
"""

from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database
from app.core.shared_schema.object.schema import CreateObject, Object, ObjectDB, UpdateObject


StepType = Literal["plan", "wait", "input", "http"]


class ProcedureStep(BaseModel):
    """One step. `id` is the client's stable handle for the node -- what
    diagnostics point at, what lands in the queue item's metadata, and what
    later steps reference (`{{steps.<id>.<field>}}`).

    `kwargs` holds a plan's arguments, or a control step's settings:
    wait `{duration_s}`, input `{prompt, fields: [{name, label, type, required}]}`,
    http `{method, url, body, expect_status}`.
    """

    id: str = Field(min_length=1, max_length=64)
    type: StepType = "plan"
    plan: str = Field(default="", max_length=100)
    station_uuid: Optional[UUID] = Field(default=None, description="Plan steps: where it runs; unset = the procedure's station.")
    kwargs: dict[str, Any] = Field(default_factory=dict)
    label: Optional[str] = Field(default=None, max_length=100)
    position: Optional[tuple[float, float]] = Field(default=None, description="Canvas position; layout only.")


class ProcedureDB(ObjectDB, Database):
    __tablename__ = "procedures"
    __object_type__ = "procedure"

    station_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("stations.uuid"), index=True, default=None)
    steps: Mapped[list[dict]] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)


class ProcedureBase(BaseModel):
    station_uuid: Optional[UUID] = Field(default=None, description="The default station for plan steps that name none.")


class Procedure(Object, ProcedureBase):
    model_config = ConfigDict(from_attributes=True)

    steps: list[ProcedureStep] = Field(default_factory=list)
    version: int


class CreateProcedure(CreateObject, ProcedureBase):
    steps: list[ProcedureStep] = Field(default_factory=list)


class UpdateProcedure(UpdateObject, ProcedureBase):
    steps: Optional[list[ProcedureStep]] = None


class Diagnostic(BaseModel):
    """One validation finding (plan §9.3). `step_id` None means the procedure as a whole."""

    severity: Literal["error", "warning"]
    message: str
    step_id: Optional[str] = None
    parameter: Optional[str] = None


class ValidateRequest(BaseModel):
    station_uuid: Optional[UUID] = None
    steps: list[ProcedureStep] = Field(default_factory=list)


class ValidationResult(BaseModel):
    valid: bool
    diagnostics: list[Diagnostic]
