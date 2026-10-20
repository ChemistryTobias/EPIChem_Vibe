from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.shared_schema.geometry.schema import ObjectGeometryDB, ObjectGeometry, GeometryDescriptor
from app.core.shared_schema.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.modules.schema import Module
from app.modules.device_managment.devices.schema import Device
# LabDB, ModuleDB, DeviceDB, ZoneDB already imported their own api.py; import here would cause circular imports.

from .logic import get_default_geometry


class StationDB(ObjectDB, ObjectGeometryDB, Database):
    """A station located within a lab."""

    __tablename__ = "stations"
    __object_type__ = "station"

    lab_uuid: Mapped[UUID] = mapped_column(ForeignKey("labs.uuid"), index=True)
    lab: Mapped["LabDB"] = relationship(back_populates="stations")
    modules: Mapped[list["ModuleDB"]] = relationship(foreign_keys="ModuleDB.station_uuid", back_populates="station")
    devices: Mapped[list["DeviceDB"]] = relationship(foreign_keys="DeviceDB.station_uuid", back_populates="station")
    zone_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("zones.uuid"), index=True, default=None)
    zone: Mapped[Optional["ZoneDB"]] = relationship(back_populates="stations")
    # Execution binding (plan §5.1 / Roadmap 1.3): the station pod's
    # bluesky-httpserver. Workflows dispatch here; unset means "not executable".
    queueserver_url: Mapped[Optional[str]] = mapped_column(String(200), default=None)


class StationBase(BaseModel):
    lab_uuid: UUID
    zone_uuid: Optional[UUID] = None
    queueserver_url: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Base URL of this station's bluesky-httpserver, e.g. http://station-sim:60610.",
    )


class Station(Object, StationBase, ObjectGeometry):
    """A station located within a lab."""

    model_config = ConfigDict(from_attributes=True)

    modules: list[Module] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)


class CreateStation(CreateObject, ObjectGeometry, StationBase):
    object_geometry: GeometryDescriptor = Field(default_factory=get_default_geometry)


class UpdateStation(UpdateObject, StationBase, ObjectGeometry):
    name: Optional[str] = None
    lab_uuid: Optional[UUID] = None