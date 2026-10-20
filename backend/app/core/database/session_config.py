import atexit
import os
import shutil
import tempfile

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker


def _throwaway_sqlite_url() -> str:
    """A sqlite file in a fresh temp dir, deleted on exit.

    Used when DATABASE_URL is unset. This used to be in-memory sqlite pinned to
    one connection (StaticPool) -- but FastAPI runs sync routes on a thread
    pool, so parallel requests shared that one connection and trampled each
    other's transactions: the auth lookup of one request intermittently came
    back empty, the API answered 401, and the console signed itself out. A
    file gives every thread its own connection and sqlite's own locking,
    while keeping the "wiped on every restart" behaviour.
    """
    directory = tempfile.mkdtemp(prefix="epichem-")
    atexit.register(shutil.rmtree, directory, ignore_errors=True)
    return f"sqlite:///{os.path.join(directory, 'epichem.db')}"


DATABASE_URL = os.environ.get("DATABASE_URL") or _throwaway_sqlite_url()
is_sqlite = DATABASE_URL.startswith("sqlite")
# check_same_thread is a sqlite-only connect arg; psycopg rejects it.
connect_args = {"check_same_thread": False, "timeout": 15} if is_sqlite else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=os.environ.get("SQL_ECHO", "false").lower() == "true",
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        """WAL lets readers run alongside a writer; foreign keys are off by default in sqlite."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


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
