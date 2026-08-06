"""limit/offset paging for the list endpoints that can grow without bound.

Applied to `/samples` and `/devices` only. The topology lists are
deliberately left unpaged: a lab has one site, a handful of zones and tens
of stations, and those counts are bounded by physical reality rather than by
usage — a pager there would be ceremony around a query that can never return
a big result. Samples and devices are the two that grow with the work.

The response body stays a plain JSON array; the total goes in an
`X-Total-Count` header. The alternative — wrapping every list in
`{items, total, ...}` — is more self-describing in OpenAPI but changes the
shape of nine endpoints and every caller, to carry one integer.
"""

from fastapi import Query, Response
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

#: Big enough that no realistic single lab is truncated by the default,
#: small enough to stay a sane default response size.
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000

TOTAL_COUNT_HEADER = "X-Total-Count"


def limit_param(
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=MAX_LIMIT,
        description=(
            f"Maximum rows to return (default {DEFAULT_LIMIT}, max {MAX_LIMIT}). "
            f"The total number of matching rows is in the `{TOTAL_COUNT_HEADER}` header."
        ),
    ),
) -> int:
    return limit


def offset_param(
    offset: int = Query(0, ge=0, description="Rows to skip, for paging."),
) -> int:
    return offset


def paginate(
    session: Session, stmt: Select, response: Response, limit: int, offset: int
) -> list:
    """Run `stmt` windowed to limit/offset, and set `X-Total-Count` to how
    many rows it would have returned unwindowed.

    Two queries, on purpose: a window function would fold the count into one
    round trip but would also mean every row carries it, and this runs
    against lab-sized tables where the second query is cheap and the code
    stays readable.
    """
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    response.headers[TOTAL_COUNT_HEADER] = str(total)
    return list(session.execute(stmt.limit(limit).offset(offset)).scalars().unique())
