"""Workflow manager + sample tracker + discovery, against fake station queueservers.

The fakes keep a queue and a history the way bluesky-queueserver reports them,
so these tests cover EPIChem's side of the contract: palette, validation,
orchestration (plan blocks per station, wait/input/http steps, templates),
failure clean-up, stop, manual runs, the run-created sample, and discovery.
"""

import time
import uuid

import pytest

from app.core.database.session_config import SessionLocal
from app.modules.device_managment.discovery import api as discovery_api
from app.modules.workflow_management.procedures import api as procedures_api
from app.modules.workflow_management.queueserver import logic as qs_logic
from app.modules.workflow_management.runs import api as runs_api
from app.modules.workflow_management.runs import orchestrator

P = {"name": "POSITIONAL_OR_KEYWORD"}
HEAT = {
    "name": "heat",
    "module": "epichem_plans.synthesis",
    "parameters": [
        {"name": "heater", "kind": P, "annotation": {"type": "Heaters", "devices": {"Heaters": ["hotplate"]}}},
        {"name": "setpoint_c", "kind": P, "annotation": {"type": "float"}, "min": "20", "max": "300"},
        {"name": "wait_until_stable", "kind": P, "annotation": {"type": "bool"}, "default": "True"},
    ],
}
HOLD = {"name": "hold", "parameters": [{"name": "duration_s", "kind": P, "annotation": {"type": "float"}, "min": "0"}]}


class FakeQueueserver:
    def __init__(self):
        self.plans = {"heat": HEAT, "hold": HOLD}
        self.devices = {"hotplate": {"classname": "SimHeaterStirrer", "module": "epichem_devices.ramp"}, "pump": {}}
        self.pending: list[dict] = []
        self.running: dict | None = None
        self.history: list[dict] = []
        self.started = 0
        self.fail_dispatch = False
        self.aborted = False

    def status(self):
        return {"manager_state": "executing_queue" if self.running else "idle", "worker_environment_exists": True, "msg": "RE Manager"}

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
        self.aborted = True

    def call_function(self, name, kwargs=None, wait_s=5.0):
        assert name == "read_devices"
        return {"hotplate": {"class": "SimHeaterStirrer", "readings": {"hotplate_readback": {"value": 21.0, "timestamp": 1.0, "units": "degC"}}, "error": None}}

    # test controls
    def run_next(self):
        self.running = self.pending.pop(0)

    def finish(self, status="completed", msg=""):
        item, self.running = self.running, None
        self.history.append({**item, "result": {"exit_status": status, "msg": msg, "run_uids": ["r-" + item["item_uid"][:4]],
                                                "time_start": time.time() - 1, "time_stop": time.time()}})


class Client:
    def __init__(self, fake):
        self.fake = fake

    def __getattr__(self, name):
        return {"queue": self.fake.queue_get, "history": self.fake.get_history}.get(name) or getattr(self.fake, name)


@pytest.fixture
def pods(monkeypatch):
    """url -> fake pod; every client_for() in the app resolves through it."""
    fakes: dict[str, FakeQueueserver] = {}

    def factory(url):
        return Client(fakes.setdefault(url.rstrip("/"), FakeQueueserver()))

    for module in (qs_logic, procedures_api, orchestrator, discovery_api):
        monkeypatch.setattr(module, "client_for", factory)
    return fakes


@pytest.fixture
def station(client, layout, pods):
    station = layout["station"]
    client.patch(f"/api/v1/stations/{station['uuid']}", json={"queueserver_url": "http://pod:60610"}).raise_for_status()
    pods.setdefault("http://pod:60610", FakeQueueserver())
    return {"uuid": station["uuid"], "fake": pods["http://pod:60610"]}


def tick():
    """One orchestrator pass, as the background thread does it."""
    with orchestrator.RUN_LOCK, SessionLocal() as session:
        orchestrator.tick(session, lambda run: runs_api.on_run_changed(session, run, None))


def make_procedure(client, station, steps=None, name="Heat and hold"):
    steps = steps or [
        {"id": "n1", "plan": "heat", "kwargs": {"heater": "hotplate", "setpoint_c": 80}},
        {"id": "n2", "plan": "hold", "kwargs": {"duration_s": 5}},
    ]
    response = client.post("/api/v1/procedures", json={"name": name, "station_uuid": station["uuid"], "steps": steps})
    response.raise_for_status()
    return response.json()


