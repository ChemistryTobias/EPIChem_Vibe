"""Engine/session setup. Reads DATABASE_URL; falls back to a local sqlite
file so `epichem` runs with zero external services for a quick look, per
G8 ("a single-cell lab should run from one `docker compose up` with
defaults"). Production deployments set DATABASE_URL to Postgres.
"""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_SQLITE_URL = "sqlite:///./epichem.db"


def make_engine(url: str | None = None):
    url = url or os.environ.get("DATABASE_URL", DEFAULT_SQLITE_URL)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
