from uuid import UUID

from app.core.shared_schema.geometry.logic import find_free_slot_2d
from app.core.shared_schema.geometry.schema import GeometryDescriptor

default_geometry_descriptor = GeometryDescriptor(
    detail="Lab Outline",
    shape="rectangle",
    box_position_xyz=(0, 0, 0),
    box_dimension_xyz=(6, 10, 3)
)


def get_default_geometry(data: dict) -> GeometryDescriptor:
    """Pydantic default_factory: `data` is the already-validated sibling fields (Pydantic 2.11+)."""
    from app.core.database.session_config import SessionLocal
    from app.modules.device_managment.site.schema import SiteDB  # deferred: avoids a site<->lab import cycle

    site_uuid: UUID = data["site_uuid"]

    with SessionLocal() as session:
        site = session.get(SiteDB, site_uuid)
        if site is None or not site.object_geometry:
            return default_geometry_descriptor

        # site.object_geometry is a list of floors (JSON) -- there's no floor selection on
        # Lab yet, so the first floor is used as the placement parent.
        parent = GeometryDescriptor(**site.object_geometry[0])
        existing = [GeometryDescriptor(**lab.object_geometry) for lab in site.labs if lab.object_geometry]
        return find_free_slot_2d(parent, existing, default_geometry_descriptor) or default_geometry_descriptor
