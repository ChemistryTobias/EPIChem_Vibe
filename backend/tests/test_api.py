import pytest
from fastapi.testclient import TestClient

from epichem.models import (
    Bench,
    CapabilityClass,
    Device,
    Lab,
    Site,
    Station,
    StationDeviceBinding,
    Workcell,
    Zone,
)


@pytest.fixture
def client(session, monkeypatch):
    site = Site(code="SITE-MPIFKF", name="MPI-FKF")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-3", name="Lab 3", site_id=site.id)
    session.add(lab)
    session.flush()
    zone = Zone(code="ZONE-1", name="Zone 1", lab_id=lab.id)
    session.add(zone)
    session.flush()
    cell = Workcell(code="CELL-A", name="Cell A", zone_id=zone.id)
    session.add(cell)
    session.flush()
    bench = Bench(code="BENCH-A2", name="Bench A2", workcell_id=cell.id)
    session.add(bench)
    session.flush()
    station = Station(code="HP1", name="HP1", bench_id=bench.id)
    session.add(station)
    session.flush()
    cc = CapabilityClass(name="HeaterStirrer", actions={"heat": {}, "stir": {}})
    session.add(cc)
    session.flush()
    device = Device(
        code="DEV-HP-001",
        name="Hotplate H1",
        capability_class_id=cc.id,
        capabilities=["heat", "stir"],
        operational_mode="read_write",
    )
    session.add(device)
    session.flush()
    session.add(StationDeviceBinding(station_id=station.id, device_id=device.id, role="owns"))
    session.commit()

    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def test_list_and_get_site(client):
    r = client.get("/api/v1/sites")
    assert r.status_code == 200
    assert [s["code"] for s in r.json()] == ["SITE-MPIFKF"]

    r = client.get("/api/v1/sites/SITE-MPIFKF")
    assert r.status_code == 200
    assert r.json()["name"] == "MPI-FKF"


def test_get_by_uuid_or_code_both_work(client):
    by_code = client.get("/api/v1/sites/SITE-MPIFKF").json()
    by_id = client.get(f"/api/v1/sites/{by_code['id']}").json()
    assert by_id == by_code


def test_not_found_returns_rfc9457_problem_details(client):
    r = client.get("/api/v1/sites/does-not-exist")
    assert r.status_code == 404
    assert r.headers["content-type"] == "application/problem+json"
    body = r.json()
    assert body["status"] == 404
    assert "does-not-exist" in body["detail"]


def test_device_includes_station_code_and_capability_class(client):
    r = client.get("/api/v1/devices/DEV-HP-001")
    assert r.status_code == 200
    body = r.json()
    assert body["station_code"] == "HP1"
    assert body["capability_class_id"] is not None


def test_device_filters(client):
    assert len(client.get("/api/v1/devices?lab=LAB-3").json()) == 1
    assert len(client.get("/api/v1/devices?lab=NOPE").json()) == 0
    assert len(client.get("/api/v1/devices?capability=heat").json()) == 1
    assert len(client.get("/api/v1/devices?capability=nonexistent").json()) == 0
    assert len(client.get("/api/v1/devices?capability_class=HeaterStirrer").json()) == 1
    assert len(client.get("/api/v1/devices?mode=maintenance").json()) == 0


def test_device_classes_endpoint(client):
    r = client.get("/api/v1/device-classes")
    assert r.status_code == 200
    assert [c["name"] for c in r.json()] == ["HeaterStirrer"]


def test_topology_filters(client):
    assert len(client.get("/api/v1/labs?site=SITE-MPIFKF").json()) == 1
    assert len(client.get("/api/v1/labs?site=NOPE").json()) == 0
    assert len(client.get("/api/v1/stations?bench=BENCH-A2").json()) == 1