def test_palette_readings_and_device_registration(client, station):
    palette = client.get(f"/api/v1/stations/{station['uuid']}/execution/palette").json()
    assert set(palette["plans"]) == {"heat", "hold"} and palette["registered"] == []

    created = client.post(f"/api/v1/stations/{station['uuid']}/execution/devices/register").json()
    assert sorted(d["ophyd_name"] for d in created) == ["hotplate", "pump"]
    assert client.post(f"/api/v1/stations/{station['uuid']}/execution/devices/register").json() == []

    readings = client.get(f"/api/v1/stations/{station['uuid']}/execution/readings").json()
    assert readings["hotplate"]["readings"]["hotplate_readback"]["value"] == 21.0


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
        {"id": "f", "type": "wait", "kwargs": {"duration_s": 0}},
        {"id": "g", "type": "input", "kwargs": {"prompt": "", "fields": [{"name": "bad name"}]}},
        {"id": "h", "type": "http", "kwargs": {"method": "FETCH", "url": "localhost"}},
        {"id": "i", "plan": "hold", "kwargs": {"duration_s": "{{steps.z.value}}"}},
    ]
    result = client.post("/api/v1/procedures/validate", json={"station_uuid": station["uuid"], "steps": steps}).json()
    found = {(d["step_id"], d["parameter"], d["severity"]) for d in result["diagnostics"]}
    assert not result["valid"]
    assert ("a", "heater", "error") in found
    assert ("b", "setpoint_c", "error") in found
    assert ("c", None, "error") in found
    assert ("d", "speed", "error") in found and ("d", "duration_s", "error") in found
    assert ("e", "heater", "warning") in found  # valid, but not registered in EPIChem
    assert ("f", "duration_s", "error") in found
    assert ("g", "prompt", "error") in found and ("g", "fields", "error") in found
    assert ("h", "method", "error") in found and ("h", "url", "error") in found
    assert ("i", None, "error") in found  # template points at no earlier step


def test_procedures_search_duplicate_and_version(client, station):
    procedure = make_procedure(client, station)
    make_procedure(client, station, name="Something else")
    assert [p["name"] for p in client.get("/api/v1/procedures?q=heat").json()] == ["Heat and hold"]
    copy = client.post(f"/api/v1/procedures/{procedure['uuid']}/duplicate").json()
    assert copy["name"] == "Heat and hold (copy)" and copy["steps"] == procedure["steps"]
    assert client.post(f"/api/v1/procedures/{procedure['uuid']}/duplicate").json()["name"] == "Heat and hold (copy 2)"
    edited = client.patch(f"/api/v1/procedures/{procedure['uuid']}", json={"steps": procedure["steps"][:1]}).json()
    assert edited["version"] == 2


def test_run_lifecycle_and_its_sample(client, station):
    fake = station["fake"]
    procedure = make_procedure(client, station)
    run = client.post("/api/v1/runs", json={"procedure_uuid": procedure["uuid"], "sample": {"substance": "PEDOT:PSS"}}).json()

    assert run["state"] == "queued" and run["code"].startswith("RUN-")
    assert [i["status"] for i in run["items"]] == ["queued", "queued"]  # one block, one batch
    assert fake.started == 1
    meta = fake.pending[0]["meta"]["epichem"]
    assert meta["run"] == run["uuid"] and meta["step_id"] == "n1"

    sample = client.get(f"/api/v1/samples/{run['sample_uuids'][0]}").json()
    assert sample["state"] == "reserved" and meta["sample"] == sample["uuid"]

    fake.run_next()
    tick()
    assert client.get(f"/api/v1/runs/{run['uuid']}").json()["state"] == "running"
    fake.finish()
    fake.run_next()
    fake.finish()
    tick()
    done = client.get(f"/api/v1/runs/{run['code']}").json()
    assert done["state"] == "completed" and done["finished_at"]
    sample = client.get(f"/api/v1/samples/{sample['code']}").json()
    assert [e["to_state"] for e in sample["events"]] == ["registered", "reserved", "in_process", "processed"]


def test_multi_station_run_with_control_steps_and_templates(client, layout, station, pods, monkeypatch):
    other = client.post(
        "/api/v1/stations", json={"name": "Station 2", "lab_uuid": layout["lab1"]["uuid"], "queueserver_url": "http://pod2:60610"}
    ).json()
    calls = []

    class Response:
        status_code, is_success, text = 200, True, ""

        def json(self):
            return {"setpoint": 65}

    monkeypatch.setattr(orchestrator.httpx, "request", lambda method, url, **kw: calls.append((method, url, kw)) or Response())

    steps = [
        {"id": "heat1", "plan": "heat", "kwargs": {"heater": "hotplate", "setpoint_c": 80}},
        {"id": "pause", "type": "wait", "kwargs": {"duration_s": 0.01}},
        {"id": "ask", "type": "input", "kwargs": {"prompt": "Volume?", "fields": [{"name": "volume", "type": "number", "required": True}]}},
        {"id": "opt", "type": "http", "kwargs": {"method": "POST", "url": "http://optimiser/next", "body": {"volume": "{{steps.ask.volume}}"}}},
        {"id": "heat2", "plan": "heat", "station_uuid": other["uuid"], "kwargs": {"heater": "hotplate", "setpoint_c": "{{steps.opt.json.setpoint}}"}},
    ]
    procedure = make_procedure(client, station, steps, name="Two stations")
    assert client.post("/api/v1/procedures/validate", json={"station_uuid": station["uuid"], "steps": steps}).json()["valid"]
    run = client.post("/api/v1/runs", json={"procedure_uuid": procedure["uuid"]}).json()
    first, second = pods["http://pod:60610"], pods["http://pod2:60610"]
    assert len(first.pending) == 1 and second.pending == []

    first.run_next()
    first.finish()
    tick()
    time.sleep(0.02)
    tick()
    waiting = client.get(f"/api/v1/runs/{run['uuid']}").json()
    assert waiting["state"] == "waiting"
    assert [i["status"] for i in waiting["items"]] == ["completed", "completed", "waiting_input", "pending", "pending"]

    assert client.post(f"/api/v1/runs/{run['uuid']}/input", json={"step_id": "ask", "values": {}}).status_code == 422
    answered = client.post(f"/api/v1/runs/{run['uuid']}/input", json={"step_id": "ask", "values": {"volume": "12.5"}}).json()
    assert calls == [("POST", "http://optimiser/next", {"timeout": 15.0, "json": {"volume": 12.5}})]
    assert answered["items"][3]["output"]["json"] == {"setpoint": 65}
    assert second.pending[0]["kwargs"]["setpoint_c"] == 65  # the template took the response's value, typed
    second.run_next()
    second.finish()
    tick()
    assert client.get(f"/api/v1/runs/{run['uuid']}").json()["state"] == "completed"


