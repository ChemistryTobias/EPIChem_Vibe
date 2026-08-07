"""Topology models (§5.1, ADR 0007): Site - Lab - Zone(optional) - Station.

Flattened from M1's six-level chain: `Workcell` and `Bench` are gone. Their
responsibilities moved — the isometric grid onto `Lab`, the execution binding
(queueserver endpoint, redis namespace, state, owning group) onto `Station`.

A `Station` is now a *group of >=1 device* (`models.device.Device.station_id`),
not an addressable grid slot with a many-to-many binding — so `Station`'s
parent is a `Lab` (always) and optionally a `Zone` (ADR 0007: a station lives
directly under a lab, or inside a zone; zones and stations are siblings under a
lab). `Zone` is optional and classifies an area for safety (human vs. robot,
`occupancy`) as well as shared conditions.

Enumerated fields (environment_class, atmosphere, occupancy, station state, ...)
are plain strings, validated where descriptors enter the system
(epichem.schemas.descriptor) rather than as DB-level enums/constraints — the
allowed value sets are still evolving and a schema migration per new value would
be friction the plan doesn't ask for.
"""

import uuid as uuid_mod
from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from epichem.models.base import RegistryEntity

if TYPE_CHECKING:  # avoids a topology <-> device import cycle at runtime
    from epichem.models.device import Device


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
    # The isometric grid the lab's stations snap onto (ADR 0007: moved up from
    # the removed Bench). Cell size and floorplan geometry are M2 layout-editor
    # work; the grid extent is the part the topology model owns.
    grid_cols: Mapped[int] = mapped_column(default=1)
    grid_rows: Mapped[int] = mapped_column(default=1)

    site: Mapped[Site] = relationship(back_populates="labs")
    zones: Mapped[list["Zone"]] = relationship(back_populates="lab")
    stations: Mapped[list["Station"]] = relationship(back_populates="lab")


class Zone(RegistryEntity):
    __tablename__ = "zones"

    lab_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("labs.id"))
    atmosphere: Mapped[str] = mapped_column(default="air")
    pressure: Mapped[str | None] = mapped_column(default=None)
    temperature_class: Mapped[str | None] = mapped_column(default=None)
    hazard_class: Mapped[str | None] = mapped_column(default=None)
    # ADR 0007 / §12.2: a zone's first-class reason to exist beyond shared
    # atmosphere — a safety boundary. human | robot | shared.
    occupancy: Mapped[str] = mapped_column(default="shared")

    lab: Mapped[Lab] = relationship(back_populates="zones")
    stations: Mapped[list["Station"]] = relationship(back_populates="zone")


class Station(RegistryEntity):
    __tablename__ = "stations"

    # A station always belongs to a lab; a zone is optional (ADR 0007). Both
    # can't be inferred from the other cheaply, so lab_id is stored even when a
    # zone is set — it equals the zone's lab.
    lab_id: Mapped[uuid_mod.UUID] = mapped_column(ForeignKey("labs.id"))
    zone_id: Mapped[uuid_mod.UUID | None] = mapped_column(ForeignKey("zones.id"), default=None)
    kind: Mapped[str] = mapped_column(default="generic")
    grid_col: Mapped[int] = mapped_column(default=0)
    grid_row: Mapped[int] = mapped_column(default=0)
    # The user-editable isometric depth (§10.3), meaningful not decorative.
    stack_height: Mapped[int] = mapped_column(default=1)
    capacity: Mapped[int] = mapped_column(default=1)
    accepted_labware_types: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Execution binding, moved off the removed Workcell (ADR 0007). Default home
    # for the queueserver / RE Manager namespace; cross-station scheduling scope
    # is a later M2 design point, not modelled here.
    queueserver_endpoint: Mapped[str | None] = mapped_column(default=None)
    redis_namespace: Mapped[str | None] = mapped_column(default=None)
    state: Mapped[str] = mapped_column(default="active")
    owning_group: Mapped[str | None] = mapped_column(default=None)

    lab: Mapped[Lab] = relationship(back_populates="stations")
    zone: Mapped["Zone | None"] = relationship(back_populates="stations")
    # No cascade: a station's devices are real entities that outlive the grouping
    # only by being reassigned or deleted first. Deleting a station that still
    # holds devices raises IntegrityError -> 409, matching how deleting any
    # topology parent with children behaves.
    devices: Mapped[list["Device"]] = relationship(back_populates="station")
