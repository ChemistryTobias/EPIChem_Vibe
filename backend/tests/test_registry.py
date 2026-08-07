import pytest
from sqlalchemy import select

from epichem.api.schemas import CapabilityClassOut, DeviceOut, SiteOut
from epichem.models import (
    CapabilityClass,
    Device,
    Lab,
    Site,
    Station,
)
from epichem.registry import (
    create_entity,
    delete_entity,
    list_revisions,
    resolve_device_references,
    update_entity,
)


def _make_site_values():
    return {"code": "SITE-A", "name": "Site A", "address": None, "timezone": None}


def test_create_records_revision_matching_snapshot(session):
    obj, revision = create_entity(session, Site, "Site", SiteOut, _make_site_values())

    assert revision.revision_number == 1
    assert revision.action == "created"
    assert revision.entity_type == "Site"
    assert revision.entity_id == obj.id
    assert revision.snapshot == SiteOut.model_validate(obj).model_dump(mode="json")


def test_create_duplicate_natural_key_raises(session):
    create_entity(session, Site, "Site", SiteOut, _make_site_values())

    with pytest.raises(ValueError):
        create_entity(session, Site, "Site", SiteOut, _make_site_values())


def test_update_with_changed_values_records_revision(session):
    obj, _ = create_entity(session, Site, "Site", SiteOut, _make_site_values())

    revision = update_entity(
        session, obj, "Site", SiteOut, {**_make_site_values(), "name": "Renamed"}
    )

    assert revision is not None
    assert revision.revision_number == 2
    assert revision.action == "updated"
    assert obj.name == "Renamed"
    assert revision.snapshot["name"] == "Renamed"


def test_update_with_identical_values_returns_none_and_no_new_revision(session):
    obj, _ = create_entity(session, Site, "Site", SiteOut, _make_site_values())

    revision = update_entity(session, obj, "Site", SiteOut, _make_site_values())

    assert revision is None
    assert len(list_revisions(session, "Site", obj.id)) == 1


def test_delete_records_final_revision_and_removes_row(session):
    obj, _ = create_entity(session, Site, "Site", SiteOut, _make_site_values())
    site_id = obj.id

    revision = delete_entity(session, obj, "Site", SiteOut)

    assert revision.action == "deleted"
    assert revision.revision_number == 2
    assert revision.snapshot["code"] == "SITE-A"
    assert session.execute(select(Site).where(Site.id == site_id)).scalar_one_or_none() is None


def test_list_revisions_ascending_order(session):
    obj, _ = create_entity(session, Site, "Site", SiteOut, _make_site_values())
    update_entity(session, obj, "Site", SiteOut, {**_make_site_values(), "name": "Renamed"})
    delete_entity(session, obj, "Site", SiteOut)

    revisions = list_revisions(session, "Site", obj.id)

    assert [r.revision_number for r in revisions] == [1, 2, 3]
    assert [r.action for r in revisions] == ["created", "updated", "deleted"]


# ---- Device (cross-references + station FK) --------------------------------


def _setup_capability_classes(session):
    heater_stirrer, _ = create_entity(
        session,
        CapabilityClass,
        "CapabilityClass",
        CapabilityClassOut,
        {
            "name": "HeaterStirrer",
            "iri": None,
            "extends": [],
            "actions": {"heat": {}, "stir": {}},
        },
    )
    return heater_stirrer


def _setup_station(session):
    # A real Site->Lab->Station chain (ADR 0007), because foreign keys are
    # enforced in tests (conftest turns on sqlite's PRAGMA foreign_keys, matching
    # what epichem.db does at runtime).
    site = Site(code="SITE-R", name="Site R")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-R", name="Lab R", site_id=site.id)
    session.add(lab)
    session.flush()
    station = Station(code="HP1", name="Hotplate Station 1", lab_id=lab.id)
    session.add(station)
    session.flush()
    return station


def test_device_create_resolves_capability_class_and_station(session):
    _setup_capability_classes(session)
    station = _setup_station(session)

    refs = resolve_device_references(
        session,
        capability_class_ref="epichem.classes.HeaterStirrer",
        capabilities=["heat", "stir"],
        station_code="HP1",
    )

    values = {
        "code": "DEV-HP-002",
        "name": "Hotplate 2",
        "labels": {},
        "station_id": refs["station_id"],
        "capability_class_ref": "epichem.classes.HeaterStirrer",
        "capability_class_id": refs["capability_class_id"],
        "capabilities": ["heat", "stir"],
    }
    obj, revision = create_entity(session, Device, "Device", DeviceOut, values)
    session.flush()

    heater_stirrer = session.execute(
        select(CapabilityClass).where(CapabilityClass.name == "HeaterStirrer")
    ).scalar_one()
    assert obj.capability_class_id == heater_stirrer.id
    assert obj.station_id == station.id
    assert obj.station_code == "HP1"
    assert refs["station_id"] == station.id
    assert refs["parent_id"] is None

    assert revision.action == "created"
    assert revision.snapshot["capability_class_id"] == str(heater_stirrer.id)
    # station is a direct FK now, so the snapshot records it with no patching.
    assert revision.snapshot["station_code"] == "HP1"


def test_device_create_with_unregistered_capability_is_rejected(session):
    _setup_capability_classes(session)

    with pytest.raises(ValueError, match="teleport"):
        resolve_device_references(
            session,
            capability_class_ref="epichem.classes.HeaterStirrer",
            capabilities=["heat", "teleport"],
            station_code=None,
        )

    assert session.execute(select(Device)).scalars().all() == []
