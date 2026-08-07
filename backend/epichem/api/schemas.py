"""API response models. `from_attributes=True` lets FastAPI build these
directly from the SQLAlchemy ORM rows.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class OutBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SiteOut(OutBase):
    id: uuid.UUID
    code: str
    name: str
    address: str | None
    timezone: str | None


class LabOut(OutBase):
    id: uuid.UUID
    code: str
    name: str
    site_id: uuid.UUID
    room_number: str | None
    environment_class: str
    access_control_group: str | None
    grid_cols: int
    grid_rows: int


class ZoneOut(OutBase):
    id: uuid.UUID
    code: str
    name: str
    lab_id: uuid.UUID
    atmosphere: str
    pressure: str | None
    temperature_class: str | None
    hazard_class: str | None
    occupancy: str


class StationOut(OutBase):
    id: uuid.UUID
    code: str
    name: str
    lab_id: uuid.UUID
    zone_id: uuid.UUID | None
    kind: str
    grid_col: int
    grid_row: int
    stack_height: int
    capacity: int
    accepted_labware_types: list[str]
    queueserver_endpoint: str | None
    redis_namespace: str | None
    state: str
    owning_group: str | None


class SignalOut(OutBase):
    id: uuid.UUID
    name: str
    dtype: str | None
    units: str | None
    limits: dict | None
    precision: float | None
    kind: str


class CapabilityClassOut(OutBase):
    id: uuid.UUID
    name: str
    iri: str | None
    extends: list[str]
    actions: dict


class DeviceOut(OutBase):
    id: uuid.UUID
    code: str
    name: str
    node_kind: str
    labels: dict
    station_id: uuid.UUID | None
    parent_id: uuid.UUID | None
    capability_class_ref: str | None
    capability_class_id: uuid.UUID | None
    capabilities: list[str]
    ophyd_import: str | None
    ophyd_args: dict
    transport_protocol: str | None
    transport_uri: str | None
    transport_ioc_host: str | None
    transport_quality: str
    network_netbox_device_id: int | None
    network_primary_ip: str | None
    network_mac: str | None
    network_vlan: str | None
    pose_x_mm: float | None
    pose_y_mm: float | None
    pose_z_mm: float | None
    pose_yaw_deg: float | None
    envelope: dict
    safety_flags: list[str]
    safety_interlocks: list[str]
    safety_max_unattended_minutes: int | None
    operational_mode: str
    operational_calibration: dict | None
    # Not an ORM attribute — filled in by the router from the
    # station_device_bindings table (Device/Station are decoupled, §5.1).
    station_code: str | None = None


class SampleOut(OutBase):
    """§7.1, minimal slice — see `models/sample.py` for what §7 this
    deliberately leaves out (composition, lineage, containers, event log).
    """

    id: uuid.UUID
    code: str
    name: str
    state: str
    substance: str | None
    amount_value: float | None
    amount_unit: str | None
    location: str | None
    owner: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class RevisionOut(OutBase):
    revision_number: int
    action: str
    created_at: datetime
    created_by: str | None
    snapshot: dict
