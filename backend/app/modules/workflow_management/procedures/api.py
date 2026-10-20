"""Procedures: CRUD, plus validate and compile against the target station (Roadmap 2.1/2.2, plan §9)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision
from app.modules.device_managment.station.schema import StationDB
from app.modules.workflow_management.queueserver.logic import client_for

from .logic import compile_steps, validate_steps
from .schema import (
    CreateProcedure,
    Diagnostic,
    Procedure,
    ProcedureDB,
    ProcedureStep,
    UpdateProcedure,
    ValidateRequest,
    ValidationResult,
)

router = APIRouter(tags=["workflows"])

CurrentUser = Annotated[User, Depends(get_current_user)]


def _record(session, procedure: ProcedureDB, action: str, user: User, snapshot: dict | None = None) -> None:
    record_revision(
        session,
        entity_type=ProcedureDB.__object_type__,
        entity_uuid=procedure.uuid,
        action=action,
        snapshot=snapshot or Procedure.model_validate(procedure).model_dump(mode="json"),
        actor_uuid=user.uuid,
    )


def validate_for_station(session, station_uuid: UUID | None, steps: list[ProcedureStep]) -> list[Diagnostic]:
    """Every tier we can check, against what the station's pod offers right now."""
    if station_uuid is None:
        return [Diagnostic(severity="error", message="Choose the station this procedure runs on.")]
    station = session.get(StationDB, station_uuid)
    if station is None:
        return [Diagnostic(severity="error", message="The chosen station no longer exists.")]
    if not station.queueserver_url:
        return [Diagnostic(severity="error", message=f"Station '{station.name}' has no queueserver URL.")]
    from app.modules.workflow_management.queueserver.api import registered_ophyd_names

    client = client_for(station.queueserver_url)
    return validate_steps(
        steps, client.plans_allowed(), client.devices_allowed(), registered_ophyd_names(session, station.uuid)
    )


# --- GET ---------------------------------------------------------------------
@router.get("/procedures")
def get_all_procedures(
    session: SessionDepends, user: CurrentUser, response: Response, limit: LimitParam = 50, offset: OffsetParam = 0
):
    """List all procedures."""
    return paginate(session.query(ProcedureDB).order_by(ProcedureDB.name), response, limit, offset)


@router.get("/procedures/{identifier}", response_model=Procedure)
def get_procedure(identifier: str, session: SessionDepends, user: CurrentUser):
    """Get a single procedure by its UUID or name."""
    try:
        procedure = session.get(ProcedureDB, UUID(identifier))
    except ValueError:
        procedure = session.query(ProcedureDB).filter_by(name=identifier).first()
    if procedure is None:
        raise HTTPException(status_code=404, detail="No procedure found with the given UUID or name.")
    return procedure


# --- POST --------------------------------------------------------------------
@router.post("/procedures", response_model=Procedure, status_code=201)
def create_procedure(body: CreateProcedure, session: SessionDepends, user: CurrentUser):
    """Create a procedure. It needn't be valid yet -- drafts are saved as they are."""
    data = body.model_dump(exclude_none=True)
    data["steps"] = [step.model_dump(mode="json") for step in body.steps]  # the JSON column wants plain data
    procedure = ProcedureDB(**data)
    try:
        session.add(procedure)
        session.commit()
        session.refresh(procedure)
        _record(session, procedure, "created", user)
        session.commit()
        return procedure
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="A procedure with that name already exists.")


@router.post("/procedures/validate", response_model=ValidationResult)
def validate_procedure(body: ValidateRequest, session: SessionDepends, user: CurrentUser):
    """Validate steps -- saved or not -- against a station. Diagnostics point at step ids."""
    diagnostics = validate_for_station(session, body.station_uuid, body.steps)
    return ValidationResult(valid=not any(d.severity == "error" for d in diagnostics), diagnostics=diagnostics)


@router.get("/procedures/{identifier}/compile")
def compile_procedure(identifier: str, session: SessionDepends, user: CurrentUser) -> dict[str, Any]:
    """Preview the queue items a run of this procedure would dispatch (plan §13's compile preview)."""
    procedure = get_procedure(identifier, session, user)
    steps = [ProcedureStep.model_validate(s) for s in procedure.steps]
    meta = {"procedure": str(procedure.uuid), "procedure_version": procedure.version, "run": "<run uuid>", "sample": "<sample uuid>"}
    return {"items": compile_steps(steps, meta)}


# --- PATCH -------------------------------------------------------------------
@router.patch("/procedures/{identifier}", response_model=Procedure)
def patch_procedure(identifier: str, body: UpdateProcedure, session: SessionDepends, user: CurrentUser):
    """Partially update a procedure. Changing the steps bumps its version."""
    update = body.model_dump(exclude_unset=True)
    if "steps" in update:
        update["steps"] = [step.model_dump(mode="json") for step in body.steps or []]
    procedure = get_procedure(identifier, session, user)
    if not update:
        return procedure
    if "steps" in update and update["steps"] != procedure.steps:
        procedure.version += 1
    for key, value in update.items():
        setattr(procedure, key, value)
    try:
        session.commit()
        session.refresh(procedure)
        _record(session, procedure, "updated", user)
        session.commit()
        return procedure
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="A procedure with that name already exists.")


# --- DELETE ------------------------------------------------------------------
@router.delete("/procedures/{identifier}", status_code=204)
def delete_procedure(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a procedure. Refused once it has runs -- they point back at it."""
    procedure = get_procedure(identifier, session, user)
    snapshot = Procedure.model_validate(procedure).model_dump(mode="json")
    try:
        session.delete(procedure)
        session.commit()
        _record(session, procedure, "deleted", user, snapshot)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="This procedure has runs, so it can't be deleted.")
