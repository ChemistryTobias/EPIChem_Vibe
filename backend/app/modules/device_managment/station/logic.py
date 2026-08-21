from uuid import UUID

from app.core.shared_schema.geometry.logic import find_free_slot_2d
from app.core.shared_schema.geometry.schema import GeometryDescriptor

default_geometry_descriptor = GeometryDescriptor(
    detail="Station Outline",
    shape="rectangle",
    box_position_xyz=(0, 0, 0),
    box_dimension_xyz=(1, 1, 1)
)


def get_default_geometry(data: dict) -> GeometryDescriptor:
    """Pydantic default_factory: `data` is the already-validated sibling fields (Pydantic 2.11+)."""
    from app.core.database.session_config import SessionLocal
    from app.modules.device_managment.lab.schema import LabDB  # deferred: avoids a lab<->station import cycle

    lab_uuid: UUID = data["lab_uuid"]

    with SessionLocal() as session:
        lab = session.get(LabDB, lab_uuid)
        if lab is None or lab.object_geometry is None:
            return default_geometry_descriptor

        # the JSON column gives back plain dicts, not GeometryDescriptor instances -- convert first.
        parent = GeometryDescriptor(**lab.object_geometry)
        existing = [GeometryDescriptor(**station.object_geometry) for station in lab.stations if station.object_geometry]
        return find_free_slot_2d(parent, existing, default_geometry_descriptor) or default_geometry_descriptor