def test_failed_step_fails_the_run_and_clears_its_leftovers(client, station):
    fake = station["fake"]
    run = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station)["uuid"]}).json()
    fake.run_next()
    fake.finish("failed", "Plan failed: hotplate: TimeoutError")
    tick()
    failed = client.get(f"/api/v1/runs/{run['uuid']}").json()
    assert failed["state"] == "failed" and "TimeoutError" in failed["error"]
    assert fake.pending == []
    assert client.get(f"/api/v1/samples/{failed['sample_uuids'][0]}").json()["state"] == "quarantined"


def test_stop_and_abort(client, station):
    fake = station["fake"]
    run = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station)["uuid"]}).json()
    fake.run_next()
    stopped = client.post(f"/api/v1/runs/{run['uuid']}/stop").json()
    assert [i["status"] for i in stopped["items"]] == ["running", "removed"]
    fake.finish()
    tick()
    assert client.get(f"/api/v1/runs/{run['uuid']}").json()["state"] == "stopped"

    run = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station, name="b")["uuid"]}).json()
    fake.run_next()
    client.post(f"/api/v1/runs/{run['uuid']}/abort")
    assert fake.aborted


def test_manual_run_records_a_run_but_no_sample(client, station):
    run = client.post(
        f"/api/v1/stations/{station['uuid']}/execution/run", json={"plan": "heat", "kwargs": {"heater": "hotplate", "setpoint_c": 60}}
    ).json()
    assert run["kind"] == "manual" and run["procedure_name"] == "heat" and run["sample_uuids"] == []
    assert station["fake"].pending[0]["meta"]["epichem"]["manual"] is True
    bad = client.post(f"/api/v1/stations/{station['uuid']}/execution/run", json={"plan": "heat", "kwargs": {}})
    assert bad.status_code == 422


def test_refused_dispatch_records_nothing(client, station):
    station["fake"].fail_dispatch = True
    response = client.post("/api/v1/runs", json={"procedure_uuid": make_procedure(client, station)["uuid"]})
    assert response.status_code == 502 and "environment is closed" in response.json()["detail"]
    assert client.get("/api/v1/runs").json() == [] and client.get("/api/v1/samples").json() == []


def test_discovery_announce_probe_adopt(client, layout, pods, monkeypatch):
    monkeypatch.setenv("EPICHEM_QSERVER_API_KEY", "podkey")
    announcement = {"url": "http://station-x:60610/", "station": "spinbot", "devices": {"arm": {"classname": "RobotArm"}}, "plans": ["move_home"]}
    assert client.post("/api/v1/discovery/announce", json=announcement, headers={"Authorization": "ApiKey wrong"}).status_code == 401
    assert client.post("/api/v1/discovery/announce", json=announcement, headers={"Authorization": "ApiKey podkey"}).status_code == 204

    [pod] = client.get("/api/v1/discovery/pods").json()
    assert pod["url"] == "http://station-x:60610" and pod["online"] and pod["station_uuid"] is None

    probed = client.post("/api/v1/discovery/probe", json={"url": "http://pod3:60610"}).json()
    assert probed["source"] == "probe" and "hotplate" in probed["devices"]

    station = client.post(f"/api/v1/discovery/pods/{probed['uuid']}/adopt", json={"lab_uuid": layout["lab2"]["uuid"], "name": "Pod 3"}).json()
    assert station["queueserver_url"] == "http://pod3:60610" and sorted(d["ophyd_name"] for d in station["devices"]) == ["hotplate", "pump"]
    pods_now = {p["url"]: p for p in client.get("/api/v1/discovery/pods").json()}
    assert pods_now["http://pod3:60610"]["station_uuid"] == station["uuid"]


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
    client.patch(f"/api/v1/samples/{sample['uuid']}", json={"state": "archived", "notes": "n"})
    assert client.get(f"/api/v1/samples/{sample['uuid']}").json()["state"] == "staged"
    revisions = client.get(f"/api/v1/revisions/sample/{sample['uuid']}").json()
    assert [r["action"] for r in revisions] == ["created", "updated", "updated"]
