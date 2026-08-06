import shutil
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from epichem.models import (
    Base,
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
from epichem.reconciler import reconcile

DESCRIPTORS_DIR = Path(__file__).resolve().parents[2] / "descriptors"


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def _copy_descriptors(tmp_path: Path) -> Path:
    dest = tmp_path / "descriptors"
    shutil.copytree(DESCRIPTORS_DIR, dest)
    return dest


def _device_by_code(session, code: str):
    return session.execute(select(Device).where(Device.code == code)).scalar_one_or_none()


def _site_by_code(session, code: str):
    return session.execute(select(Site).where(Site.code == code)).scalar_one_or_none()


def test_full_reconcile_from_empty_creates_everything(session):
    report = reconcile(session, DESCRIPTORS_DIR)

    assert report.ok, report.loader_errors + [i for i in report.items if i.action == "error"]
    assert not report.loader_errors
    assert not any(i.action == "error" for i in report.items)
    assert all(i.action == "created" for i in report.items)

    assert session.execute(select(Site)).scalars().all().__len__() == 1
    assert len(session.execute(select(Lab)).scalars().all()) == 1
    assert len(session.execute(select(Zone)).scalars().all()) == 1
    assert len(session.execute(select(Workcell)).scalars().all()) == 1
    assert len(session.execute(select(Bench)).scalars().all()) == 1
    assert len(session.execute(select(Station)).scalars().all()) == 2
    assert len(session.execute(select(Device)).scalars().all()) == 2
    assert len(session.execute(select(CapabilityClass)).scalars().all()) == 3

    hp1 = session.execute(select(Device).where(Device.code == "DEV-HP-001")).scalar_one()
    st1 = session.execute(select(Device).where(Device.code == "DEV-ST-001")).scalar_one()

    heater_stirrer = session.execute(
        select(CapabilityClass).where(CapabilityClass.name == "HeaterStirrer")
    ).scalar_one()
    stirrer = session.execute(
        select(CapabilityClass).where(CapabilityClass.name == "Stirrer")
    ).scalar_one()

    assert hp1.capability_class_id == heater_stirrer.id
    assert st1.capability_class_id == stirrer.id

    station_hp1 = session.execute(select(Station).where(Station.code == "HP1")).scalar_one()
    station_st1 = session.execute(select(Station).where(Station.code == "ST1")).scalar_one()

    binding_hp1 = session.execute(
        select(StationDeviceBinding).where(StationDeviceBinding.device_id == hp1.id)
    ).scalar_one()
    assert binding_hp1.station_id == station_hp1.id
    assert binding_hp1.role == "owns"

    binding_st1 = session.execute(
        select(StationDeviceBinding).where(StationDeviceBinding.device_id == st1.id)
    ).scalar_one()
    assert binding_st1.station_id == station_st1.id
    assert binding_st1.role == "owns"

    assert not report.drift
    assert heater_stirrer.iri == "http://purl.obolibrary.org/obo/CHMO_0002492"


def test_second_run_is_idempotent(session):
    reconcile(session, DESCRIPTORS_DIR)

    report2 = reconcile(session, DESCRIPTORS_DIR)

    assert report2.ok
    assert all(i.action == "unchanged" for i in report2.items)
    assert len(session.execute(select(Device)).scalars().all()) == 2
    assert len(session.execute(select(Site)).scalars().all()) == 1
    assert len(session.execute(select(CapabilityClass)).scalars().all()) == 3
    assert len(session.execute(select(StationDeviceBinding)).scalars().all()) == 2


def test_field_change_reports_updated_others_unchanged(session, tmp_path):
    reconcile(session, DESCRIPTORS_DIR)

    changed_dir = _copy_descriptors(tmp_path)
    site_file = changed_dir / "topology" / "site.yaml"
    text = site_file.read_text()
    assert "MPI for Solid State Research" in text
    site_file.write_text(text.replace("MPI for Solid State Research", "MPI Renamed Site"))

    report = reconcile(session, changed_dir)

    site_items = [i for i in report.items if i.kind == "Site" and i.code == "SITE-MPIFKF"]
    assert len(site_items) == 1
    assert site_items[0].action == "updated"

    site = session.execute(select(Site).where(Site.code == "SITE-MPIFKF")).scalar_one()
    assert site.name == "MPI Renamed Site"

    lab_items = [i for i in report.items if i.kind == "Lab" and i.code == "LAB-3"]
    assert len(lab_items) == 1
    assert lab_items[0].action == "unchanged"

    device_items = [i for i in report.items if i.kind == "Device"]
    assert all(i.action == "unchanged" for i in device_items)


def test_device_with_missing_station_is_skipped_others_still_reconcile(session, tmp_path):
    changed_dir = _copy_descriptors(tmp_path)
    hp_file = changed_dir / "devices" / "hotplate_h1.yaml"
    text = hp_file.read_text()
    assert "station: HP1" in text
    hp_file.write_text(text.replace("station: HP1", "station: NOPE-DOES-NOT-EXIST"))

    report = reconcile(session, changed_dir)

    hp_items = [i for i in report.items if i.kind == "Device" and i.code == "DEV-HP-001"]
    assert len(hp_items) == 1
    assert hp_items[0].action == "error"
    assert "NOPE-DOES-NOT-EXIST" in hp_items[0].detail
    assert not report.ok

    assert _device_by_code(session, "DEV-HP-001") is None

    st_items = [i for i in report.items if i.kind == "Device" and i.code == "DEV-ST-001"]
    assert len(st_items) == 1
    assert st_items[0].action == "created"
    assert _device_by_code(session, "DEV-ST-001") is not None

    # unrelated topology still reconciled fine
    assert _site_by_code(session, "SITE-MPIFKF") is not None


def test_device_with_unregistered_capability_is_rejected(session, tmp_path):
    changed_dir = _copy_descriptors(tmp_path)
    st_file = changed_dir / "devices" / "stirrer_s1.yaml"
    text = st_file.read_text()
    old_caps = "capabilities:\n    - stir"
    new_caps = "capabilities:\n    - stir\n    - teleport"
    assert old_caps in text
    st_file.write_text(text.replace(old_caps, new_caps))

    report = reconcile(session, changed_dir)

    st_items = [i for i in report.items if i.kind == "Device" and i.code == "DEV-ST-001"]
    assert len(st_items) == 1
    assert st_items[0].action == "error"
    assert "teleport" in st_items[0].detail
    assert not report.ok

    assert _device_by_code(session, "DEV-ST-001") is None

    hp_items = [i for i in report.items if i.kind == "Device" and i.code == "DEV-HP-001"]
    assert len(hp_items) == 1
    assert hp_items[0].action == "created"


def test_orphaned_device_reported_as_drift_and_not_deleted(session, tmp_path):
    reconcile(session, DESCRIPTORS_DIR)
    assert _device_by_code(session, "DEV-ST-001") is not None

    missing_dir = _copy_descriptors(tmp_path)
    (missing_dir / "devices" / "stirrer_s1.yaml").unlink()

    report = reconcile(session, missing_dir)

    drift_codes = {(i.kind, i.code) for i in report.drift}
    assert ("Device", "DEV-ST-001") in drift_codes

    # never deleted
    assert _device_by_code(session, "DEV-ST-001") is not None


def test_malformed_yaml_does_not_block_valid_descriptors(session, tmp_path):
    changed_dir = _copy_descriptors(tmp_path)
    bad_file = changed_dir / "topology" / "broken.yaml"
    bad_file.write_text("kind: [unterminated\n  this: is not: valid: yaml: at: all\n\t- bad indent")

    report = reconcile(session, changed_dir)

    assert len(report.loader_errors) == 1
    assert "broken.yaml" in str(report.loader_errors[0].path)

    # everything else still reconciles
    assert _device_by_code(session, "DEV-HP-001") is not None
    assert _device_by_code(session, "DEV-ST-001") is not None
    assert _site_by_code(session, "SITE-MPIFKF") is not None
    assert not any(i.action == "error" for i in report.items)
