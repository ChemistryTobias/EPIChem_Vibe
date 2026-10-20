"""Sample codes and the one write path for state/location changes (plan §7.3, §7.5)."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .schema import TRANSITIONS, SampleDB, SampleEventDB


def next_code(session: Session, model, prefix: str) -> str:
    """`PREFIX-YYYY-NNNN`: short, human-readable, sortable (plan §5's short codes)."""
    year = datetime.now().year
    stem = f"{prefix}-{year}-"
    latest = session.query(model.code).filter(model.code.like(f"{stem}%")).order_by(model.code.desc()).first()
    number = int(latest[0].rsplit("-", 1)[1]) + 1 if latest else 1
    return f"{stem}{number:04d}"


def can_transition(from_state: str, to_state: str) -> bool:
    return to_state in TRANSITIONS.get(from_state, set())


def transition(
    session: Session,
    sample: SampleDB,
    to_state: str,
    *,
    actor_uuid: Optional[UUID],
    reason: Optional[str] = None,
    run_uuid: Optional[UUID] = None,
    station_uuid: Optional[UUID] = None,
    strict: bool = True,
) -> Optional[SampleEventDB]:
    """Move a sample to `to_state`, logging the event; the caller commits.

    `strict=False` is for automatic transitions (a run progressing): an
    out-of-order one is skipped rather than failing the run's bookkeeping --
    a person may have quarantined the sample meanwhile, and that must win.
    """
    if not can_transition(sample.state, to_state):
        if strict:
            allowed = ", ".join(sorted(TRANSITIONS.get(sample.state, ()))) or "none -- it's final"
            raise HTTPException(
                status_code=409,
                detail=f"A {sample.state} sample can't become {to_state} (allowed: {allowed}).",
            )
        return None
    event = SampleEventDB(
        sample_uuid=sample.uuid,
        from_state=sample.state,
        to_state=to_state,
        actor_uuid=actor_uuid,
        run_uuid=run_uuid,
        station_uuid=station_uuid,
        reason=reason,
    )
    session.add(event)
    sample.state = to_state
    if station_uuid is not None:
        sample.station_uuid = station_uuid
    return event


def register(session: Session, sample: SampleDB, *, actor_uuid, reason: str, station_uuid=None, run_uuid=None):
    """The first event every sample gets: nothing -> registered."""
    session.add(
        SampleEventDB(
            sample_uuid=sample.uuid,
            from_state=None,
            to_state="registered",
            actor_uuid=actor_uuid,
            run_uuid=run_uuid,
            station_uuid=station_uuid,
            reason=reason,
        )
    )
    sample.state = "registered"
