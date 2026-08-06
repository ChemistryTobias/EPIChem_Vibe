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

    cell = Workcell(code="CELL-A", name="Cell A", zone_id=zone.id)
    session.add(cell)
    session.flush()

    bench = Bench(code="BENCH-A2", name="Bench A2", workcell_id=cell.id)
    session.add(bench)
    session.flush()

    station = Station(code="HP1", name="HP1", bench_id=bench.id)
    session.add(station)
    session.commit()

    assert lab.site_id == site.id
    assert station.bench.workcell.zone.lab.site_id == site.id


def test_device_capability_class_and_station_binding(session):
    cc = CapabilityClass(name="HeaterStirrer", actions={"heat": {}, "stir": {}})
    session.add(cc)
    bench = Bench(code="BENCH-A2", name="Bench A2", workcell_id=_seed_workcell(session).id)
    session.add(bench)
    session.flush()
    station = Station(code="HP1", name="HP1", bench_id=bench.id)
    session.add(station)
    session.flush()

    device = Device(
        code="DEV-HP-001",
        name="Hotplate H1",
        capability_class_id=cc.id,
        capabilities=["heat", "stir"],
    )
    session.add(device)
    session.flush()
    session.add(StationDeviceBinding(station_id=station.id, device_id=device.id, role="owns"))
    session.commit()

    assert device.capability_class_id == cc.id
    assert device.capabilities == ["heat", "stir"]


def test_device_containment_tree(session):
    parent = Device(code="DEV-LH-001", name="Liquid Handler 01")
    session.add(parent)
    session.flush()
    child = Device(code="DEV-LH-001-ARM", name="Arm", parent_id=parent.id)
    session.add(child)
    session.commit()

    assert child.parent_id == parent.id
    assert child in parent.children


def _seed_workcell(session) -> Workcell:
    site = Site(code="SITE-X", name="Site X")
    session.add(site)
    session.flush()
    lab = Lab(code="LAB-X", name="Lab X", site_id=site.id)
    session.add(lab)
    session.flush()
    zone = Zone(code="ZONE-X", name="Zone X", lab_id=lab.id)
    session.add(zone)
    session.flush()
    cell = Workcell(code="CELL-X", name="Cell X", zone_id=zone.id)
    session.add(cell)
    session.flush()
    return cell
