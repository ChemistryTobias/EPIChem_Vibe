"""Samples: list/get/create/edit/delete, and the event log that is the only way to change state (Roadmap 3, plan §7.3)."""

from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.pagination import LimitParam, OffsetParam, paginate
from app.core.revisions.logic import record_revision

from .logic import next_code, register, transition
from .schema import CreateSample, CreateSampleEvent, Sample, SampleDB, SampleDetail, SampleEvent, UpdateSample

router = APIRouter(tags=["samples"])

CurrentUser = Annotated[User, Depends(get_current_user)]


def record_sample(session, sample: SampleDB, action: str, actor_uuid, snapshot: dict | None = None) -> None:
    record_revision(
        session,
        entity_type=SampleDB.__object_type__,
        entity_uuid=sample.uuid,
        action=action,
        snapshot=snapshot or Sample.model_validate(sample).model_dump(mode="json"),
        actor_uuid=actor_uuid,
    )


# --- GET ---------------------------------------------------------------------
@router.get("/samples", response_model=list[Sample])
def get_all_samples(
    session: SessionDepends,
    user: CurrentUser,
    response: Response,
    state: Optional[str] = None,
    run_uuid: Optional[UUID] = None,
    q: Optional[str] = None,
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
):
    """List samples, newest first; filter by state, run, or a code/name/substance search."""
    query = session.query(SampleDB).order_by(SampleDB.created_at.desc(), SampleDB.code.desc())
    if state:
        query = query.filter(SampleDB.state == state)
    if run_uuid:
        query = query.filter(SampleDB.run_uuid == run_uuid)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(SampleDB.code.ilike(like), SampleDB.name.ilike(like), SampleDB.substance.ilike(like)))
    return paginate(query, response, limit, offset)


@router.get("/samples/{identifier}", response_model=SampleDetail)
def get_sample(identifier: str, session: SessionDepends, user: CurrentUser):
    """One sample by UUID or code, with its full event history (oldest first)."""
    try:
        sample = session.get(SampleDB, UUID(identifier))
    except ValueError:
        sample = session.query(SampleDB).filter_by(code=identifier).first()
    if sample is None:
        raise HTTPException(status_code=404, detail="No sample found with the given UUID or code.")
    return sample


# --- POST --------------------------------------------------------------------
@router.post("/samples", response_model=SampleDetail, status_code=201)
def create_sample(body: CreateSample, session: SessionDepends, user: CurrentUser):
    """Register a sample by hand (runs register their own)."""
    data = body.model_dump(exclude={"station_uuid"})
    sample = SampleDB(**data, code=next_code(session, SampleDB, "SMP"), owner_uuid=user.uuid)
    try:
        session.add(sample)
        session.flush()
        register(session, sample, actor_uuid=user.uuid, reason="registered by hand", station_uuid=body.station_uuid)
        if body.station_uuid:
            sample.station_uuid = body.station_uuid
        session.commit()
        session.refresh(sample)
        record_sample(session, sample, "created", user.uuid)
        session.commit()
        return sample
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Could not register the sample (unknown station?).")


@router.post("/samples/{identifier}/events", response_model=SampleDetail, status_code=201)
def add_sample_event(identifier: str, body: CreateSampleEvent, session: SessionDepends, user: CurrentUser):
    """Move a sample through its lifecycle (and optionally to another station)."""
    sample = get_sample(identifier, session, user)
    transition(
        session, sample, body.to_state, actor_uuid=user.uuid, reason=body.reason, station_uuid=body.station_uuid
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Unknown station.")
    session.refresh(sample)
    record_sample(session, sample, "updated", user.uuid)
    session.commit()
    return sample


@router.get("/samples/{identifier}/events", response_model=list[SampleEvent])
def get_sample_events(identifier: str, session: SessionDepends, user: CurrentUser):
    """A sample's event log, oldest first."""
    return get_sample(identifier, session, user).events


# --- PATCH -------------------------------------------------------------------
@router.patch("/samples/{identifier}", response_model=SampleDetail)
def patch_sample(identifier: str, body: UpdateSample, session: SessionDepends, user: CurrentUser):
    """Edit a sample's descriptive fields. State and location change only through events."""
    update = body.model_dump(exclude_unset=True)
    sample = get_sample(identifier, session, user)
    if not update:
        return sample
    for key, value in update.items():
        setattr(sample, key, value)
    session.commit()
    session.refresh(sample)
    record_sample(session, sample, "updated", user.uuid)
    session.commit()
    return sample


# --- DELETE ------------------------------------------------------------------
@router.delete("/samples/{identifier}", status_code=204)
def delete_sample(identifier: str, session: SessionDepends, user: CurrentUser):
    """Delete a sample record and its events. Its revisions stay, as for every entity.

    For a sample that physically left the lab, prefer the `disposed`/`consumed`
    events -- they keep the record; this is for mistakes.
    """
    sample = get_sample(identifier, session, user)
    snapshot = Sample.model_validate(sample).model_dump(mode="json")
    session.delete(sample)
    session.commit()
    record_sample(session, sample, "deleted", user.uuid, snapshot)
    session.commit()
