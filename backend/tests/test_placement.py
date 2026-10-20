"""Default placement (`find_free_slot_2d`) -- parent-local, collision-free, multi-row."""

from app.core.shared_schema.geometry.logic import find_free_slot_2d
from app.core.shared_schema.geometry.schema import GeometryDescriptor


def box(pos, dim):
    return GeometryDescriptor(detail="t", box_position_xyz=pos, box_dimension_xyz=dim)


def test_parent_offset_does_not_leak_into_child_position():
    parent = box((6, 0, 0), (6, 10, 3))
    slot = find_free_slot_2d(parent, [], box((0, 0, 0), (1, 1, 1)))
    assert slot.box_position_xyz == (0, 0, 0)


def test_second_row_is_searched_from_x_zero():
    parent = box((0, 0, 0), (2, 2, 1))
    taken = [box((0, 0, 0), (1, 1, 1)), box((1, 0, 0), (1, 1, 1))]
    slot = find_free_slot_2d(parent, taken, box((0, 0, 0), (1, 1, 1)))
    assert slot.box_position_xyz == (0, 1, 0)


def test_full_parent_returns_none():
    parent = box((0, 0, 0), (1, 1, 1))
    assert find_free_slot_2d(parent, [box((0, 0, 0), (1, 1, 1))], box((0, 0, 0), (1, 1, 1))) is None


def test_station_in_offset_lab_lands_on_that_labs_floor(client, layout):
    assert layout["lab2"]["object_geometry"]["box_position_xyz"] == [6, 0, 0]
    station = client.post(
        "/api/v1/stations", json={"name": "S2", "lab_uuid": layout["lab2"]["uuid"]}
    ).json()
    assert station["object_geometry"]["box_position_xyz"] == [0, 0, 0]


def test_device_in_offset_station_lands_inside_the_station(client, layout):
    # Move the station away from the lab origin, then add two devices to it.
    client.patch(
        f"/api/v1/stations/{layout['station']['uuid']}",
        json={"object_geometry": {**layout["station"]["object_geometry"], "box_position_xyz": [3, 4, 0]}},
    ).raise_for_status()
    first = client.post("/api/v1/devices", json={"name": "D1", "station_uuid": layout["station"]["uuid"]}).json()
    second = client.post("/api/v1/devices", json={"name": "D2", "station_uuid": layout["station"]["uuid"]}).json()
    assert first["object_geometry"]["box_position_xyz"] == [0, 0, 0]
    assert second["object_geometry"]["box_position_xyz"] == [0.1, 0, 0]


def test_parallel_requests_never_drop_auth(client, layout):
    """Regression: a shared single sqlite connection made parallel requests 401 at random."""
    from concurrent.futures import ThreadPoolExecutor

    paths = ["/api/v1/sites", "/api/v1/labs", "/api/v1/stations", "/api/v1/zones", "/api/v1/devices"] * 8
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda p: client.get(p).status_code, paths))
    assert set(codes) == {200}


def test_zones_keep_off_sibling_zones(client, layout):
    lab = layout["lab1"]["uuid"]
    first = client.post("/api/v1/zones", json={"name": "Z1", "parent_uuid": lab}).json()
    second = client.post("/api/v1/zones", json={"name": "Z2", "parent_uuid": lab}).json()
    assert first["object_geometry"]["box_position_xyz"] == [0, 0, 0]
    assert second["object_geometry"]["box_position_xyz"] == [2, 0, 0]
