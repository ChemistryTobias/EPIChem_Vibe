"""Initial registry schema.

Baselines what `Base.metadata.create_all` used to build directly: the six
topology tables, devices/signals/station_device_bindings, capability_classes,
samples, and the shared revisions table (ADR 0004).

`test_migrations.py` asserts that running this produces exactly the schema
the models declare, so the two can't drift apart silently.

Revision ID: 0001
Revises: None
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('capability_classes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('iri', sa.String(), nullable=True),
    sa.Column('extends', sa.JSON(), nullable=False),
    sa.Column('actions', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('capability_classes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_capability_classes_name'), ['name'], unique=True)

    op.create_table('revisions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('entity_type', sa.String(), nullable=False),
    sa.Column('entity_id', sa.Uuid(), nullable=False),
    sa.Column('revision_number', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('created_by', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('entity_type', 'entity_id', 'revision_number', name='uq_revision_entity_number')
    )
    with op.batch_alter_table('revisions', schema=None) as batch_op:
        batch_op.create_index('ix_revisions_entity_type_id', ['entity_type', 'entity_id'], unique=False)

    op.create_table('samples',
    sa.Column('state', sa.String(), nullable=False),
    sa.Column('substance', sa.String(), nullable=True),
    sa.Column('amount_value', sa.Float(), nullable=True),
    sa.Column('amount_unit', sa.String(), nullable=True),
    sa.Column('location', sa.String(), nullable=True),
    sa.Column('owner', sa.String(), nullable=True),
    sa.Column('notes', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('samples', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_samples_code'), ['code'], unique=True)
        batch_op.create_index(batch_op.f('ix_samples_state'), ['state'], unique=False)

    op.create_table('sites',
    sa.Column('address', sa.String(), nullable=True),
    sa.Column('timezone', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_sites_code'), ['code'], unique=True)

    op.create_table('devices',
    sa.Column('parent_id', sa.Uuid(), nullable=True),
    sa.Column('labels', sa.JSON(), nullable=False),
    sa.Column('capability_class_ref', sa.String(), nullable=True),
    sa.Column('capability_class_id', sa.Uuid(), nullable=True),
    sa.Column('capabilities', sa.JSON(), nullable=False),
    sa.Column('ophyd_import', sa.String(), nullable=True),
    sa.Column('ophyd_args', sa.JSON(), nullable=False),
    sa.Column('transport_protocol', sa.String(), nullable=True),
    sa.Column('transport_uri', sa.String(), nullable=True),
    sa.Column('transport_ioc_host', sa.String(), nullable=True),
    sa.Column('transport_quality', sa.String(), nullable=False),
    sa.Column('network_netbox_device_id', sa.Integer(), nullable=True),
    sa.Column('network_primary_ip', sa.String(), nullable=True),
    sa.Column('network_mac', sa.String(), nullable=True),
    sa.Column('network_vlan', sa.String(), nullable=True),
    sa.Column('pose_x_mm', sa.Float(), nullable=True),
    sa.Column('pose_y_mm', sa.Float(), nullable=True),
    sa.Column('pose_z_mm', sa.Float(), nullable=True),
    sa.Column('pose_yaw_deg', sa.Float(), nullable=True),
    sa.Column('envelope', sa.JSON(), nullable=False),
    sa.Column('safety_flags', sa.JSON(), nullable=False),
    sa.Column('safety_interlocks', sa.JSON(), nullable=False),
    sa.Column('safety_max_unattended_minutes', sa.Integer(), nullable=True),
    sa.Column('operational_mode', sa.String(), nullable=False),
    sa.Column('operational_calibration', sa.JSON(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['capability_class_id'], ['capability_classes.id'], ),
    sa.ForeignKeyConstraint(['parent_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_devices_code'), ['code'], unique=True)

    op.create_table('labs',
    sa.Column('site_id', sa.Uuid(), nullable=False),
    sa.Column('room_number', sa.String(), nullable=True),
    sa.Column('environment_class', sa.String(), nullable=False),
    sa.Column('access_control_group', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('labs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_labs_code'), ['code'], unique=True)

    op.create_table('signals',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('device_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('dtype', sa.String(), nullable=True),
    sa.Column('units', sa.String(), nullable=True),
    sa.Column('limits', sa.JSON(), nullable=True),
    sa.Column('precision', sa.Float(), nullable=True),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('device_id', 'name', name='uq_signal_device_name')
    )
    op.create_table('zones',
    sa.Column('lab_id', sa.Uuid(), nullable=False),
    sa.Column('atmosphere', sa.String(), nullable=False),
    sa.Column('pressure', sa.String(), nullable=True),
    sa.Column('temperature_class', sa.String(), nullable=True),
    sa.Column('hazard_class', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['lab_id'], ['labs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('zones', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_zones_code'), ['code'], unique=True)

    op.create_table('workcells',
    sa.Column('zone_id', sa.Uuid(), nullable=False),
    sa.Column('queueserver_endpoint', sa.String(), nullable=True),
    sa.Column('redis_namespace', sa.String(), nullable=True),
    sa.Column('state', sa.String(), nullable=False),
    sa.Column('owning_group', sa.String(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['zone_id'], ['zones.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('workcells', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workcells_code'), ['code'], unique=True)

    op.create_table('benches',
    sa.Column('workcell_id', sa.Uuid(), nullable=False),
    sa.Column('grid_cols', sa.Integer(), nullable=False),
    sa.Column('grid_rows', sa.Integer(), nullable=False),
    sa.Column('height_mm', sa.Float(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['workcell_id'], ['workcells.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('benches', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_benches_code'), ['code'], unique=True)

    op.create_table('stations',
    sa.Column('bench_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('grid_col', sa.Integer(), nullable=False),
    sa.Column('grid_row', sa.Integer(), nullable=False),
    sa.Column('stack_height', sa.Integer(), nullable=False),
    sa.Column('capacity', sa.Integer(), nullable=False),
    sa.Column('accepted_labware_types', sa.JSON(), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['bench_id'], ['benches.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('stations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_stations_code'), ['code'], unique=True)

    op.create_table('station_device_bindings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('station_id', sa.Uuid(), nullable=False),
    sa.Column('device_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('station_id', 'device_id', 'role', name='uq_station_device_role')
    )


def downgrade() -> None:
    op.drop_table('station_device_bindings')
    with op.batch_alter_table('stations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_stations_code'))

    op.drop_table('stations')
    with op.batch_alter_table('benches', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_benches_code'))

    op.drop_table('benches')
    with op.batch_alter_table('workcells', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workcells_code'))

    op.drop_table('workcells')
    with op.batch_alter_table('zones', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_zones_code'))

    op.drop_table('zones')
    op.drop_table('signals')
    with op.batch_alter_table('labs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_labs_code'))

    op.drop_table('labs')
    with op.batch_alter_table('devices', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_devices_code'))

    op.drop_table('devices')
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_sites_code'))

    op.drop_table('sites')
    with op.batch_alter_table('samples', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_samples_state'))
        batch_op.drop_index(batch_op.f('ix_samples_code'))

    op.drop_table('samples')
    with op.batch_alter_table('revisions', schema=None) as batch_op:
        batch_op.drop_index('ix_revisions_entity_type_id')

    op.drop_table('revisions')
    with op.batch_alter_table('capability_classes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_capability_classes_name'))

    op.drop_table('capability_classes')
