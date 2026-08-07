from epichem.models import (
    CapabilityClass,
    Device,
    Lab,
    Site,
    Station,
    Zone,
)


def test_topology_chain_persists(session):
    site = Site(code="SITE-MPIFKF", name="MPI-FKF")
    session.add(site)
    session.flush()

    lab = Lab(code="LAB-3", name="Lab 3", site_id=site.id)
    session.add(lab)
    session.flush()

    zone = Zone(code="ZONE-1", name="Zone 1", lab_id=lab.id)
    session.add(zone)
    session.flush()

    # A station belongs to a lab always, and optionally to a zone (ADR 0007).
    station = Station(code="HP1", name="HP1", lab_id=lab.id, zone_id=zone.id)
    session.add(station)
    session.commit()

    assert lab.site_id == site.id
    assert station.lab.site_id == site.id
    assert station.zone.lab.site_id == site.id


def test_station_without_a_zone_is_valid(session):
    """A station may sit directly under a lab (ADR 0007: zone is optional)."""
    site = Site(code="SITE-Z", name="Site")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-Z", name="Lab", site_id=site.id)
    session.add(lab)
    session.flush()

    station = Station(code="ST-Z", name="Station", lab_id=lab.id)
    session.add(station)
    session.commit()

    assert station.zone_id is None
    assert station.lab_id == lab.id


def test_device_belongs_to_a_station(session):
    cc = CapabilityClass(name="HeaterStirrer", actions={"heat": {}, "stir": {}})
    session.add(cc)
    station = _seed_station(session)

    device = Device(
        code="DEV-HP-001",
        name="Hotplate H1",
        station_id=station.id,
        capability_class_id=cc.id,
        capabilities=["heat", "stir"],
    )
    session.add(device)
    session.commit()

    assert device.capability_class_id == cc.id
    assert device.capabilities == ["heat", "stir"]
    assert device.station_id == station.id
    assert device.station_code == "HP1"
    assert device in station.devices


def test_device_containment_tree_with_a_module(session):
    """A module (node_kind="module") groups devices via the parent_id tree."""
    station = _seed_station(session)
    module = Device(
        code="MOD-DECK", name="Deck", node_kind="module", station_id=station.id
    )
    session.add(module)
    session.flush()
    child = Device(
        code="DEV-LH-001", name="Liquid Handler", parent_id=module.id, station_id=station.id
    )
    session.add(child)
    session.commit()

    assert module.node_kind == "module"
    assert child.parent_id == module.id
    assert child in module.children


def _seed_station(session) -> Station:
    site = Site(code="SITE-X", name="Site X")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-X", name="Lab X", site_id=site.id)
    session.add(lab)
    session.flush()
    station = Station(code="HP1", name="HP1", lab_id=lab.id)
    session.add(station)
    session.flush()
    return station
