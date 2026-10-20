"""Run orchestration (Roadmap 2.2's dispatch layer, plan §9.4's orchestrator level, §11).

EPIChem's job between plans, never inside them: send each block of
consecutive plan steps to its station's queue and watch it finish there, and
carry out the flow-control steps itself -- wait out a pause, hold for an
operator's input, call an HTTP endpoint -- filling `{{steps.<id>.…}}`
references from earlier steps' outputs as it goes.

A background thread (`start`) advances every unfinished run once a second;
API calls that change a run (input, stop, abort) take the same lock. Run the
API as a single worker -- or set EPICHEM_ORCHESTRATOR=off on all but one.
"""

import json
import logging
import os
import threading
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx

from app.modules.device_managment.station.schema import StationDB
from app.modules.workflow_management.procedures.logic import compile_plan_item, resolve
from app.modules.workflow_management.procedures.schema import ProcedureStep
from app.modules.workflow_management.queueserver.logic import QueueserverError, client_for

from .schema import ITEM_FAILURES, ITEM_HALTS, TERMINAL_STATES, RunDB

log = logging.getLogger("epichem.orchestrator")

RUN_LOCK = threading.RLock()
HTTP_TIMEOUT_S = float(os.environ.get("EPICHEM_HTTP_STEP_TIMEOUT_S", "15"))


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _ts(timestamp: float | None) -> datetime | None:
    return datetime.fromtimestamp(timestamp, tz=UTC).replace(tzinfo=None) if timestamp else None


class Stations:
    """Per-tick cache: one client and one queue/history read per station."""

    def __init__(self, session):
        self.session = session
        self._snapshots: dict[Any, tuple[dict, list]] = {}

    def client(self, station_uuid):
        # Items keep station ids as JSON strings.
        station = self.session.get(StationDB, UUID(str(station_uuid))) if station_uuid else None
        if station is None or not station.queueserver_url:
            raise QueueserverError("the station is no longer executable")
        return client_for(station.queueserver_url)

    def snapshot(self, station_uuid) -> tuple[dict, list]:
        if station_uuid not in self._snapshots:
            client = self.client(station_uuid)
            self._snapshots[station_uuid] = (client.queue(), client.history())
        return self._snapshots[station_uuid]

    def forget(self, station_uuid) -> None:
        self._snapshots.pop(station_uuid, None)


def outputs_of(items: list[dict]) -> dict[str, Any]:
    return {i["step_id"]: i.get("output") for i in items}


def _observe(items: list[dict], stations: Stations, errors: list[str]) -> None:
    """Update dispatched plan items from their stations' queue and history."""
    for item in items:
        if item.get("type", "plan") != "plan" or not item.get("item_uid"):
            continue
        if item["status"] not in ("queued", "running"):
            continue
        try:
            queue, history = stations.snapshot(item["station_uuid"])
        except QueueserverError as exc:
            errors.append(f"Couldn't read the station: {exc.detail}")
            continue
        uid = item["item_uid"]
        finished = next((h for h in history if h.get("item_uid") == uid), None)
        if finished:
            result = finished.get("result") or {}
            item["status"] = result.get("exit_status") or "unknown"
            item["run_uids"] = result.get("run_uids") or []
            item["message"] = result.get("msg") or None
            item["time_start"] = result.get("time_start")
            item["time_stop"] = result.get("time_stop")
            item["output"] = {"run_uids": item["run_uids"]}
        elif (queue.get("running_item") or {}).get("item_uid") == uid:
            item["status"] = "running"
        elif any(q.get("item_uid") == uid for q in queue.get("items", [])):
            item["status"] = "queued"
        else:
            item["status"] = "missing"


