"""Device model (§6.1, ADR 0007): a containment tree of node -> child node ->
Signal, belonging to a Station.

One table holds both the controllable leaf (`node_kind="device"`) and the
recursive `Module` (`node_kind="module"`: a grouping of devices, a sub-assembly,
or a passive component with no driver). ADR 0007 folds Module into this tree via
the `node_kind` discriminator rather than a second near-duplicate table; the
existing `parent_id` self-reference does the nesting.

A node belongs to a Station via `station_id` (ADR 0007 replaces M1's
many-to-many `StationDeviceBinding` — a station is now simply the group its
devices point at). `parent_id` nests modules/devices *within* that station.
"""

import uuid as uuid_mod
from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from epichem.idgen import uuid7
from epichem.models.base import Base, RegistryEntity, TimestampMixin

if TYPE_CHECKING:  # avoids a topology <-> device import cycle at runtime
    from epichem.models.topology import Station


class Device(RegistryEntity):
    __tablename__ = "devices"

    # "device" (controllable leaf, has a capability class / transport / signals)
    # or "module" (grouping / sub-assembly / passive component). ADR 0007.
    node_kind: Mapped[str] = mapped_column(default="device")

    # The station this node belongs to (ADR 0007). Nullable so a node can be
    # created before it's placed, and so a module can nest under a parent that
    # already carries the station; the write path fills it in from the parent
    # when omitted.
    station_id: Mapped[uuid_mod.UUID | None] = mapped_column(
        ForeignKey("stations.id"), default=None
    )
    parent_id: Mapped[uuid_mod.UUID | None] = mapped_column(
        ForeignKey("devices.id"), default=None
    )
    labels: Mapped[dict] = mapped_column(JSON, default=dict)

    # spec.class — raw dotted reference from the descriptor (e.g.
    # "epichem.classes.HeaterStirrer"), plus the resolved FK the write path
    # (epichem.registry.resolve_device_references) fills in once it can match
    # the trailing segment to a registered CapabilityClass.name. Both are None
    # for a passive module (node_kind="module"), which promises no capability.
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
    # §6.2's nominal/degraded flag for the degraded vendor-bridge onboarding
    # path.
    transport_quality: Mapped[str] = mapped_column(default="nominal")

    network_netbox_device_id: Mapped[int | None] = mapped_column(default=None)
    network_primary_ip: Mapped[str | None] = mapped_column(default=None)
    network_mac: Mapped[str | None] = mapped_column(default=None)
    network_vlan: Mapped[str | None] = mapped_column(default=None)

    # location.{lab,zone,station} are implied by station_id (a station sits
    # under zone?->lab); only pose is device-specific (an offset from the
    # nominal station position).
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

    # Soft-hide flag (ADR 0011): a virtual device/module still exists and
    # revisions normally, but is hidden from every layout canvas. The Station
    # canvas's "delete" sets this rather than removing the row (reversible).
    virtual: Mapped[bool] = mapped_column(default=False)

    children: Mapped[list["Device"]] = relationship(
        back_populates="parent", remote_side="Device.parent_id"
    )
    parent: Mapped["Device | None"] = relationship(
        back_populates="children", remote_side="Device.id"
    )
    station: Mapped["Station | None"] = relationship(back_populates="devices")
    # Signals are owned by the device and meaningless without it: deleting a
    # device deletes its signals.
    signals: Mapped[list["Signal"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )

    @property
    def station_code(self) -> str | None:
        """The code of the station this node belongs to, for `DeviceOut`.

        Station is a direct FK now (ADR 0007 removed the binding table), so this
        is a plain lookup — exposed as a property rather than a column so
        `DeviceOut` (from_attributes) picks it up and every Revision snapshot
        records it, without the write path having to patch the snapshot by hand.
        """
        return self.station.code if self.station is not None else None


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
