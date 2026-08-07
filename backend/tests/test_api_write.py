"""Tests for the write API (ADR 0004): POST/PUT/DELETE + revisions for the
registry kinds. Matches test_api.py's TestClient + sqlite-in-memory
pattern; each test builds its own client fixture rather than sharing
test_api.py's pre-seeded one, since these tests mostly create their own data
through the endpoints under test.
"""

import pytest
from fastapi.testclient import TestClient

from epichem.models import CapabilityClass, Lab, Site, Station


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def _site_descriptor(code: str, name: str) -> dict:
    return {
        "apiVersion": "epichem.dev/v1",
        "kind": "Site",
        "metadata": {"code": code, "name": name},
        "spec": {},
    }


def _lab_descriptor(code: str, name: str, site_code: str) -> dict:
    return {
        "apiVersion": "epichem.dev/v1",
        "kind": "Lab",
        "metadata": {"code": code, "name": name},
        "spec": {"site": site_code},
    }


def test_post_creates_site_and_conflicts_on_duplicate_code(client):
    r = client.post("/api/v1/sites", json=_site_descriptor("SITE-A", "Site A"))
    assert r.status_code == 201
    body = r.json()
    assert body["code"] == "SITE-A"
    assert body["name"] == "Site A"
    assert "id" in body

    r = client.post("/api/v1/sites", json=_site_descriptor("SITE-A", "Site A dup"))
    assert r.status_code == 409
    assert r.headers["content-type"] == "application/problem+json"


def test_put_updates_site_name_get_reflects_change_and_404_for_missing(client):
    client.post("/api/v1/sites", json=_site_descriptor("SITE-B", "Site B"))

    r = client.put("/api/v1/sites/SITE-B", json=_site_descriptor("SITE-B", "Site B Renamed"))
    assert r.status_code == 200
    assert r.json()["name"] == "Site B Renamed"

    r = client.get("/api/v1/sites/SITE-B")
    assert r.json()["name"] == "Site B Renamed"

    r = client.put("/api/v1/sites/NOPE", json=_site_descriptor("NOPE", "Nope"))
    assert r.status_code == 404


def test_delete_site_then_get_404_and_child_lab_blocks_delete(client):
    client.post("/api/v1/sites", json=_site_descriptor("SITE-C", "Site C"))
    r = client.delete("/api/v1/sites/SITE-C")
    assert r.status_code == 204
    assert client.get("/api/v1/sites/SITE-C").status_code == 404

    client.post("/api/v1/sites", json=_site_descriptor("SITE-D", "Site D"))
    client.post("/api/v1/labs", json=_lab_descriptor("LAB-D1", "Lab D1", "SITE-D"))
    r = client.delete("/api/v1/sites/SITE-D")
    assert r.status_code == 409
    assert r.headers["content-type"] == "application/problem+json"


def test_site_revisions_after_create_and_update(client):
    client.post("/api/v1/sites", json=_site_descriptor("SITE-E", "Site E"))
    client.put("/api/v1/sites/SITE-E", json=_site_descriptor("SITE-E", "Site E v2"))

    r = client.get("/api/v1/sites/SITE-E/revisions")
    assert r.status_code == 200
    revisions = r.json()
    assert [rev["revision_number"] for rev in revisions] == [1, 2]
    assert [rev["action"] for rev in revisions] == ["created", "updated"]
    assert revisions[0]["snapshot"]["name"] == "Site E"
    assert revisions[1]["snapshot"]["name"] == "Site E v2"


def _make_topology_chain(session):
    site = Site(code="SITE-DEV", name="Site Dev")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-DEV", name="Lab Dev", site_id=site.id)
    session.add(lab)
    session.flush()
    station_a = Station(code="STA-A", name="Station A", lab_id=lab.id)
    station_b = Station(code="STA-B", name="Station B", lab_id=lab.id)
    session.add_all([station_a, station_b])
    session.flush()
    cc = CapabilityClass(name="HeaterStirrer", actions={"heat": {}, "stir": {}})
    session.add(cc)
    session.flush()
    session.commit()
    return station_a, station_b, cc


def _device_descriptor(code: str, name: str, station_code: str, capabilities: list[str]) -> dict:
    return {
        "apiVersion": "epichem.dev/v1",
        "kind": "Device",
        "metadata": {"code": code, "name": name},
        "spec": {
            "class": "epichem.classes.HeaterStirrer",
            "transport": {"protocol": "sim"},
            "location": {"station": station_code},
            "capabilities": capabilities,
        },
    }


def test_post_device_with_valid_refs_creates_binding_and_station_code(client, session):
    station_a, _station_b, _cc = _make_topology_chain(session)

    r = client.post(
        "/api/v1/devices", json=_device_descriptor("DEV-1", "Device One", "STA-A", ["heat", "stir"])
    )
    assert r.status_code == 201
    body = r.json()
    assert body["station_code"] == "STA-A"
    assert body["capability_class_id"] is not None

    r = client.get("/api/v1/devices/DEV-1")
    assert r.json()["station_code"] == "STA-A"


