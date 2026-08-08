"""Site floors + lab floor (ADR 0013).

A layout-only concern: a multi-floor site shows a floor selector on the
Lab-layout canvas, and each lab records which floor it sits on so the plans
don't pile up. Absent from the containment hierarchy. Both columns are non-null
with a server default matching the model default, so the ALTER is safe on a
populated table; `test_migrations.py` compares names/types/nullability, which
this keeps equal to the models.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(sa.Column("floors", sa.Integer(), nullable=False, server_default="1"))

    with op.batch_alter_table("labs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("floor", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("labs", schema=None) as batch_op:
        batch_op.drop_column("floor")

    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("floors")
