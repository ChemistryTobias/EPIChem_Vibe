from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.shared_schema.geometry.logic import find_free_slot_2d
from app.core.shared_schema.geometry.schema import GeometryDescriptor
from app.modules.device_managment.lab.schema import LabDB
from app.modules.device_managment.site.schema import SiteDB
# ZoneDB not imported at module level: schema.py imports get_default_geometry from here, would be circular.

default_geometry_site = GeometryDescriptor(
    detail="Zone Outline", shape="rectangle", box_position_xyz=(0, 0, 0), box_dimension_xyz=(10, 10, 3)
)
default_geometry_lab = GeometryDescriptor(
    detail="Zone Outline", shape="rectangle", box_position_xyz=(0, 0, 0), box_dimension_xyz=(2, 2, 3)
)


def resolve_parent_type(session: Session, parent_uuid: UUID) -> str:
    """Derive parent_type from parent_uuid by checking which table it actually belongs to."""
    if session.get(SiteDB, parent_uuid) is not None:
        return SiteDB.__object_type__
    if session.get(LabDB, parent_uuid) is not None:
        return LabDB.__object_type__
    raise HTTPException(status_code=400, detail="parent_uuid does not match any existing site or lab.")


def get_default_geometry(data: dict) -> GeometryDescriptor:
    """Pydantic default_factory: `data` is the already-validated sibling fields (Pydantic 2.11+)."""
    from app.core.database.session_config import SessionLocal

    from .schema import ZoneDB  # deferred: schema.py imports this module

    with SessionLocal() as session:
        parent_type = resolve_parent_type(session, data["parent_uuid"])
        default = default_geometry_site if parent_type == "site" else default_geometry_lab

        # Zones keep off their sibling zones (they're drawn around stations/labs,
        # so those don't count) -- same pattern as every other entity.
        if parent_type == "site":
            floors = session.get(SiteDB, data["parent_uuid"]).object_geometry
            parent_geometry = floors[0] if floors else None
        else:
            parent_geometry = session.get(LabDB, data["parent_uuid"]).object_geometry
        if not parent_geometry:
            return default
        siblings = session.query(ZoneDB).filter_by(parent_uuid=data["parent_uuid"]).all()
        existing = [GeometryDescriptor(**z.object_geometry) for z in siblings if z.object_geometry]
        return find_free_slot_2d(GeometryDescriptor(**parent_geometry), existing, default) or default


def validate_zone_parent(
    session: Session, zone_uuid: UUID, expected_parent_type: str, expected_parent_uuid: UUID
) -> "ZoneDB":
    """Look up `zone_uuid` and confirm it was created under `expected_parent_type`/`expected_parent_uuid`."""
    from .schema import ZoneDB  # deferred: schema.py imports get_default_geometry from here, would be circular otherwise

    zone = session.get(ZoneDB, zone_uuid)
    if zone is None:
        raise HTTPException(status_code=400, detail="No zone found with the given zone_uuid.")
    if zone.parent_type != expected_parent_type:
        raise HTTPException(
            status_code=400, detail=f"Zone '{zone.name}' is scoped to a {zone.parent_type}, not a {expected_parent_type}."
        )
    if zone.parent_uuid != expected_parent_uuid:
        raise HTTPException(status_code=400, detail=f"Zone '{zone.name}' does not belong to this object's parent.")
    return zone
