"""Liveness/readiness endpoint.

Not part of the plan's §8.1 API surface — this exists for the infrastructure
around the app rather than for its users: `compose.yaml`'s healthcheck, the
CI `verify` stage's wait loop, and Kubernetes probes
(docs/MILESTONE_CI_CD.md §4). It is deliberately the only route in this app
without an `/api/v1`-prefixed data model behind it.

The distinction that matters here is liveness vs. readiness. The process
being up says nothing about whether it can serve a request, because every
useful endpoint needs the registry. So this touches the database: a `SELECT 1`
plus the Alembic revision the database is actually at. That last one catches
the failure mode migrations are most likely to produce in a rolling deploy —
new code against an old schema — which a process-only check reports as
perfectly healthy right up until the first real query fails.
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from epichem.api.deps import get_session

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get(
    "/health",
    summary="Service health",
    description=(
        "Reports whether the API can reach the registry and which schema "
        "revision that registry is at. Returns 200 when usable and 503 when "
        "not, so it can be used directly as a container healthcheck or a "
        "Kubernetes readiness probe."
    ),
    responses={
        200: {"description": "The API is up and the database answers."},
        503: {"description": "The database is unreachable."},
    },
)
def health(response: Response, session: Session = Depends(get_session)) -> dict:
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:
        # Deliberately not re-raised as a problem+json error: a healthcheck is
        # consumed by Docker and Kubernetes, not by a browser, and swallowing
        # the exception here keeps a database outage from filling the log with
        # a stack trace on every probe interval.
        response.status_code = 503
        return {"status": "unavailable", "database": "error", "detail": str(exc)[:200]}

    # Imported lazily: reading the migration state opens its own connection and
    # is only worth doing once we know the database answers at all.
    from epichem.migrations import current_revision, head_revision

    try:
        current = current_revision()
        head = head_revision()
    except Exception:
        current = head = None

    return {
        "status": "ok",
        "database": "ok",
        "schema_revision": current,
        "schema_head": head,
        # False means the running code expects a schema the database has not
        # been migrated to yet. Still a 200 — the API works, it is the deploy
        # that is half-finished, and failing the probe would take the old pods
        # down too.
        "schema_current": current is not None and current == head,
    }
