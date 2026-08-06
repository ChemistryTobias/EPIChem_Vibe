"""Sample endpoints (§7.1/§7.3) — read + write.

A minimal, deliberately small slice of §7: one flat `Sample` row, no
composition list, no lineage DAG, no container hierarchy, no event log. See
`epichem/models/sample.py` for the full list of what is deferred to M4 and
why, and docs/adr/0005 for why samples take a plain JSON body here instead
of the descriptor envelope every other kind uses.

Structurally this mirrors `routers/devices.py`'s CapabilityClass endpoints:
`resolve_by_code_or_id` for `{ident}`, writes through
`create_entity`/`update_entity`/`delete_entity` (`epichem.registry`) so each
one records a `Revision` (ADR 0004), and RFC 9457 problem+json on failure.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from epichem.api.deps import get_session
from epichem.api.errors import ConflictProblem
from epichem.api.resolve import resolve_by_code_or_id
from epichem.api.schemas import RevisionOut, SampleOut
from epichem.models import Sample
from epichem.registry import create_entity, delete_entity, list_revisions, update_entity
from epichem.schemas.sample import SAMPLE_STATES, SampleWrite

router = APIRouter(prefix="/api/v1", tags=["samples"])


@router.get(
    "/samples",
    response_model=list[SampleOut],
    summary="List samples",
    description=(
        "Returns every sample, newest first. All filters are optional and "
        "combine with AND. This endpoint is what the frontend's Samples "
        "table reads — there is no pagination yet; add it before pointing "
        "this at a lab with more samples than a table can hold."
    ),
)
def list_samples(
    session: Session = Depends(get_session),
    state: str | None = Query(
        None,
        description=f"Filter by lifecycle state. One of: {', '.join(SAMPLE_STATES)}.",
    ),
    owner: str | None = Query(None, description="Filter by exact owner."),
    substance: str | None = Query(None, description="Filter by exact substance label."),
    q: str | None = Query(
        None,
        description="Case-insensitive substring match against code, name and substance.",
    ),
):
    stmt = select(Sample).order_by(Sample.created_at.desc(), Sample.code.asc())
    if state:
        stmt = stmt.where(Sample.state == state)
    if owner:
        stmt = stmt.where(Sample.owner == owner)
    if substance:
        stmt = stmt.where(Sample.substance == substance)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Sample.code.ilike(pattern),
                Sample.name.ilike(pattern),
                Sample.substance.ilike(pattern),
            )
        )
    return session.execute(stmt).scalars().all()


@router.get(
    "/samples/{ident}",
    response_model=SampleOut,
    summary="Get one sample",
    description="`ident` is either the UUID primary key or the short `code` (e.g. SMP-2026-0041).",
    responses={404: {"description": "No sample with that id or code (problem+json)."}},
)
def get_sample(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Sample, ident)


@router.post(
    "/samples",
    response_model=SampleOut,
    status_code=201,
    summary="Register a sample",
    description=(
        "Creates a sample and records revision 1 in the shared `Revision` "
        "table (ADR 0004). `code` must be unique."
    ),
    responses={409: {"description": "A sample with that code already exists (problem+json)."}},
)
def create_sample(body: SampleWrite, session: Session = Depends(get_session)):
    try:
        obj, _revision = create_entity(session, Sample, "Sample", SampleOut, body.model_dump())
    except ValueError as e:
        raise ConflictProblem(title="Sample already exists", detail=str(e)) from e
    session.commit()
    return obj


@router.put(
    "/samples/{ident}",
    response_model=SampleOut,
    summary="Replace a sample",
    description=(
        "Full replace — every field in the body is written, omitted optional "
        "fields are reset to their defaults. Records a new revision only if "
        "something actually changed (`update_entity` diffs first). Use this "
        "to advance `state`; transition legality is not enforced yet (M4)."
    ),
    responses={404: {"description": "No sample with that id or code (problem+json)."}},
)
def replace_sample(ident: str, body: SampleWrite, session: Session = Depends(get_session)):
    obj = resolve_by_code_or_id(session, Sample, ident)
    update_entity(session, obj, "Sample", SampleOut, body.model_dump())
    session.commit()
    return obj


@router.delete(
    "/samples/{ident}",
    status_code=204,
    summary="Delete a sample",
    description=(
        "Hard-deletes the row after recording a `deleted` revision holding "
        "the pre-delete snapshot, so the history survives the row (ADR 0004)."
    ),
    responses={404: {"description": "No sample with that id or code (problem+json)."}},
)
def delete_sample(ident: str, session: Session = Depends(get_session)):
    obj = resolve_by_code_or_id(session, Sample, ident)
    delete_entity(session, obj, "Sample", SampleOut)
    session.commit()
    return None


@router.get(
    "/samples/{ident}/revisions",
    response_model=list[RevisionOut],
    summary="List a sample's revisions",
    description=(
        "Full-snapshot history, oldest first. This is the config-style audit "
        "trail every registry kind gets, not §7.3's operational SampleEvent "
        "log — that is M4."
    ),
    responses={404: {"description": "No sample with that id or code (problem+json)."}},
)
def list_sample_revisions(ident: str, session: Session = Depends(get_session)):
    obj = resolve_by_code_or_id(session, Sample, ident)
    return list_revisions(session, "Sample", obj.id)
