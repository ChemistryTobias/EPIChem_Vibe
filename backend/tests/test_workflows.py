"""Workflow manager + sample tracker, against a fake station queueserver.

The fake keeps a queue and a history the way bluesky-queueserver reports them,
so these tests cover EPIChem's side of the contract: palette, validation,
compile/dispatch, state sync, failure clean-up, stop, and the run-created sample.
"""

import uuid

import pytest

from app.modules.workflow_management.procedures import api as procedures_api
from app.modules.workflow_management.queueserver import logic as qs_logic
from app.modules.workflow_management.runs import api as runs_api

HEAT = {
    "name": "heat",
    "module": "epichem_plans.synthesis",
    "description": "Bring a heater to a temperature setpoint.",
    "parameters": [
        {"name": "heater", "kind": {"name": "POSITIONAL_OR_KEYWORD"}, "annotation": {"type": "Heaters", "devices": {"Heaters": ["hotplate"]}}},
        {"name": "setpoint_c", "kind": {"name": "POSITIONAL_OR_KEYWORD"}, "annotation": {"type": "float"}, "min": "20", "max": "300"},
        {"name": "wait_until_stable", "kind": {"name": "POSITIONAL_OR_KEYWORD"}, "annotation": {"type": "bool"}, "default": "True"},
    ],
}
HOLD = {
    "name": "hold",
    "module": "epichem_plans.synthesis",
    "parameters": [{"name": "duration_s", "kind": {"name": "POSITIONAL_OR_KEYWORD"}, "annotation": {"type": "float"}, "min": "0"}],
}


class FakeQueueserver:
    def __init__(self):
        self.plans = {"heat": HEAT, "hold": HOLD}
        self.devices = {"hotplate": {"classname": "SimHeaterStirrer", "module": "epichem_devices.ramp"}, "pump": {}}
        self.pending: list[dict] = []
        self.running: dict | None = None
        self.history: list[dict] = []
        self.started = 0
        self.fail_dispatch = False

    # client surface
    def status(self):
        return {"manager_state": "executing_queue" if self.running else "idle", "worker_environment_exists": True}

    def plans_allowed(self):
        return self.plans

    def devices_allowed(self):
        return self.devices

    def add_batch(self, items):
        if self.fail_dispatch:
            raise qs_logic.QueueserverError("Station queueserver: worker environment is closed")
        added = [{**item, "item_uid": str(uuid.uuid4())} for item in items]
        self.pending.extend(added)
        return added

    def queue_get(self):
        return {"items": self.pending, "running_item": self.running or {}}

    def get_history(self):
        return self.history

    def remove_item(self, uid):
        self.pending = [i for i in self.pending if i["item_uid"] != uid]

    def start(self):
        self.started += 1

    def open_environment(self):
        pass

    def abort(self):
        pass

    # test controls
    def run_next(self):
        self.running = self.pending.pop(0)

    def finish(self, status="completed", msg=""):
        item, self.running = self.running, None
        self.history.append({**item, "result": {"exit_status": status, "msg": msg, "run_uids": ["r-" + item["item_uid"][:4]],
                                                "time_start": 1_800_000_000.0, "time_stop": 1_800_000_010.0}})


class Client:
    """Adapts FakeQueueserver to the QueueserverClient method names."""

    def __init__(self, fake):
        self.fake = fake

    def __getattr__(self, name):
        return {"queue": self.fake.queue_get, "history": self.fake.get_history}.get(name) or getattr(self.fake, name)


@pytest.fixture
def station(client, layout, monkeypatch):
    fake = FakeQueueserver()
    factory = lambda url: Client(fake)
    for module in (qs_logic, procedures_api, runs_api):
        monkeypatch.setattr(module, "client_for", factory)
    station = layout["station"]
    client.patch(f"/api/v1/stations/{station['uuid']}", json={"queueserver_url": "http://pod:60610"}).raise_for_status()
    return {"uuid": station["uuid"], "fake": fake}


