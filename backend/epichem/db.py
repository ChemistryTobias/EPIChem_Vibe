"""Engine/session setup. Reads DATABASE_URL; falls back to a local sqlite
file so `epichem` runs with zero external services for a quick look, per
G8 ("a single-cell lab should run from one `docker compose up` with
defaults"). Production deployments set DATABASE_URL to Postgres.

sqlite ships with foreign-key enforcement *off*, which would mean local dev
and the whole test suite run with referential integrity silently disabled —
so a delete that Postgres rejects would quietly orphan rows here instead.
`enable_sqlite_foreign_keys` turns it on per connection; `make_engine` calls
it, and so does the test fixture, so both environments behave the same way.
"""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_SQLITE_URL = "sqlite:///./epichem.db"


def enable_sqlite_foreign_keys(engine: Engine) -> Engine:
    """No-op for non-sqlite engines, so callers don't have to check."""
    if engine.dialect.name != "sqlite":
        return engine

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_connection, _connection_record):  # pragma: no cover - trivial
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def make_engine(url: str | None = None) -> Engine:
    url = url or os.environ.get("DATABASE_URL", DEFAULT_SQLITE_URL)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return enable_sqlite_foreign_keys(create_engine(url, connect_args=connect_args))


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
