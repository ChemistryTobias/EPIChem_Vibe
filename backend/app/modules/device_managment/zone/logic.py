from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.shared_schema.geometry.schema import GeometryDescriptor
from app.modules.device_managment.lab.schema import LabDB
# Neither SiteDB nor ZoneDB is imported at module level: site.schema imports this
# module's Zone (for its zone list) and zone.schema imports get_default_geometry
# from here, so both would close a cycle.

default_geometry_site = GeometryDescriptor(
    detail="Zone Outline", shape="rectangle", box_position_xyz=(0, 0, 0), box_dimension_xyz=(10, 10, 3)
)
default_geometry_lab = GeometryDescriptor(
    detail="Zone Outline", shape="rectangle", box_position_xyz=(0, 0, 0), box_dimension_xyz=(2, 2, 3)
)


def resolve_parent_type(session: Session, parent_uuid: UUID) -> str:
    """Derive parent_type from parent_uuid by checking which table it actually belongs to."""
    from app.modules.device_managment.site.schema import SiteDB  # deferred: see above

    if session.get(SiteDB, parent_uuid) is not None:
        return SiteDB.__object_type__
    if session.get(LabDB, parent_uuid) is not None:
        return LabDB.__object_type__
    raise HTTPException(status_code=400, detail="parent_uuid does not match any existing site or lab.")


def get_default_geometry(data: dict) -> GeometryDescriptor:
    """Pydantic default_factory: `data` is the already-validated sibling fields (Pydantic 2.11+)."""
    from app.core.database.session_config import SessionLocal

    with SessionLocal() as session:
        parent_type = resolve_parent_type(session, data["parent_uuid"])

    return default_geometry_site if parent_type == "site" else default_geometry_lab


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
