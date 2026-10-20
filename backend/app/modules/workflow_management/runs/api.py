"""Runs: launch a procedure, run one plan by hand, answer an input step, stop (Roadmap 2.2 + 3).

Launching validates every step against its station, registers the sample the
run will produce, and hands the first block of plan steps to its station; the
orchestrator (`orchestrator.py`) takes it from there. If the first station
refuses, nothing is recorded -- no run, no sample -- because nothing happened.
"""

from typing import Annotated, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam
from app.core.revisions.logic import record_revision
from app.modules.device_managment.station.api import get_station
from app.modules.sample_tracking.samples.api import record_sample
from app.modules.sample_tracking.samples.logic import next_code, register, transition
from app.modules.sample_tracking.samples.schema import SampleDB
from app.modules.workflow_management.procedures.api import get_procedure, validate_procedure_steps
from app.modules.workflow_management.procedures.schema import ProcedureStep, connected

from . import orchestrator
from .schema import TERMINAL_STATES, CreateRun, InputAnswer, ManualRun, Run, RunDB

router = APIRouter(tags=["workflows"])

CurrentUser = Annotated[User, Depends(get_current_user)]

# Which sample state follows from which run state (plan §7.3). Automatic
# transitions walk the lifecycle in order, so a run that went from queued to
# completed between two looks still logs in_process first.
SAMPLE_STATE_FOR_RUN = {"running": "in_process", "waiting": "in_process", "completed": "processed", "failed": "quarantined", "stopped": "quarantined"}
SAMPLE_PATH = {"processed": ["in_process", "processed"]}


def _out(session, run: RunDB) -> Run:
    out = Run.model_validate(run)
    out.sample_uuids = [s for (s,) in session.query(SampleDB.uuid).filter_by(run_uuid=run.uuid)]
    return out


def _record(session, run: RunDB, action: str, actor_uuid) -> None:
    record_revision(
        session,
        entity_type=RunDB.__object_type__,
        entity_uuid=run.uuid,
        action=action,
        snapshot=_out(session, run).model_dump(mode="json"),
        actor_uuid=actor_uuid,
    )


def follow_samples(session, run: RunDB, actor_uuid) -> None:
    """The run's sample follows its state (plan §7.3)."""
    target = SAMPLE_STATE_FOR_RUN.get(run.state)
    if target:
        reason = f"run {run.code} {run.state}" + (f": {run.error}" if run.error and run.state == "failed" else "")
        for sample in session.query(SampleDB).filter_by(run_uuid=run.uuid):
            moved = False
            for state in SAMPLE_PATH.get(target, [target]):
                if sample.state != state:
                    moved |= transition(
                        session, sample, state, actor_uuid=actor_uuid, reason=reason,
                        run_uuid=run.uuid, station_uuid=run.station_uuid, strict=False,
                    ) is not None
            if moved:
                record_sample(session, sample, "updated", actor_uuid)


def on_run_changed(session, run: RunDB, actor_uuid) -> None:
    """After a run moved: its sample follows, and a revision records it."""
    follow_samples(session, run, actor_uuid)
    _record(session, run, "updated", actor_uuid)


def _advance(session, run: RunDB, actor_uuid) -> None:
    before = (run.state, run.items)
    orchestrator.advance(run, orchestrator.Stations(session))
    if (run.state, run.items) != before:
        on_run_changed(session, run, actor_uuid)
    session.commit()


def _items_for(steps: list[ProcedureStep], default_station) -> list[dict]:
    return [
        {
            "step_id": s.id,
            "type": s.type,
            "plan": s.plan,
            "label": s.label,
            "station_uuid": str(s.station_uuid or default_station) if s.type == "plan" else None,
            "kwargs": s.kwargs,
            "item_uid": None,
            "status": "pending",
        }
        for s in steps
    ]


def _validated(session, steps: list[ProcedureStep], default_station) -> None:
    errors = [d for d in validate_procedure_steps(session, steps, default_station) if d.severity == "error"]
    if errors:
        raise HTTPException(
            status_code=422,
            detail="The procedure doesn't validate: "
            + "; ".join((f"[{d.step_id}] " if d.step_id else "") + d.message for d in errors),
        )


def _start(session, run: RunDB) -> None:
    """Dispatch the first block now -- a refusal aborts the whole launch (502)."""
    orchestrator.advance(run, orchestrator.Stations(session), raise_dispatch=True)


# --- GET ---------------------------------------------------------------------
@router.get("/runs", response_model=list[Run])
def get_all_runs(
    session: SessionDepends,
    user: CurrentUser,
    response: Response,
    station_uuid: Optional[UUID] = None,
    procedure_uuid: Optional[UUID] = None,
    kind: Optional[str] = None,
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
):
    """List runs, newest first. State is kept current by the orchestrator."""
    query = session.query(RunDB).order_by(RunDB.created_at.desc(), RunDB.code.desc())
    if station_uuid:
        query = query.filter_by(station_uuid=station_uuid)
    if procedure_uuid:
        query = query.filter_by(procedure_uuid=procedure_uuid)
    if kind:
        query = query.filter_by(kind=kind)
    response.headers["X-Total-Count"] = str(query.count())
    return [_out(session, run) for run in query.offset(offset).limit(limit).all()]


def _get(identifier: str, session) -> RunDB:
    try:
        run = session.get(RunDB, UUID(identifier))
    except ValueError:
        run = session.query(RunDB).filter_by(code=identifier).first()
    if run is None:
        raise HTTPException(status_code=404, detail="No run found with the given UUID or code.")
    return run


