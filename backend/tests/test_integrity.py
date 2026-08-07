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
    CapabilityClass,
    Device,
    Lab,
    Signal,
    Site,
    Station,
)
from epichem.registry import delete_entity


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def _chain(session, suffix=""):
    """A real Site -> Lab -> Station chain (ADR 0007)."""
    site = Site(code=f"SITE{suffix}", name="Site")
    session.add(site)
    session.flush()
    lab = Lab(code=f"LAB{suffix}", name="Lab", site_id=site.id)
    session.add(lab)
    session.flush()
    station = Station(code=f"ST{suffix}", name="Station", lab_id=lab.id)
    session.add(station)
    session.flush()
    return station


def _placed_device(session, station, code="DEV-1"):
    cc = session.execute(select(CapabilityClass)).scalars().first()
    if cc is None:
        cc = CapabilityClass(name="Class", actions={})
        session.add(cc)
        session.flush()
    device = Device(code=code, name="Device", station_id=station.id, capability_class_id=cc.id)
    session.add(device)
    session.flush()
    return device


def test_sqlite_enforces_foreign_keys(session):
    """The test/dev engine used to run with sqlite's foreign keys off, so
    referential-integrity bugs were invisible until Postgres. Now a dangling
    FK fails here too."""
    from sqlalchemy.exc import IntegrityError

    from epichem.idgen import uuid7

    session.add(Station(code="ORPHAN", name="Orphan", lab_id=uuid7()))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_deleting_a_device_that_belongs_to_a_station_succeeds(session):
    """A device is the child of its station (ADR 0007: station is a direct FK),
    so deleting the device is always allowed — the station stays."""
    station = _chain(session)
    device = _placed_device(session, station)

    delete_entity(session, device, "Device", DeviceOut)
    session.flush()

    assert session.execute(select(Device)).scalars().all() == []
    assert [s.code for s in session.execute(select(Station)).scalars()] == [station.code]


def test_deleting_a_device_removes_its_signals(session):
    """Signals are owned by the device — cascade-deleted with it. Bites as soon
    as M2's introspection service starts populating signals."""
    station = _chain(session)
    device = _placed_device(session, station)
    session.add(Signal(device_id=device.id, name="temperature"))
    session.flush()

    delete_entity(session, device, "Device", DeviceOut)
    session.flush()

    assert session.execute(select(Signal)).scalars().all() == []


def test_deleting_a_station_keeps_its_devices_unplaced(session):
    """A station is a group of devices (ADR 0007), and device.station_id is
    nullable — so dropping the station keeps the devices at the other end,
    unplaced (station_id -> None), the same spirit as M1's old station-unbind.
    """
    station = _chain(session)
    device = _placed_device(session, station)

    session.delete(station)
    session.flush()

    assert session.execute(select(Station)).scalars().all() == []
    survivors = session.execute(select(Device)).scalars().all()
    assert [d.code for d in survivors] == [device.code]
    assert survivors[0].station_id is None
    assert survivors[0].station_code is None


def test_delete_device_endpoint_returns_204_for_a_placed_device(client, session):
    """DELETE /devices/{code} succeeds for a device that belongs to a station."""
    station = _chain(session)
    _placed_device(session, station, code="DEV-HTTP")
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
    device = _placed_device(session, station, code="DEV-COLS")
    device.network_netbox_device_id = 4242
    device.transport_quality = "degraded"
    session.commit()

    body = client.get("/api/v1/devices/DEV-COLS").json()
    assert body["network_netbox_device_id"] == 4242
    assert body["transport_quality"] == "degraded"

    persisted = {c.name for c in Device.__table__.columns}
    exposed = set(DeviceOut.model_fields) | {"created_at", "updated_at"}
    assert persisted - exposed == set()
