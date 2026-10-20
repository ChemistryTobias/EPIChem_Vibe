"""Procedures: CRUD, plus validate and compile against the target station (Roadmap 2.1/2.2, plan §9)."""

from typing import Annotated, Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
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


def gather_palettes(session, steps: list[ProcedureStep], default_station: UUID | None) -> dict[UUID, dict[str, Any]]:
    """What each station the plan steps use offers right now -- one pod read per station."""
    from app.modules.workflow_management.queueserver.api import registered_ophyd_names
    from app.modules.workflow_management.queueserver.logic import QueueserverError

    palettes: dict[UUID, dict[str, Any]] = {}
    for station_uuid in {s.station_uuid or default_station for s in steps if s.type == "plan"} - {None}:
        station = session.get(StationDB, station_uuid)
        if station is None:
            palettes[station_uuid] = {"error": "That station no longer exists."}
        elif not station.queueserver_url:
            palettes[station_uuid] = {"error": f"Station '{station.name}' has no queueserver URL."}
        else:
            try:
                client = client_for(station.queueserver_url)
                palettes[station_uuid] = {
                    "plans": client.plans_allowed(),
                    "devices": client.devices_allowed(),
                    "registered": registered_ophyd_names(session, station.uuid),
                }
            except QueueserverError as exc:
                palettes[station_uuid] = {"error": f"Station '{station.name}': {exc.detail}"}
    return palettes


def validate_procedure_steps(session, steps: list[ProcedureStep], default_station: UUID | None) -> list[Diagnostic]:
    return validate_steps(steps, gather_palettes(session, steps, default_station), default_station)


# --- GET ---------------------------------------------------------------------
@router.get("/procedures")
def get_all_procedures(
    session: SessionDepends,
    user: CurrentUser,
    response: Response,
    q: Optional[str] = None,
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
):
    """List procedures by name, optionally searching name and description."""
    query = session.query(ProcedureDB).order_by(ProcedureDB.name)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(ProcedureDB.name.ilike(like), ProcedureDB.description.ilike(like)))
    return paginate(query, response, limit, offset)


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
    diagnostics = validate_procedure_steps(session, body.steps, body.station_uuid)
    return ValidationResult(valid=not any(d.severity == "error" for d in diagnostics), diagnostics=diagnostics)


@router.get("/procedures/{identifier}/compile")
def compile_procedure(identifier: str, session: SessionDepends, user: CurrentUser) -> dict[str, Any]:
    """Preview the queue items a run of this procedure would dispatch (plan §13's compile preview)."""
    procedure = get_procedure(identifier, session, user)
    steps = [ProcedureStep.model_validate(s) for s in procedure.steps]
    meta = {"procedure": str(procedure.uuid), "procedure_version": procedure.version, "run": "<run uuid>", "sample": "<sample uuid>"}
    return {"items": compile_steps(steps, meta)}


@router.post("/procedures/{identifier}/duplicate", response_model=Procedure, status_code=201)
def duplicate_procedure(identifier: str, session: SessionDepends, user: CurrentUser):
    """A copy under a free name ("… (copy)", "… (copy 2)"), at version 1."""
    original = get_procedure(identifier, session, user)
    taken = {name for (name,) in session.query(ProcedureDB.name)}
    base = f"{original.name[:40]} (copy"
    name, n = f"{base})", 2
    while name in taken:
        name, n = f"{base} {n})", n + 1
    copy = ProcedureDB(
        name=name, description=original.description, station_uuid=original.station_uuid, steps=list(original.steps)
    )
    session.add(copy)
    session.commit()
    session.refresh(copy)
    _record(session, copy, "created", user)
    session.commit()
    return copy


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
