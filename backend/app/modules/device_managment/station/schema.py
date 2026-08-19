from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import GeometryDB, ObjectGeometry
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.modules.schema import Module
from app.modules.device_managment.devices.schema import Device
# LabDB, ModuleDB, DeviceDB, ZoneDB already imported their own api.py; import here would cause circular imports.


class StationDB(ObjectDB, GeometryDB, Database):
    """A station located within a lab."""

    __tablename__ = "stations"
    __object_type__ = "station"

    lab_uuid: Mapped[UUID] = mapped_column(ForeignKey("labs.uuid"), index=True)
    lab: Mapped["LabDB"] = relationship(back_populates="stations")
    modules: Mapped[list["ModuleDB"]] = relationship(foreign_keys="ModuleDB.station_uuid", back_populates="station")
    devices: Mapped[list["DeviceDB"]] = relationship(foreign_keys="DeviceDB.station_uuid", back_populates="station")
    zone_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("zones.uuid"), index=True, default=None)
    zone: Mapped[Optional["ZoneDB"]] = relationship(back_populates="stations")


class StationBase(BaseModel):
    lab_uuid: UUID
    zone_uuid: Optional[UUID] = None


class Station(Object, StationBase, ObjectGeometry):
    """A station located within a lab."""

    model_config = ConfigDict(from_attributes=True)

    modules: list[Module] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)


class CreateStation(CreateObject, StationBase, ObjectGeometry):
    pass


class UpdateStation(UpdateObject, StationBase, ObjectGeometry):
    name: Optional[str] = None
    lab_uuid: Optional[UUID] = None