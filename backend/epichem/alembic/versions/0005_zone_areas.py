"""Zones as 2D areas at site or lab scope (ADR 0015).

A zone gains a drawn rectangle (`pos_x/pos_y/width_m/depth_m`), a free-form
`purpose`, and an optional `site_id` so it can be scoped to a site as well as a
lab — which makes `lab_id` nullable. Geometry/`purpose` are non-null with
server defaults (safe on a populated table); `site_id` is nullable. Mirrors the
model columns exactly so `test_migrations.py`'s model-vs-migration parity holds.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("zones", schema=None) as batch_op:
        batch_op.add_column(sa.Column("site_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("pos_x", sa.Float(), nullable=False, server_default="0.0"))
        batch_op.add_column(sa.Column("pos_y", sa.Float(), nullable=False, server_default="0.0"))
        batch_op.add_column(sa.Column("width_m", sa.Float(), nullable=False, server_default="0.0"))
        batch_op.add_column(sa.Column("depth_m", sa.Float(), nullable=False, server_default="0.0"))
        batch_op.add_column(sa.Column("purpose", sa.String(), nullable=False, server_default="area"))
        batch_op.alter_column("lab_id", existing_type=sa.Uuid(), nullable=True)
        batch_op.create_foreign_key("fk_zones_site_id_sites", "sites", ["site_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("zones", schema=None) as batch_op:
        batch_op.drop_constraint("fk_zones_site_id_sites", type_="foreignkey")
        batch_op.alter_column("lab_id", existing_type=sa.Uuid(), nullable=False)
        batch_op.drop_column("purpose")
        batch_op.drop_column("depth_m")
        batch_op.drop_column("width_m")
        batch_op.drop_column("pos_y")
        batch_op.drop_column("pos_x")
        batch_op.drop_column("site_id")
