"""Site canvas + lab-on-site box + device footprint (ADR 0012).

Gives the layout editor's two new levels something to write to: the Site is a
metric canvas like the Lab (width/depth/grid), a Lab gets its own box *on that
site canvas* (site_pos/site_size, distinct from its own floor width_m/depth_m),
and a Device gets a footprint within its station's canvas (size_*_mm, matching
the existing pose_*_mm position).

Non-null site/lab columns carry a server default matching the model default so
the ALTER is safe on a populated table; device footprint is nullable (an
unplaced node renders at a standard 0.1 m). `test_migrations.py` compares
names/types/nullability, which this keeps equal to the models.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(sa.Column("width_m", sa.Float(), nullable=False, server_default="40.0"))
        batch_op.add_column(sa.Column("depth_m", sa.Float(), nullable=False, server_default="40.0"))
        batch_op.add_column(
            sa.Column("grid_size_m", sa.Float(), nullable=False, server_default="1.0")
        )

    with op.batch_alter_table("labs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("site_pos_x", sa.Float(), nullable=False, server_default="0.0")
        )
        batch_op.add_column(
            sa.Column("site_pos_y", sa.Float(), nullable=False, server_default="0.0")
        )
        batch_op.add_column(
            sa.Column("site_size_x_m", sa.Float(), nullable=False, server_default="10.0")
        )
        batch_op.add_column(
            sa.Column("site_size_y_m", sa.Float(), nullable=False, server_default="10.0")
        )

    with op.batch_alter_table("devices", schema=None) as batch_op:
        batch_op.add_column(sa.Column("size_x_mm", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("size_y_mm", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("size_z_mm", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("devices", schema=None) as batch_op:
        batch_op.drop_column("size_z_mm")
        batch_op.drop_column("size_y_mm")
        batch_op.drop_column("size_x_mm")

    with op.batch_alter_table("labs", schema=None) as batch_op:
        batch_op.drop_column("site_size_y_m")
        batch_op.drop_column("site_size_x_m")
        batch_op.drop_column("site_pos_y")
        batch_op.drop_column("site_pos_x")

    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("grid_size_m")
        batch_op.drop_column("depth_m")
        batch_op.drop_column("width_m")
