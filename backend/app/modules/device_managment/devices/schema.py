from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import ObjectGeometryDB, ObjectGeometry, GeometryDescriptor
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
# StationDB already imported their own api.py; import here would cause circular imports.

from .logic import get_default_geometry


class DeviceDB(ObjectDB, ObjectGeometryDB, Database):
    """A device located within a station."""

    __tablename__ = "devices"
    __object_type__ = "device"

    station_uuid: Mapped[UUID] = mapped_column(ForeignKey("stations.uuid"), index=True)
    station: Mapped["StationDB"] = relationship(back_populates="devices")


class DeviceBase(BaseModel):
    station_uuid: UUID


class Device(Object, DeviceBase, ObjectGeometry):
    """A device located within a station."""

    model_config = ConfigDict(from_attributes=True)


class CreateDevice(CreateObject, ObjectGeometry, DeviceBase):
    object_geometry: GeometryDescriptor = Field(default_factory=get_default_geometry)


class UpdateDevice(UpdateObject, DeviceBase, ObjectGeometry):
    name: Optional[str] = None
    station_uuid: Optional[UUID] = None