"""Runs: launch a procedure on its station, watch it, stop it (Roadmap 2.2 + 3).

Launching validates against the station's live plans, registers the sample the
run will produce, compiles the procedure to queue items carrying both ids in
their metadata, and hands them to the station's queueserver. If the station
refuses, nothing is recorded -- no run, no sample -- because nothing happened.
"""

from collections import defaultdict
from typing import Annotated, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam
from app.core.revisions.logic import record_revision
from app.modules.device_managment.station.schema import StationDB
from app.modules.sample_tracking.samples.api import record_sample
from app.modules.sample_tracking.samples.logic import next_code, register, transition
from app.modules.sample_tracking.samples.schema import SampleDB
from app.modules.workflow_management.procedures.api import get_procedure
from app.modules.workflow_management.procedures.logic import compile_steps, validate_steps
from app.modules.workflow_management.procedures.schema import ProcedureStep
from app.modules.workflow_management.queueserver.logic import QueueserverError, client_for

from .logic import SAMPLE_STATE_FOR_RUN, apply_station_snapshot, leftover_uids
from .schema import TERMINAL_STATES, CreateRun, Run, RunDB

router = APIRouter(tags=["workflows"])

CurrentUser = Annotated[User, Depends(get_current_user)]

# Automatic sample transitions walk the lifecycle in order, so a run that went
# from queued to completed between two looks still logs in_process first.
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


def _station(session, run: RunDB) -> StationDB:
    station = session.get(StationDB, run.station_uuid)
    if station is None or not station.queueserver_url:
        raise HTTPException(status_code=409, detail="This run's station is no longer executable.")
    return station


def _follow_samples(session, run: RunDB, actor_uuid) -> None:
    target = SAMPLE_STATE_FOR_RUN.get(run.state)
    if target is None:
        return
    reason = f"run {run.code} {run.state}" + (f": {run.error}" if run.error and run.state == "failed" else "")
    for sample in session.query(SampleDB).filter_by(run_uuid=run.uuid):
        for state in SAMPLE_PATH.get(target, [target]):
            if sample.state != state:
                transition(
                    session, sample, state, actor_uuid=actor_uuid, reason=reason,
                    run_uuid=run.uuid, station_uuid=run.station_uuid, strict=False,
                )
        record_sample(session, sample, "updated", actor_uuid)


def sync_runs(session, runs: list[RunDB], actor_uuid) -> None:
    """Refresh every unfinished run from its station -- one read per station."""
    by_station: dict[UUID, list[RunDB]] = defaultdict(list)
    for run in runs:
        if run.state not in TERMINAL_STATES:
            by_station[run.station_uuid].append(run)
    for station_uuid, station_runs in by_station.items():
        station = session.get(StationDB, station_uuid)
        try:
            if station is None or not station.queueserver_url:
                raise QueueserverError("station is no longer executable")
            client = client_for(station.queueserver_url)
            queue, history = client.queue(), client.history()
        except QueueserverError as exc:
            for run in station_runs:
                run.sync_error = f"Couldn't read the station: {exc.detail}"
            session.commit()
            continue
        for run in station_runs:
            before = (run.state, run.items)
            run.sync_error = None
            apply_station_snapshot(run, queue, history)
            if run.state == "failed":
                # The station stops its queue on a failure; don't let this
                # run's remaining steps fire whenever it's next started.
                for uid in leftover_uids(run):
                    try:
                        client.remove_item(uid)
                    except QueueserverError:
                        pass
                apply_station_snapshot(run, client.queue(), history)
            if (run.state, run.items) != before:
                _follow_samples(session, run, actor_uuid)
                _record(session, run, "updated", actor_uuid)
        session.commit()


# --- GET ---------------------------------------------------------------------
@router.get("/runs", response_model=list[Run])
def get_all_runs(
    session: SessionDepends,
    user: CurrentUser,
    response: Response,
    station_uuid: Optional[UUID] = None,
    procedure_uuid: Optional[UUID] = None,
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
):
    """List runs, newest first, synced with their stations first."""
    query = session.query(RunDB).order_by(RunDB.created_at.desc(), RunDB.code.desc())
    if station_uuid:
        query = query.filter_by(station_uuid=station_uuid)
    if procedure_uuid:
        query = query.filter_by(procedure_uuid=procedure_uuid)
    response.headers["X-Total-Count"] = str(query.count())
    runs = query.offset(offset).limit(limit).all()
    sync_runs(session, runs, user.uuid)
    return [_out(session, run) for run in runs]


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
    """One run by UUID or code, synced with its station first."""
    run = _get(identifier, session)
    sync_runs(session, [run], user.uuid)
    return _out(session, run)