def test_post_device_with_unregistered_capability_returns_422(client, session):
    _make_topology_chain(session)

    r = client.post(
        "/api/v1/devices",
        json=_device_descriptor("DEV-2", "Device Two", "STA-A", ["heat", "explode"]),
    )
    assert r.status_code == 422
    assert r.headers["content-type"] == "application/problem+json"


def test_device_revisions_show_correct_station_code_not_null(client, session):
    station_a, station_b, _cc = _make_topology_chain(session)

    client.post(
        "/api/v1/devices", json=_device_descriptor("DEV-3", "Device Three", "STA-A", ["heat"])
    )
    client.put(
        "/api/v1/devices/DEV-3",
        json=_device_descriptor("DEV-3", "Device Three", "STA-B", ["heat"]),
    )

    r = client.get("/api/v1/devices/DEV-3/revisions")
    assert r.status_code == 200
    revisions = r.json()
    assert [rev["revision_number"] for rev in revisions] == [1, 2]
    assert [rev["action"] for rev in revisions] == ["created", "updated"]
    assert revisions[0]["snapshot"]["station_code"] == "STA-A"
    assert revisions[1]["snapshot"]["station_code"] == "STA-B"


def test_station_virtual_defaults_false_and_round_trips(client, session):
    """ADR 0011: `virtual` defaults False on create and a full-replace PUT can
    soft-hide the station (the Lab-layout editor's "delete")."""
    _make_topology_chain(session)

    def station_desc(virtual: bool) -> dict:
        spec = {"lab": "LAB-DEV", "kind": "generic"}
        if virtual:
            spec["virtual"] = True
        return {
            "apiVersion": "epichem.dev/v1",
            "kind": "Station",
            "metadata": {"code": "STA-V", "name": "Station V"},
            "spec": spec,
        }

    r = client.post("/api/v1/stations", json=station_desc(virtual=False))
    assert r.status_code == 201
    assert r.json()["virtual"] is False

    r = client.put("/api/v1/stations/STA-V", json=station_desc(virtual=True))
    assert r.status_code == 200
    assert r.json()["virtual"] is True

    # A subsequent full replace without the field resets it to the default —
    # the full-replace contract the frontend spec builders must respect.
    r = client.put("/api/v1/stations/STA-V", json=station_desc(virtual=False))
    assert r.json()["virtual"] is False


def test_device_virtual_defaults_false_and_round_trips(client, session):
    """ADR 0011: `virtual` on a device/module, same soft-hide as a station."""
    _make_topology_chain(session)
    desc = _device_descriptor("DEV-V", "Device V", "STA-A", ["heat"])

    r = client.post("/api/v1/devices", json=desc)
    assert r.status_code == 201
    assert r.json()["virtual"] is False

    desc["spec"]["virtual"] = True
    r = client.put("/api/v1/devices/DEV-V", json=desc)
    assert r.status_code == 200
    assert r.json()["virtual"] is True


def test_site_and_lab_canvas_geometry_round_trip(client):
    """ADR 0012: the site canvas and the lab's box on it default sensibly and
    survive a full-replace PUT."""
    r = client.post("/api/v1/sites", json=_site_descriptor("SITE-G", "Site G"))
    assert r.status_code == 201
    body = r.json()
    assert (body["width_m"], body["depth_m"], body["grid_size_m"]) == (40.0, 40.0, 1.0)

    r = client.post("/api/v1/labs", json=_lab_descriptor("LAB-G", "Lab G", "SITE-G"))
    assert r.status_code == 201
    body = r.json()
    # Standard 10x10 m box at the site origin by default.
    assert (body["site_pos_x"], body["site_pos_y"]) == (0.0, 0.0)
    assert (body["site_size_x_m"], body["site_size_y_m"]) == (10.0, 10.0)

    placed = _lab_descriptor("LAB-G", "Lab G", "SITE-G")
    placed["spec"].update(site_pos_x=12.5, site_pos_y=3.0, site_size_x_m=8.0, site_size_y_m=6.0)
    r = client.put("/api/v1/labs/LAB-G", json=placed)
    assert r.status_code == 200
    body = r.json()
    assert (body["site_pos_x"], body["site_pos_y"]) == (12.5, 3.0)
    assert (body["site_size_x_m"], body["site_size_y_m"]) == (8.0, 6.0)


def test_device_footprint_defaults_null_and_round_trips(client, session):
    """ADR 0012: a device's footprint is nullable (unplaced → standard 0.1 m on
    the canvas) and a full-replace PUT can set it via location.footprint."""
    _make_topology_chain(session)
    desc = _device_descriptor("DEV-F", "Device F", "STA-A", ["heat"])

    r = client.post("/api/v1/devices", json=desc)
    assert r.status_code == 201
    body = r.json()
    assert (body["size_x_mm"], body["size_y_mm"], body["size_z_mm"]) == (None, None, None)

    desc["spec"]["location"]["footprint"] = {
        "size_x_mm": 150.0,
        "size_y_mm": 120.0,
        "size_z_mm": 90.0,
    }
    r = client.put("/api/v1/devices/DEV-F", json=desc)
    assert r.status_code == 200
    body = r.json()
    assert (body["size_x_mm"], body["size_y_mm"], body["size_z_mm"]) == (150.0, 120.0, 90.0)
