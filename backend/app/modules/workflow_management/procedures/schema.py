"""A procedure: an ordered list of plan calls for one station (Roadmap 2.1, plan §9.1's fast path).

Linear on purpose -- a queue-item list can't branch or loop (plan §9.4), and
building the codegen tier before a real procedure needs it is premature.
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


class ProcedureStep(BaseModel):
    """One plan call. `id` is the client's stable handle for the node -- what
    diagnostics point at and what lands in the queue item's metadata."""

    id: str = Field(min_length=1, max_length=64)
    plan: str = Field(min_length=1, max_length=100)
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
    station_uuid: Optional[UUID] = None


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