def make_procedure(client, station, steps=None):
    steps = steps or [
        {"id": "n1", "plan": "heat", "kwargs": {"heater": "hotplate", "setpoint_c": 80}},
        {"id": "n2", "plan": "hold", "kwargs": {"duration_s": 5}},
    ]
    response = client.post("/api/v1/procedures", json={"name": "Heat and hold", "station_uuid": station["uuid"], "steps": steps})
    response.raise_for_status()
    return response.json()


def test_palette_and_device_registration(client, station):
    palette = client.get(f"/api/v1/stations/{station['uuid']}/execution/palette").json()
    assert set(palette["plans"]) == {"heat", "hold"}
    assert palette["registered"] == []

    created = client.post(f"/api/v1/stations/{station['uuid']}/execution/devices/register").json()
    assert sorted(d["ophyd_name"] for d in created) == ["hotplate", "pump"]
    assert client.post(f"/api/v1/stations/{station['uuid']}/execution/devices/register").json() == []
    palette = client.get(f"/api/v1/stations/{station['uuid']}/execution/palette").json()
    assert palette["registered"] == ["hotplate", "pump"]


def test_unconfigured_station_is_reported_not_errored(client, layout):
    status = client.get(f"/api/v1/stations/{layout['station']['uuid']}/execution").json()
    assert status == {"configured": False, "reachable": False, "url": None, "status": None, "error": None}


def test_validation_tiers(client, station):
    steps = [
        {"id": "a", "plan": "heat", "kwargs": {"heater": "oven", "setpoint_c": 500}},
        {"id": "b", "plan": "heat", "kwargs": {"heater": "hotplate"}},
        {"id": "c", "plan": "teleport", "kwargs": {}},
        {"id": "d", "plan": "hold", "kwargs": {"duration_s": "soon", "speed": 3}},
        {"id": "e", "plan": "heat", "kwargs": {"heater": "hotplate", "setpoint_c": 50}},
    ]
    result = client.post("/api/v1/procedures/validate", json={"station_uuid": station["uuid"], "steps": steps}).json()
    found = {(d["step_id"], d["parameter"], d["severity"]) for d in result["diagnostics"]}
    assert not result["valid"]
    assert ("a", "heater", "error") in found  # not in the device enum (stops at the first issue per value)
    assert ("b", "setpoint_c", "error") in found  # required
    assert ("c", None, "error") in found  # unknown plan
    assert ("d", "speed", "error") in found and ("d", "duration_s", "error") in found
    assert ("e", "heater", "warning") in found  # valid, but not registered in EPIChem
    assert all(d["step_id"] != "e" or d["severity"] == "warning" for d in result["diagnostics"])


def test_editing_steps_bumps_the_version(client, station):
    procedure = make_procedure(client, station)
    assert procedure["version"] == 1
    renamed = client.patch(f"/api/v1/procedures/{procedure['uuid']}", json={"description": "x"}).json()
    assert renamed["version"] == 1
    edited = client.patch(f"/api/v1/procedures/{procedure['uuid']}", json={"steps": procedure["steps"][:1]}).json()
    assert edited["version"] == 2


def test_run_lifecycle_and_its_sample(client, station):
    fake = station["fake"]
    procedure = make_procedure(client, station)
    run = client.post("/api/v1/runs", json={"procedure_uuid": procedure["uuid"], "sample": {"substance": "PEDOT:PSS"}}).json()

    assert run["state"] == "queued" and run["code"].startswith("RUN-")
    assert [i["plan"] for i in run["items"]] == ["heat", "hold"]
    assert fake.started == 1
    meta = fake.pending[0]["meta"]["epichem"]
    assert meta["run"] == run["uuid"] and meta["step_id"] == "n1"

    sample = client.get(f"/api/v1/samples/{run['sample_uuids'][0]}").json()
    assert sample["state"] == "reserved" and sample["substance"] == "PEDOT:PSS"
    assert sample["parameters"]["steps"][0]["kwargs"]["setpoint_c"] == 80
    assert meta["sample"] == sample["uuid"]

    fake.run_next()
    assert client.get(f"/api/v1/runs/{run['uuid']}").json()["state"] == "running"
    fake.finish()
    fake.run_next()
    fake.finish()
    done = client.get(f"/api/v1/runs/{run['code']}").json()
    assert done["state"] == "completed" and done["finished_at"]
    assert all(i["status"] == "completed" for i in done["items"])

    sample = client.get(f"/api/v1/samples/{sample['code']}").json()
    assert [e["to_state"] for e in sample["events"]] == ["registered", "reserved", "in_process", "processed"]
    assert sample["station_uuid"] == station["uuid"]