def _dispatch_block(run: RunDB, items: list[dict], start: int, stations: Stations) -> None:
    """Send the consecutive plan steps on one station, from `start`, as one batch."""
    station = items[start]["station_uuid"]
    block = []
    for index in range(start, len(items)):
        item = items[index]
        if item.get("type", "plan") != "plan" or item["station_uuid"] != station or item.get("item_uid"):
            break
        block.append(index)
    outputs = outputs_of(items)
    meta = {
        "procedure": str(run.procedure_uuid) if run.procedure_uuid else None,
        "procedure_version": run.procedure_version,
        "run": str(run.uuid),
        "run_code": run.code,
    }
    queue_items = []
    for index in block:
        item = items[index]
        kwargs = resolve(item["kwargs"], outputs)
        item["kwargs_sent"] = kwargs
        step = ProcedureStep(id=item["step_id"], type="plan", plan=item["plan"], kwargs=kwargs)
        queue_items.append(compile_plan_item(step, kwargs, {**meta, **(item.get("meta") or {})}, index))
    client = stations.client(station)
    queued = client.add_batch(queue_items)
    for index, q in zip(block, queued):
        items[index]["item_uid"] = q.get("item_uid")
        items[index]["status"] = "queued"
    stations.forget(station)
    status = client.status()
    if status.get("manager_state") == "idle":
        if not status.get("worker_environment_exists"):
            client.open_environment()
            run.sync_error = "The station's worker was closed; it's opening -- the queue starts once it's up."
        else:
            client.start()


def _http(item: dict, outputs: dict[str, Any]) -> None:
    """Carry out an HTTP step; the response becomes its output."""
    k = resolve(item["kwargs"], outputs)
    method = str(k.get("method") or "GET").upper()
    url = str(k.get("url") or "")
    allowed = [h.strip() for h in os.environ.get("EPICHEM_HTTP_STEP_HOSTS", "").split(",") if h.strip()]
    host = urlparse(url).hostname or ""
    if allowed and host not in allowed:
        raise RuntimeError(f"{host} isn't in EPICHEM_HTTP_STEP_HOSTS.")
    body = k.get("body")
    content: dict[str, Any] = {}
    if isinstance(body, (dict, list)):
        content["json"] = body
    elif isinstance(body, str) and body.strip():
        try:
            content["json"] = json.loads(body)
        except ValueError:
            content["content"] = body
    response = httpx.request(method, url, timeout=HTTP_TIMEOUT_S, **content)
    output: dict[str, Any] = {"status": response.status_code}
    try:
        output["json"] = response.json()
    except ValueError:
        output["text"] = response.text[:4000]
    item["output"] = output
    expected = k.get("expect_status")
    ok = response.status_code == int(expected) if expected not in (None, "") else response.is_success
    if not ok:
        raise RuntimeError(f"{method} {url} answered {response.status_code}.")


def advance(run: RunDB, stations: Stations, *, raise_dispatch: bool = False) -> None:
    """Move one run as far as it can go right now."""
    if run.state in TERMINAL_STATES:
        return
    items = [dict(i) for i in run.items]
    errors: list[str] = []
    _observe(items, stations, errors)

    for _ in range(len(items) + 1):
        index = next((n for n, i in enumerate(items) if i["status"] != "completed"), None)
        if index is None:
            run.state = "completed"
            break
        item = items[index]
        kind = item.get("type", "plan")

        if item["status"] in ITEM_FAILURES:
            run.state = "failed"
            if not run.error:
                where = item.get("label") or item.get("plan") or kind
                run.error = f"Step {index + 1} ({where}) {item['status']}: {item.get('message') or 'no message'}"
            _clear_rest(items, index + 1, stations)
            break
        if item["status"] in ITEM_HALTS:
            run.state = "running" if any(i["status"] == "running" for i in items) else "stopped"
            break

        if kind == "plan":
            if not item.get("item_uid"):
                try:
                    _dispatch_block(run, items, index, stations)
                except QueueserverError as exc:
                    if raise_dispatch:
                        raise
                    errors.append(f"Couldn't dispatch to the station: {exc.detail}")
            # Waiting on the station: "queued" until anything of this run has started.
            started = run.started_at is not None or index > 0 or item["status"] == "running"
            run.state = "running" if started else "queued"
            break

        if kind == "wait":
            if item.get("time_start") is None:
                item["time_start"] = time.time()
                item["status"] = "running"
            duration = resolve(item["kwargs"].get("duration_s"), outputs_of(items))
            try:
                duration = float(duration)
            except (TypeError, ValueError):
                item["status"], item["message"] = "failed", f"Wait duration {duration!r} isn't a number."
                continue
            if time.time() - item["time_start"] >= duration:
                item["status"], item["time_stop"] = "completed", time.time()
                continue
            run.state = "running"
            break

        if kind == "input":
            if item["status"] != "waiting_input":
                item["status"], item["time_start"] = "waiting_input", time.time()
            run.state = "waiting"
            break

        if kind == "http":
            item["time_start"] = time.time()
            try:
                _http(item, outputs_of(items))
                item["status"] = "completed"
            except Exception as exc:
                item["status"], item["message"] = "failed", f"{type(exc).__name__}: {exc}"
            item["time_stop"] = time.time()
            continue

        item["status"], item["message"] = "failed", f"Unknown step type '{kind}'."

    run.items = items
    run.sync_error = errors[0] if errors else (run.sync_error if run.state == "queued" else None)
    if run.started_at is None and run.state in ("running", "waiting", "completed", "failed"):
        starts = [i["time_start"] for i in items if i.get("time_start")]
        run.started_at = _ts(min(starts)) if starts else _now()
    if run.state in TERMINAL_STATES:
        stops = [i["time_stop"] for i in items if i.get("time_stop")]
        run.finished_at = _ts(max(stops)) if stops else _now()


