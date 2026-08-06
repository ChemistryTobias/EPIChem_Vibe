from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from epichem.models import Base

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_DESCRIPTORS_DIR = REPO_ROOT / "descriptors"


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture
def example_descriptors_dir() -> Path:
    return EXAMPLE_DESCRIPTORS_DIR
