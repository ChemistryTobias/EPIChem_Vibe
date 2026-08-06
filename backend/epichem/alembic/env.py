"""Alembic environment.

Two deliberate choices:

- The database URL comes from `epichem.db.make_engine()`, not from
  `alembic.ini`, so migrations always talk to the same database the app does
  (DATABASE_URL, with the sqlite fallback) and there's no second place to
  keep in sync.
- `render_as_batch=True` so ALTER-heavy migrations work on sqlite, which
  can't ALTER most things in place. Postgres ignores it.
"""

from alembic import context

from epichem.db import make_engine
from epichem.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade --sql`)."""
    context.configure(
        url=make_engine().url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine()
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            # Catch a column whose type changed in the models but not in a
            # migration — the failure mode autogenerate is worst at.
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
