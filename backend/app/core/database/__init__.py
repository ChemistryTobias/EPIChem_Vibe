"""Shared database setup: engine, session factory, declarative base, and the
FastAPI session dependency. Every module's models and endpoints import from here.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

engine = create_engine("sqlite:///./site.db", connect_args={"check_same_thread": False}, echo=True)
SessionLocal = sessionmaker(bind=engine)


class Database(DeclarativeBase):
    pass


def get_session():
    with SessionLocal() as session:
        yield session


# Reusable session dependency: type an endpoint parameter as `SessionDepends`
# instead of writing `session: Session = Depends(get_session)` each time.
SessionDepends = Annotated[Session, Depends(get_session)]


@event.listens_for(Session, "before_flush")
def _protect_primary_keys(session, flush_context, instances):
    """Make primary keys (the uuid) immutable across every model.

    Fires on each flush: a persisted row whose PK was reassigned through the ORM
    raises before it can be written. Normal field updates are unaffected, and new
    rows (session.new) are not checked. NOTE: bulk `session.execute(update(...))`
    bypasses the unit-of-work and is not covered — the app never does that.
    """
    for obj in session.dirty:
        state = inspect(obj)
        for pk_col in state.mapper.primary_key:
            if state.get_history(pk_col.key, True).has_changes():
                raise ValueError(
                    f"Cannot update primary key '{pk_col.key}' on "
                    f"{obj.__class__.__name__}. Primary keys are immutable."
                )
