from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.device_managment.lab.schema import LabDB
from app.modules.device_managment.site.schema import SiteDB

from .schema import ZoneDB


def resolve_parent_type(session: Session, parent_uuid: UUID) -> str:
    """Derive parent_type from parent_uuid by checking which table it actually belongs to."""
    if session.get(SiteDB, parent_uuid) is not None:
        return SiteDB.__object_type__
    if session.get(LabDB, parent_uuid) is not None:
        return LabDB.__object_type__
    raise HTTPException(status_code=400, detail="parent_uuid does not match any existing site or lab.")


def validate_zone_parent(
    session: Session, zone_uuid: UUID, expected_parent_type: str, expected_parent_uuid: UUID
) -> ZoneDB:
    """Look up `zone_uuid` and confirm it was created under `expected_parent_type`/`expected_parent_uuid`."""
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