@router.get("/runs/{identifier}", response_model=Run)
def get_run(identifier: str, session: SessionDepends, user: CurrentUser):
    """One run by UUID or code."""
    return _out(session, _get(identifier, session))


# --- POST --------------------------------------------------------------------
@router.post("/runs", response_model=Run, status_code=201)
def create_run(body: CreateRun, session: SessionDepends, user: CurrentUser):
    """Validate, register the run's sample, and start it."""
    procedure = get_procedure(str(body.procedure_uuid), session, user)
    steps = connected([ProcedureStep.model_validate(s) for s in procedure.steps])
    _validated(session, steps, procedure.station_uuid)
    items = _items_for(steps, procedure.station_uuid)
    first_station = next((i["station_uuid"] for i in items if i["station_uuid"]), None)

    with orchestrator.RUN_LOCK:
        run = RunDB(
            uuid=uuid4(),
            code=next_code(session, RunDB, "RUN"),
            kind="procedure",
            procedure_uuid=procedure.uuid,
            procedure_name=procedure.name,
            procedure_version=procedure.version,
            station_uuid=UUID(first_station) if first_station else None,
            state="queued",
            items=items,
            created_by=user.uuid,
        )
        sample_uuid = uuid4()
        sample_code = next_code(session, SampleDB, "SMP")
        for item in run.items:
            item["meta"] = {"sample": str(sample_uuid), "sample_code": sample_code, "operator": user.name}
        _start(session, run)  # raises (502) -> nothing recorded

        session.add(run)
        session.flush()
        given = body.sample.model_dump(exclude_none=True)
        sample = SampleDB(
            uuid=sample_uuid,
            code=sample_code,
            name=given.pop("name", None) or f"{procedure.name} — {run.code}",
            owner_uuid=user.uuid,
            run_uuid=run.uuid,
            parameters={
                "procedure_version": procedure.version,
                "steps": [s.model_dump(mode="json", include={"id", "type", "plan", "kwargs"}) for s in steps],
            },
            **given,
        )
        session.add(sample)
        session.flush()
        register(session, sample, actor_uuid=user.uuid, reason=f"created by run {run.code}", run_uuid=run.uuid, station_uuid=run.station_uuid)
        transition(session, sample, "reserved", actor_uuid=user.uuid, reason="run queued", run_uuid=run.uuid, station_uuid=run.station_uuid)
        follow_samples(session, run, user.uuid)
        session.commit()
        session.refresh(sample)
        record_sample(session, sample, "created", user.uuid)
        _record(session, run, "created", user.uuid)
        session.commit()
        return _out(session, run)


@router.post("/stations/{identifier}/execution/run", response_model=Run, status_code=201)
def run_manual(identifier: str, body: ManualRun, session: SessionDepends, user: CurrentUser):
    """Run one plan on this station now (behind anything already queued there).
    Recorded as a manual run; it registers no sample."""
    station = get_station(identifier, session, user)
    step = ProcedureStep(id="manual", type="plan", plan=body.plan, station_uuid=station.uuid, kwargs=body.kwargs)
    _validated(session, [step], station.uuid)
    with orchestrator.RUN_LOCK:
        run = RunDB(
            uuid=uuid4(),
            code=next_code(session, RunDB, "RUN"),
            kind="manual",
            procedure_name=body.plan,
            station_uuid=station.uuid,
            state="queued",
            items=_items_for([step], station.uuid),
            created_by=user.uuid,
        )
        for item in run.items:
            item["meta"] = {"operator": user.name, "manual": True}
        _start(session, run)
        session.add(run)
        session.commit()
        _record(session, run, "created", user.uuid)
        session.commit()
        return _out(session, run)


@router.post("/runs/{identifier}/input", response_model=Run)
def answer_input(identifier: str, body: InputAnswer, session: SessionDepends, user: CurrentUser):
    """Answer the input step a run is waiting on; the run carries on."""
    with orchestrator.RUN_LOCK:
        run = _get(identifier, session)
        items = [dict(i) for i in run.items]
        item = next((i for i in items if i["step_id"] == body.step_id), None)
        if item is None or item["status"] != "waiting_input":
            raise HTTPException(status_code=409, detail="That step isn't waiting for input.")
        values = {}
        for field in item["kwargs"].get("fields") or []:
            name, kind = field["name"], field.get("type", "text")
            value = body.values.get(name)
            if value in (None, "") and kind != "boolean":
                if field.get("required"):
                    raise HTTPException(status_code=422, detail=f"'{field.get('label') or name}' is required.")
                values[name] = None
                continue
            try:
                values[name] = float(value) if kind == "number" else bool(value) if kind == "boolean" else str(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"'{field.get('label') or name}' must be a number.") from None
        import time

        item.update(status="completed", output={**values, "answered_by": user.name}, time_stop=time.time())
        run.items = items
        _advance(session, run, user.uuid)
        return _out(session, run)


@router.post("/runs/{identifier}/stop", response_model=Run)
def stop_run(identifier: str, session: SessionDepends, user: CurrentUser):
    """Nothing new starts; a plan already running on a station finishes."""
    return _halt(identifier, session, user, abort=False)


@router.post("/runs/{identifier}/abort", response_model=Run)
def abort_run(identifier: str, session: SessionDepends, user: CurrentUser):
    """Stop *now*: also abort the plan running on a station."""
    return _halt(identifier, session, user, abort=True)


def _halt(identifier: str, session, user, *, abort: bool) -> Run:
    with orchestrator.RUN_LOCK:
        run = _get(identifier, session)
        if run.state not in TERMINAL_STATES:
            orchestrator.stop(run, orchestrator.Stations(session), abort=abort)
            _advance(session, run, user.uuid)
        return _out(session, run)
