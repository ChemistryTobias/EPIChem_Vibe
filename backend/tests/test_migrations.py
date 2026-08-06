"""The migration tree must produce exactly the schema the models declare.

Without this, `epichem init-db` (alembic) and the test fixtures
(`Base.metadata.create_all`) can drift apart silently — a model gains a
column, nobody writes a migration, and the mismatch only surfaces on a
production deploy.
"""

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect

from epichem import db, migrations
from epichem.models import Base


@pytest.fixture
def migrated_db(tmp_path, monkeypatch):
    """A real file database (not :memory:) — Alembic opens its own
    connection, which an in-memory sqlite database wouldn't share.
    """
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    migrations.upgrade("head")
    return create_engine(url)


def _schema(engine) -> dict:
    inspector = inspect(engine)
    return {
        table: {
            "columns": {c["name"]: str(c["type"]).upper() for c in inspector.get_columns(table)},
            "nullable": {c["name"]: c["nullable"] for c in inspector.get_columns(table)},
            "pk": tuple(inspector.get_pk_constraint(table)["constrained_columns"]),
            "fks": sorted(
                (tuple(fk["constrained_columns"]), fk["referred_table"])
                for fk in inspector.get_foreign_keys(table)
            ),
        }
        for table in inspector.get_table_names()
        if table != "alembic_version"
    }


def test_migrations_match_the_models(migrated_db, tmp_path):
    from_metadata = create_engine(f"sqlite:///{tmp_path / 'metadata.db'}")
    Base.metadata.create_all(from_metadata)

    assert _schema(migrated_db) == _schema(from_metadata)


def test_every_model_table_exists_after_upgrade(migrated_db):
    tables = set(inspect(migrated_db).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert "alembic_version" in tables
    # The tables the reader is most likely to check for by name.
    assert {"samples", "revisions", "station_device_bindings"} <= tables


def test_downgrade_to_base_drops_everything(migrated_db):
    command.downgrade(migrations.alembic_config(), "base")

    remaining = set(inspect(migrated_db).get_table_names()) - {"alembic_version"}
    assert remaining == set()


def test_upgrade_is_idempotent(migrated_db):
    before = _schema(migrated_db)
    migrations.upgrade("head")  # already at head
    assert _schema(migrated_db) == before


def test_alembic_config_points_at_the_packaged_tree():
    config = migrations.alembic_config()
    script_location = config.get_main_option("script_location")
    assert script_location.endswith("epichem/alembic")
    assert (db.DEFAULT_SQLITE_URL, migrations.ALEMBIC_INI.exists()) == (
        "sqlite:///./epichem.db",
        True,
    )
