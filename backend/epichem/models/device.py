"""Device model (§6.1): a containment tree of Device -> child Device ->
Signal, decoupled from Station via a many-to-many binding with a role
(§5.1: "fix this with a proper many-to-many station_device_binding carrying
a role (owns, services, observes)").
"""

import uuid as uuid_mod

from sqlalchemy import JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from epichem.idgen import uuid7
from epichem.models.base import Base, RegistryEntity, TimestampMixin


class Device(RegistryEntity):
    __tablename__ = "devices"

    parent_id: Mapped[uuid_mod.UUID | None] = mapped_column(
        ForeignKey("devices.id"), default=None
    )
    labels: Mapped[dict] = mapped_column(JSON, default=dict)

    # spec.class — raw dotted reference from the descriptor (e.g.
    # "epichem.classes.HeaterStirrer"), plus the resolved FK the write path
    # (epichem.registry.resolve_device_references) fills in once it can
    # match the trailing segment to a registered CapabilityClass.name. Kept
    # as two fields because the descriptor's dotted-path convention isn't
    # itself a database key.
    capability_class_ref: Mapped[str | None] = mapped_column(default=None)
    capability_class_id: Mapped[uuid_mod.UUID | None] = mapped_column(
        ForeignKey("capability_classes.id"), default=None
    )
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)

    ophyd_import: Mapped[str | None] = mapped_column(default=None)
    ophyd_args: Mapped[dict] = mapped_column(JSON, default=dict)

    transport_protocol: Mapped[str | None] = mapped_column(default=None)
    transport_uri: Mapped[str | None] = mapped_column(default=None)
    transport_ioc_host: Mapped[str | None] = mapped_column(default=None)

    network_netbox_device_id: Mapped[int | None] = mapped_column(default=None)
    network_primary_ip: Mapped[str | None] = mapped_column(default=None)
    network_mac: Mapped[str | None] = mapped_column(default=None)
    network_vlan: Mapped[str | None] = mapped_column(default=None)

    # location.{lab,zone,workcell,bench} are implied by the station binding
    # (a station already sits under bench->workcell->zone->lab); only pose
    # is device-specific (a robot arm's offset from its nominal station).
    pose_x_mm: Mapped[float | None] = mapped_column(default=None)
    pose_y_mm: Mapped[float | None] = mapped_column(default=None)
    pose_z_mm: Mapped[float | None] = mapped_column(default=None)
    pose_yaw_deg: Mapped[float | None] = mapped_column(default=None)

    envelope: Mapped[dict] = mapped_column(JSON, default=dict)

    safety_flags: Mapped[list[str]] = mapped_column(JSON, default=list)
    safety_interlocks: Mapped[list[str]] = mapped_column(JSON, default=list)
    safety_max_unattended_minutes: Mapped[int | None] = mapped_column(default=None)

    operational_mode: Mapped[str] = mapped_column(default="read_write")
    operational_calibration: Mapped[dict | None] = mapped_column(JSON, default=None)

    children: Mapped[list["Device"]] = relationship(
        back_populates="parent", remote_side="Device.parent_id"
    )
    parent: Mapped["Device | None"] = relationship(
        back_populates="children", remote_side="Device.id"
    )
    signals: Mapped[list["Signal"]] = relationship(back_populates="device")


class Signal(Base, TimestampMixin):
    """§5.1: "a readable/settable channel" — PV/attribute, dtype, units,
    limits, precision, kind. Populated by ophyd introspection (§9.2, M2),
    not by device descriptor ingestion — this table exists now because it's
    part of the canonical schema, but nothing writes to it yet.
    """

    __tablename__ = "signals"
    __table_args__ = (UniqueConstraint("device_id", "name", name="uq_signal_device_name"),)

    id: Mapped[uuid_mod.UUID] = mapped_column(primary_key=True, default=uuid7)
    device_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("devices.id"))
    name: Mapped[str]
    dtype: Mapped[str | None] = mapped_column(default=None)
    units: Mapped[str | None] = mapped_column(default=None)
    limits: Mapped[dict | None] = mapped_column(JSON, default=None)
    precision: Mapped[float | None] = mapped_column(default=None)
    kind: Mapped[str] = mapped_column(default="normal")  # primary|config|normal|omitted

    device: Mapped[Device] = relationship(back_populates="signals")


class StationDeviceBinding(Base, TimestampMixin):
    """§5.1: decouples Station from Device. `role` is one of owns/services/
    observes — e.g. a robot arm *services* many stations; a hotplate *owns*
    the one station it sits on.
    """

    __tablename__ = "station_device_bindings"
    __table_args__ = (
        UniqueConstraint("station_id", "device_id", "role", name="uq_station_device_role"),
    )

    id: Mapped[uuid_mod.UUID] = mapped_column(primary_key=True, default=uuid7)
    station_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("stations.id"))
    device_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("devices.id"))
    role: Mapped[str] = mapped_column(default="owns")
