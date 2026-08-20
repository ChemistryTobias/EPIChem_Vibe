from typing import Optional
from uuid import UUID

from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from fastapi import APIRouter, Response

from .schema import Revision, RevisionDB

router = APIRouter(prefix="/revisions", tags=["revisions"])


# --- GET ---------------------------------------------------------------------
@router.get("")
def get_all_revisions(
    session: SessionDepends,
    response: Response,
    entity_type: Optional[str] = None,
    entity_uuid: Optional[UUID] = None,
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
):
    """List revisions, optionally filtered to one entity_type and/or entity_uuid."""
    query = session.query(RevisionDB).order_by(RevisionDB.created_at)
    if entity_type is not None:
        query = query.filter_by(entity_type=entity_type)
    if entity_uuid is not None:
        query = query.filter_by(entity_uuid=entity_uuid)
    return paginate(query, response, limit, offset)


@router.get("/{entity_type}/{entity_uuid}", response_model=list[Revision])
def get_entity_revisions(entity_type: str, entity_uuid: UUID, session: SessionDepends):
    """The full revision history for one entity, oldest first."""
    return (
        session.query(RevisionDB)
        .filter_by(entity_type=entity_type, entity_uuid=entity_uuid)
        .order_by(RevisionDB.created_at)
        .all()
    )