def test_failed_step_fails_the_run_and_clears_its_leftovers(client, station):
    fake = station["fake"]
    procedure = make_procedure(client, station)
    run = client.post("/api/v1/runs", json={"procedure_uuid": procedure["uuid"]}).json()
    fake.run_next()
    fake.finish("failed", "Plan failed: hotplate: TimeoutError")

    failed = client.get(f"/api/v1/runs/{run['uuid']}").json()
    assert failed["state"] == "failed"
    assert "TimeoutError" in failed["error"]
    assert fake.pending == []  # step n2 taken off the station's queue
    sample = client.get(f"/api/v1/samples/{failed['sample_uuids'][0]}").json()
    assert sample["state"] == "quarantined"


def test_stop_takes_pending_steps_off_the_queue(client, station):
    fake = station["fake"]
    run = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station)["uuid"]}).json()
    fake.run_next()
    stopped = client.post(f"/api/v1/runs/{run['uuid']}/stop").json()
    assert [i["status"] for i in stopped["items"]] == ["running", "removed"]
    fake.finish()
    assert client.get(f"/api/v1/runs/{run['uuid']}").json()["state"] == "stopped"


def test_refused_dispatch_records_nothing(client, station):
    station["fake"].fail_dispatch = True
    response = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station)["uuid"]})
    assert response.status_code == 502
    assert "environment is closed" in response.json()["detail"]
    assert client.get("/api/v1/runs").json() == []
    assert client.get("/api/v1/samples").json() == []


def test_invalid_procedure_is_not_dispatched(client, station):
    procedure = make_procedure(client, station, [{"id": "n1", "plan": "heat", "kwargs": {"heater": "hotplate"}}])
    response = client.post("/api/v1/runs", json={"procedure_uuid": procedure["uuid"]})
    assert response.status_code == 422 and "setpoint_c" in response.json()["detail"]
    assert station["fake"].pending == []


def test_samples_by_hand_and_the_lifecycle_rules(client, layout):
    sample = client.post("/api/v1/samples", json={"name": "Spare film", "amount_value": 1.5, "amount_unit": "mL"}).json()
    assert sample["code"].startswith("SMP-") and sample["state"] == "registered"

    bad = client.post(f"/api/v1/samples/{sample['uuid']}/events", json={"to_state": "processed"})
    assert bad.status_code == 409 and "allowed" in bad.json()["detail"]

    moved = client.post(
        f"/api/v1/samples/{sample['uuid']}/events",
        json={"to_state": "staged", "reason": "on the bench", "station_uuid": layout["station"]["uuid"]},
    ).json()
    assert moved["state"] == "staged" and moved["station_uuid"] == layout["station"]["uuid"]

    # State is not writable directly.
    client.patch(f"/api/v1/samples/{sample['uuid']}", json={"state": "archived", "notes": "n"})
    assert client.get(f"/api/v1/samples/{sample['uuid']}").json()["state"] == "staged"

    assert [s["code"] for s in client.get("/api/v1/samples?state=staged").json()] == [sample["code"]]
    revisions = client.get(f"/api/v1/revisions/sample/{sample['uuid']}").json()
    assert [r["action"] for r in revisions] == ["created", "updated", "updated"]
