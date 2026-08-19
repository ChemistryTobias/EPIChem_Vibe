from uuid import UUID

from app.core.geometry.logic import find_free_slot_2d
from app.core.geometry.schema import GeometryDescriptor

default_geometry_descriptor = GeometryDescriptor(
    detail="Device Outline",
    shape="rectangle",
    box_position_xyz=(0, 0, 0),
    box_dimension_xyz=(0.1, 0.1, 0.1)
)


def get_default_geometry(data: dict) -> GeometryDescriptor:
    """Pydantic default_factory: `data` is the already-validated sibling fields (Pydantic 2.11+)."""
    from app.core.database.session_config import SessionLocal
    from app.modules.device_managment.station.schema import StationDB  # deferred: avoids a station<->devices import cycle

    station_uuid: UUID = data["station_uuid"]

    with SessionLocal() as session:
        station = session.get(StationDB, station_uuid)
        if station is None or station.object_geometry is None:
            return default_geometry_descriptor

        # the JSON column gives back plain dicts, not GeometryDescriptor instances -- convert first.
        parent = GeometryDescriptor(**station.object_geometry)
        existing = [GeometryDescriptor(**module.object_geometry) for module in station.modules if module.object_geometry]
        existing += [GeometryDescriptor(**device.object_geometry) for device in station.devices if device.object_geometry]
        return find_free_slot_2d(parent, existing, default_geometry_descriptor) or default_geometry_descriptor
