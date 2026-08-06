"""Regression tests for the defects found in the backend review.

Each test here corresponds to a bug that was real, not hypothetical — see
the comment on each one for what used to happen.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from epichem import exporter
from epichem.api.schemas import DeviceOut
from epichem.models import (
    Bench,
    CapabilityClass,
    Device,
    Lab,
    Signal,
    Site,
    Station,
    StationDeviceBinding,
    Workcell,
    Zone,
)
from epichem.registry import delete_entity


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def _chain(session, suffix=""):
    """A real Site -> Lab -> Zone -> Workcell -> Bench -> Station chain."""
    site = Site(code=f"SITE{suffix}", name="Site")
    session.add(site)
    session.flush()
    lab = Lab(code=f"LAB{suffix}", name="Lab", site_id=site.id)
    session.add(lab)
    session.flush()
    zone = Zone(code=f"ZONE{suffix}", name="Zone", lab_id=lab.id)
    session.add(zone)
    session.flush()
    cell = Workcell(code=f"CELL{suffix}", name="Cell", zone_id=zone.id)
    session.add(cell)
    session.flush()
    bench = Bench(code=f"BENCH{suffix}", name="Bench", workcell_id=cell.id)
    session.add(bench)
    session.flush()
    station = Station(code=f"ST{suffix}", name="Station", bench_id=bench.id)
    session.add(station)
    session.flush()
    return station


def _bound_device(session, station, code="DEV-1"):
    cc = session.execute(select(CapabilityClass)).scalars().first()
    if cc is None:
        cc = CapabilityClass(name="Class", actions={})
        session.add(cc)
        session.flush()
    device = Device(code=code, name="Device", capability_class_id=cc.id)
    session.add(device)
    session.flush()
    session.add(StationDeviceBinding(station_id=station.id, device_id=device.id, role="owns"))
    session.flush()
    return device


def test_sqlite_enforces_foreign_keys(session):
    """The test/dev engine used to run with sqlite's foreign keys off, so
    referential-integrity bugs were invisible until Postgres. Now a dangling
    FK fails here too."""
    from sqlalchemy.exc import IntegrityError

    from epichem.idgen import uuid7

    session.add(Station(code="ORPHAN", name="Orphan", bench_id=uuid7()))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_deleting_a_device_removes_its_station_binding(session):
    """Used to be unfixable in both directions: with foreign keys enforced
    the delete raised IntegrityError forever (every device imported with
    `location.station` has a binding), and with them off it left an orphaned
    binding row behind."""
    station = _chain(session)
    device = _bound_device(session, station)

    delete_entity(session, device, "Device", DeviceOut)
    session.flush()

    assert session.execute(select(Device)).scalars().all() == []
    assert session.execute(select(StationDeviceBinding)).scalars().all() == []


def test_deleting_a_device_removes_its_signals(session):
    """Same defect, other child table — this one bites as soon as M2's
    introspection service starts populating signals."""
    station = _chain(session)
    device = _bound_device(session, station)
    session.add(Signal(device_id=device.id, name="temperature"))
    session.flush()

    delete_entity(session, device, "Device", DeviceOut)
    session.flush()

    assert session.execute(select(Signal)).scalars().all() == []


def test_deleting_a_station_unbinds_but_keeps_the_device(session):
    """A binding is a link: dropping the station drops the link, not the
    device at the other end."""
    station = _chain(session)
    device = _bound_device(session, station)

    session.delete(station)
    session.flush()

    assert session.execute(select(StationDeviceBinding)).scalars().all() == []
    assert [d.code for d in session.execute(select(Device)).scalars()] == [device.code]


def test_delete_device_endpoint_returns_204_for_a_bound_device(client, session):
    """The HTTP symptom of the same bug: DELETE /devices/{code} answered 409
    'still referenced by other records' for any device with a station."""
    station = _chain(session)
    _bound_device(session, station, code="DEV-HTTP")
    session.commit()

    assert client.delete("/api/v1/devices/DEV-HTTP").status_code == 204
    assert client.get("/api/v1/devices/DEV-HTTP").status_code == 404


def test_export_dir_does_not_let_one_topology_row_overwrite_another(session, tmp_path):
    """Codes are unique per table, not globally, and all six topology kinds
    share one directory — a Site and a Lab both coded 'A' used to write the
    same file, so the Site was silently lost."""
    site = Site(code="A", name="Site A")
    session.add(site)
    session.flush()
    session.add(Lab(code="A", name="Lab A", site_id=site.id))
    session.flush()

    written = exporter.export_dir(session, tmp_path)

    assert len(written) == len(set(written)) == 2
    kinds = sorted(p.read_text().splitlines()[1] for p in written)
    assert kinds == ["kind: Lab", "kind: Site"]


def test_export_dir_survives_two_codes_that_slugify_the_same(session, tmp_path):
    """'A/B' and 'A-B' both slugify to 'a-b'; neither may clobber the other."""
    session.add(Site(code="A/B", name="One"))
    session.add(Site(code="A-B", name="Two"))
    session.flush()

    written = exporter.export_dir(session, tmp_path)

    assert len(written) == len(set(written)) == 2
    assert {Path(p).name for p in written} == {"site-a-b.yaml", "site-a-b-2.yaml"}


def test_device_out_exposes_every_device_column(client, session):
    """network_netbox_device_id was a real column that no response schema
    mentioned — so it was absent from the API *and* from the Revision
    snapshots that are supposed to be a full record of the row."""
    station = _chain(session)
    device = _bound_device(session, station, code="DEV-COLS")
    device.network_netbox_device_id = 4242
    device.transport_quality = "degraded"
    session.commit()

    body = client.get("/api/v1/devices/DEV-COLS").json()
    assert body["network_netbox_device_id"] == 4242
    assert body["transport_quality"] == "degraded"

    persisted = {c.name for c in Device.__table__.columns}
    exposed = set(DeviceOut.model_fields) | {"created_at", "updated_at"}
    assert persisted - exposed == set()
