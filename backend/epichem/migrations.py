"""Programmatic access to the Alembic migration tree.

`epichem init-db` used to call `Base.metadata.create_all`, which is fine for
a schema that's still finding its shape and useless the moment a second
deployment needs to upgrade in place. Migrations are now the only way the
schema is created or changed, so "fresh database" and "existing database"
follow the same path.

The tree lives inside the package (`epichem/alembic/`) so this works from
any working directory, not just `backend/`.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from epichem.db import make_engine

PACKAGE_DIR = Path(__file__).resolve().parent
ALEMBIC_INI = PACKAGE_DIR / "alembic.ini"


def alembic_config() -> Config:
    config = Config(str(ALEMBIC_INI))
    # `%(here)s` in alembic.ini resolves against the ini's own directory, so
    # script_location is already absolute; setting it again keeps this
    # working if the ini is ever moved or overridden.
    config.set_main_option("script_location", str(PACKAGE_DIR / "alembic"))
    return config


def upgrade(revision: str = "head") -> None:
    command.upgrade(alembic_config(), revision)


def downgrade(revision: str) -> None:
    command.downgrade(alembic_config(), revision)


def current_revision() -> str | None:
    """The revision the configured database is at, or None if it has never
    been migrated. Read directly rather than via `alembic current`, which
    reports through logging and so can't be returned to a caller.
    """
    with make_engine().connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def head_revision() -> str | None:
    """The newest revision in the migration tree."""
    return ScriptDirectory.from_config(alembic_config()).get_current_head()
