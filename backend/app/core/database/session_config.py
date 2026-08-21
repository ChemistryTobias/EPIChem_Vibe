import os

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./site.db")
# check_same_thread is a sqlite-only connect arg; psycopg rejects it.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=os.environ.get("SQL_ECHO", "false").lower() == "true",
)
SessionLocal = sessionmaker(bind=engine)


def get_session():
    """FastAPI dependency: yield a session for each request, auto-close after."""
    with SessionLocal() as session:
        yield session


@event.listens_for(Session, "before_flush")
def _protect_primary_keys(session, flush_context, instances):
    """Make primary keys (the uuid) immutable across every model.

    NOTE: bulk `session.execute(update(...))` or direct database write bypasses this protection.
    """
    for obj in session.dirty:
        state = inspect(obj)
        for pk_col in state.mapper.primary_key:
            if state.get_history(pk_col.key, True).has_changes():
                raise ValueError(
                    f"Cannot update primary key '{pk_col.key}' on "
                    f"{obj.__class__.__name__}. Primary keys are immutable."
                )
