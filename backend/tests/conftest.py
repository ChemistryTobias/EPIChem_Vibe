import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from epichem.db import enable_sqlite_foreign_keys
from epichem.models import Base

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_DESCRIPTORS_DIR = REPO_ROOT / "descriptors"

#: Point the suite at a real database instead of in-memory sqlite:
#:
#:     EPICHEM_TEST_DATABASE_URL=postgresql+psycopg://... pytest
#:
#: Unset — the default everywhere except the CI `test:postgres` job — nothing
#: about this suite changes. The seam exists because sqlite and Postgres
#: disagree in ways this codebase actually depends on: JSON column querying,
#: type affinity, and transactional DDL. ADR 0004's revision write path has
#: only ever been exercised on sqlite, which PROJECT_MILESTONES.md flags as an
#: open risk; this is how that gets closed.
TEST_DATABASE_URL_ENV = "EPICHEM_TEST_DATABASE_URL"


@pytest.fixture
def engine():
    url = os.environ.get(TEST_DATABASE_URL_ENV)
    if url:
        engine = create_engine(url)
        # A real database persists between tests, so each one has to start
        # from a known-empty schema. drop_all first as well as last: a test
        # killed mid-run would otherwise poison every test after it.
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        yield engine
        Base.metadata.drop_all(engine)
        engine.dispose()
        return

    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    # Same PRAGMA the app sets (epichem.db) — without it the suite would run
    # with foreign keys unenforced and miss exactly the integrity bugs that
    # would show up against Postgres.
    enable_sqlite_foreign_keys(engine)
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture
def example_descriptors_dir() -> Path:
    return EXAMPLE_DESCRIPTORS_DIR