def _clear_rest(items: list[dict], start: int, stations: Stations) -> None:
    """After a failure: take the run's later steps off station queues, skip the rest."""
    for item in items[start:]:
        if item["status"] == "queued" and item.get("item_uid"):
            try:
                stations.client(item["station_uuid"]).remove_item(item["item_uid"])
                item["status"] = "removed"
            except QueueserverError:
                pass
        elif item["status"] in ("pending", "waiting_input"):
            item["status"] = "skipped"


def stop(run: RunDB, stations: Stations, *, abort: bool = False) -> None:
    """Stop: nothing new starts; a running plan finishes (or, with abort, is aborted)."""
    items = [dict(i) for i in run.items]
    _observe(items, stations, [])
    for item in items:
        if item["status"] == "queued" and item.get("item_uid"):
            stations.client(item["station_uuid"]).remove_item(item["item_uid"])
            item["status"] = "removed"
        elif item["status"] == "pending":
            item["status"] = "skipped"
        elif item["status"] in ("waiting_input",) or (item["status"] == "running" and item.get("type") in ("wait", "input")):
            item["status"], item["time_stop"] = "stopped", time.time()
        elif abort and item["status"] == "running" and item.get("type", "plan") == "plan":
            stations.client(item["station_uuid"]).abort()
    run.items = items


# --- background thread -------------------------------------------------------
_thread: threading.Thread | None = None


def tick(session, on_change) -> None:
    """Advance every unfinished run once; `on_change(run)` after one moved."""
    stations = Stations(session)
    for run in session.query(RunDB).filter(RunDB.state.notin_(list(TERMINAL_STATES))).all():
        before = (run.state, json.dumps(run.items, sort_keys=True, default=str))
        try:
            advance(run, stations)
        except Exception:
            log.exception("advancing %s failed", run.code)
            continue
        if (run.state, json.dumps(run.items, sort_keys=True, default=str)) != before:
            on_change(run)
    session.commit()


def start(interval_s: float = 1.0) -> None:
    """Start the background loop once per process (EPICHEM_ORCHESTRATOR=off disables it)."""
    global _thread
    if _thread is not None or os.environ.get("EPICHEM_ORCHESTRATOR", "on").lower() == "off":
        return
    from app.core.database.session_config import SessionLocal

    from .api import on_run_changed

    def loop():
        while True:
            try:
                with RUN_LOCK, SessionLocal() as session:
                    tick(session, lambda run: on_run_changed(session, run, None))
            except Exception:
                log.exception("orchestrator tick failed")
            time.sleep(interval_s)

    _thread = threading.Thread(target=loop, daemon=True, name="epichem-orchestrator")
    _thread.start()
