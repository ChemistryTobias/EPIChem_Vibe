"""Run bookkeeping: read the station's queue and history, and derive each item's
and the run's state from them (Roadmap 2.2's dispatch layer, plan §11).

Nothing here executes or schedules physical work: the queueserver orders and
runs items; this only observes, and tidies up after a failure so a run's
leftover items don't fire later when someone restarts that queue.
"""

from datetime import datetime, UTC
from typing import Any

from .schema import ITEM_FAILURES, TERMINAL_STATES, RunDB


def _utc(timestamp: float | None) -> datetime | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC).replace(tzinfo=None)


def derive_state(statuses: list[str]) -> str:
    if not statuses:
        return "unknown"
    if "running" in statuses:
        return "running"
    if any(s in ITEM_FAILURES for s in statuses):
        return "failed"
    if all(s == "completed" for s in statuses):
        return "completed"
    if all(s == "pending" for s in statuses):
        return "queued"
    if "pending" in statuses:
        return "running"  # between two of its items
    if any(s in ("removed", "stopped") for s in statuses):
        return "stopped"
    return "unknown"


def apply_station_snapshot(run: RunDB, queue: dict[str, Any], history: list[dict[str, Any]]) -> None:
    """Update `run.items`/`state`/timestamps from one read of the station."""
    pending = {item.get("item_uid") for item in queue.get("items", [])}
    running = (queue.get("running_item") or {}).get("item_uid")
    finished = {item.get("item_uid"): item for item in history}

    items = []
    for item in run.items:
        item = dict(item)
        uid = item.get("item_uid")
        if uid in finished:
            result = finished[uid].get("result") or {}
            item["status"] = result.get("exit_status") or "unknown"
            item["run_uids"] = result.get("run_uids") or []
            item["message"] = result.get("msg") or None
            item["time_start"] = result.get("time_start")
            item["time_stop"] = result.get("time_stop")
        elif uid is not None and uid == running:
            item["status"] = "running"
        elif uid in pending:
            item["status"] = "pending"
        elif item.get("status") != "removed":
            item["status"] = "missing"  # gone from the station without a trace
        items.append(item)

    run.items = items
    run.state = derive_state([i["status"] for i in items])
    starts = [i["time_start"] for i in items if i.get("time_start")]
    if starts and run.started_at is None:
        run.started_at = _utc(min(starts))
    if run.state == "running" and run.started_at is None:
        run.started_at = datetime.now(UTC).replace(tzinfo=None)
    if run.state in TERMINAL_STATES:
        stops = [i["time_stop"] for i in items if i.get("time_stop")]
        run.finished_at = _utc(max(stops)) if stops else datetime.now(UTC).replace(tzinfo=None)
        failed = next((i for i in items if i["status"] in ITEM_FAILURES), None)
        if failed and not run.error:
            run.error = f"Step '{failed['step_id']}' ({failed['plan']}) {failed['status']}: {failed.get('message') or 'no message'}"


def leftover_uids(run: RunDB) -> list[str]:
    """Items of a finished-badly run still waiting in the station's queue."""
    return [i["item_uid"] for i in run.items if i.get("status") == "pending" and i.get("item_uid")]


# Which sample state follows from which run state (plan §7.3).
SAMPLE_STATE_FOR_RUN = {
    "running": "in_process",
    "completed": "processed",
    "failed": "quarantined",
    "stopped": "quarantined",
}
