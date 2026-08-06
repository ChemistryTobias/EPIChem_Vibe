"""Topology models (§5.1): Site - Lab - Zone - Workcell - Bench - Station.

Enumerated fields (environment_class, atmosphere, workcell state, ...) are
plain strings, validated where descriptors enter the system
(epichem.schemas.descriptor) rather than as DB-level enums/constraints — the
allowed value sets are still evolving and a schema migration per new value
would be friction the plan doesn't ask for.
"""

import uuid as uuid_mod
from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from epichem.models.base import RegistryEntity

if TYPE_CHECKING:  # avoids a topology <-> device import cycle at runtime
    from epichem.models.device import StationDeviceBinding


class Site(RegistryEntity):
    __tablename__ = "sites"

    address: Mapped[str | None] = mapped_column(default=None)
    timezone: Mapped[str | None] = mapped_column(default=None)

    labs: Mapped[list["Lab"]] = relationship(back_populates="site")


class Lab(RegistryEntity):
    __tablename__ = "labs"

    site_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("sites.id"))
    room_number: Mapped[str | None] = mapped_column(default=None)
    environment_class: Mapped[str] = mapped_column(default="ambient")
    access_control_group: Mapped[str | None] = mapped_column(default=None)

    site: Mapped[Site] = relationship(back_populates="labs")
    zones: Mapped[list["Zone"]] = relationship(back_populates="lab")


class Zone(RegistryEntity):
    __tablename__ = "zones"

    lab_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("labs.id"))
    atmosphere: Mapped[str] = mapped_column(default="air")
    pressure: Mapped[str | None] = mapped_column(default=None)
    temperature_class: Mapped[str | None] = mapped_column(default=None)
    hazard_class: Mapped[str | None] = mapped_column(default=None)

    lab: Mapped[Lab] = relationship(back_populates="zones")
    workcells: Mapped[list["Workcell"]] = relationship(back_populates="zone")


class Workcell(RegistryEntity):
    __tablename__ = "workcells"

    zone_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("zones.id"))
    queueserver_endpoint: Mapped[str | None] = mapped_column(default=None)
    redis_namespace: Mapped[str | None] = mapped_column(default=None)
    state: Mapped[str] = mapped_column(default="active")
    owning_group: Mapped[str | None] = mapped_column(default=None)

    zone: Mapped[Zone] = relationship(back_populates="workcells")
    benches: Mapped[list["Bench"]] = relationship(back_populates="workcell")


class Bench(RegistryEntity):
    __tablename__ = "benches"

    workcell_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("workcells.id"))
    grid_cols: Mapped[int] = mapped_column(default=1)
    grid_rows: Mapped[int] = mapped_column(default=1)
    height_mm: Mapped[float | None] = mapped_column(default=None)

    workcell: Mapped[Workcell] = relationship(back_populates="benches")
    stations: Mapped[list["Station"]] = relationship(back_populates="bench")


class Station(RegistryEntity):
    __tablename__ = "stations"

    bench_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("benches.id"))
    kind: Mapped[str] = mapped_column(default="generic")
    grid_col: Mapped[int] = mapped_column(default=0)
    grid_row: Mapped[int] = mapped_column(default=0)
    stack_height: Mapped[int] = mapped_column(default=1)
    capacity: Mapped[int] = mapped_column(default=1)
    accepted_labware_types: Mapped[list[str]] = mapped_column(JSON, default=list)

    bench: Mapped[Bench] = relationship(back_populates="stations")
    # Cascades for the same reason as Device.station_bindings: the binding is
    # a link owned by both ends, so removing a station removes its links and
    # leaves the devices themselves alone.
    device_bindings: Mapped[list["StationDeviceBinding"]] = relationship(
        back_populates="station", cascade="all, delete-orphan"
    )
