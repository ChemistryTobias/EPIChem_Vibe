"""Add the `virtual` soft-hide flag to stations and devices (ADR 0011).

A virtual station/device still exists, lists and revisions normally, but is
hidden from every layout canvas — the Lab-layout editor's "delete" sets this
instead of removing the row, so the hide is reversible from the revision
history (ADR 0004). `test_migrations.py` asserts this leaves the schema equal
to what `Base.metadata.create_all` builds, so the column here must match the
model default (NOT NULL, server default false).

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("stations", "devices"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "virtual",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )


def downgrade() -> None:
    for table in ("devices", "stations"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column("virtual")
