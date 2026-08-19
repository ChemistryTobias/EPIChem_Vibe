from typing import Annotated, TypeVar

from fastapi import Query, Response
from sqlalchemy.orm import Query as ORMQuery

T = TypeVar("T")

LimitParam = Annotated[int, Query(le=500)]
OffsetParam = Annotated[int, Query(ge=0)]


def paginate(query: ORMQuery[T], response: Response, limit: int, offset: int) -> list[T]:
    """Apply limit/offset to `query`, reporting the pre-window total via X-Total-Count."""
    response.headers["X-Total-Count"] = str(query.count())
    return query.offset(offset).limit(limit).all()