# --- POST --------------------------------------------------------------------
@router.post("/runs", response_model=Run, status_code=201)
def create_run(body: CreateRun, session: SessionDepends, user: CurrentUser):
    """Validate, register the run's sample, compile, dispatch -- and start the queue."""
    procedure = get_procedure(str(body.procedure_uuid), session, user)
    if procedure.station_uuid is None:
        raise HTTPException(status_code=422, detail="The procedure has no station to run on.")
    station = session.get(StationDB, procedure.station_uuid)
    if station is None or not station.queueserver_url:
        raise HTTPException(status_code=409, detail="The procedure's station has no queueserver URL.")

    client = client_for(station.queueserver_url)
    steps = [ProcedureStep.model_validate(s) for s in procedure.steps]
    errors = [
        d for d in validate_steps(steps, client.plans_allowed(), client.devices_allowed()) if d.severity == "error"
    ]
    if errors:
        raise HTTPException(
            status_code=422,
            detail="The procedure doesn't validate: " + "; ".join(
                (f"[{d.step_id}] " if d.step_id else "") + d.message for d in errors
            ),
        )

    run_uuid, sample_uuid = uuid4(), uuid4()
    code = next_code(session, RunDB, "RUN")
    sample_code = next_code(session, SampleDB, "SMP")
    meta = {
        "procedure": str(procedure.uuid),
        "procedure_version": procedure.version,
        "run": str(run_uuid),
        "run_code": code,
        "sample": str(sample_uuid),
        "sample_code": sample_code,
        "operator": user.name,
    }
    queued = client.add_batch(compile_steps(steps, meta))  # raises (502) -> nothing recorded

    run = RunDB(
        uuid=run_uuid,
        code=code,
        procedure_uuid=procedure.uuid,
        procedure_name=procedure.name,
        procedure_version=procedure.version,
        station_uuid=station.uuid,
        state="queued",
        items=[
            {"step_id": s.id, "plan": s.plan, "kwargs": s.kwargs, "item_uid": q.get("item_uid"), "status": "pending"}
            for s, q in zip(steps, queued)
        ],
        created_by=user.uuid,
    )
    session.add(run)
    session.flush()

    given = body.sample.model_dump(exclude_none=True)
    sample = SampleDB(
        uuid=sample_uuid,
        code=sample_code,
        name=given.pop("name", None) or f"{procedure.name} — {code}",
        owner_uuid=user.uuid,
        run_uuid=run_uuid,
        parameters={"procedure_version": procedure.version, "steps": [s.model_dump(include={"id", "plan", "kwargs"}) for s in steps]},
        **given,
    )
    session.add(sample)
    session.flush()
    register(session, sample, actor_uuid=user.uuid, reason=f"created by run {code}", run_uuid=run_uuid, station_uuid=station.uuid)
    transition(session, sample, "reserved", actor_uuid=user.uuid, reason=f"queued on {station.name}", run_uuid=run_uuid, station_uuid=station.uuid)

    if body.autostart:
        try:
            status = client.status()
            if status.get("manager_state") == "idle":
                if not status.get("worker_environment_exists"):
                    client.open_environment()
                    run.sync_error = "The station's worker was closed; it's opening -- start the queue once it's up."
                else:
                    client.start()
        except QueueserverError as exc:
            run.sync_error = f"Queued, but the queue didn't start: {exc.detail}"

    session.commit()
    session.refresh(sample)
    record_sample(session, sample, "created", user.uuid)
    _record(session, run, "created", user.uuid)
    session.commit()
    return _out(session, run)


@router.post("/runs/{identifier}/stop", response_model=Run)
def stop_run(identifier: str, session: SessionDepends, user: CurrentUser):
    """Take the run's not-yet-started steps off the queue; the current step finishes."""
    run = _get(identifier, session)
    sync_runs(session, [run], user.uuid)
    if run.state in TERMINAL_STATES:
        return _out(session, run)
    client = client_for(_station(session, run).queueserver_url)
    items = []
    for item in run.items:
        item = dict(item)
        if item.get("status") == "pending" and item.get("item_uid"):
            client.remove_item(item["item_uid"])
            item["status"] = "removed"
        items.append(item)
    run.items = items
    session.commit()
    sync_runs(session, [run], user.uuid)
    return _out(session, run)


@router.post("/runs/{identifier}/abort", response_model=Run)
def abort_run(identifier: str, session: SessionDepends, user: CurrentUser):
    """Stop *now*: remove the pending steps and abort the one running."""
    run = _get(identifier, session)
    stop_run(identifier, session, user)
    if any(item.get("status") == "running" for item in run.items):
        client_for(_station(session, run).queueserver_url).abort()
    sync_runs(session, [run], user.uuid)
    return _out(session, run)
