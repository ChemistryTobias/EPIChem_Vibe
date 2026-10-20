from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.shared_schema.geometry.schema import ObjectGeometryDB, ObjectGeometry, GeometryDescriptor
from app.core.shared_schema.object.schema import CreateObject, Object, ObjectDB, UpdateObject
# StationDB already imported their own api.py; import here would cause circular imports.

from .logic import get_default_geometry


class DeviceDB(ObjectDB, ObjectGeometryDB, Database):
    """A device located within a station."""

    __tablename__ = "devices"
    __object_type__ = "device"

    station_uuid: Mapped[UUID] = mapped_column(ForeignKey("stations.uuid"), index=True)
    station: Mapped["StationDB"] = relationship(back_populates="devices")
    # The device's name in its station pod's worker namespace (what plans
    # take as a device argument) -- the link between this record and the
    # ophyd object. The first of Roadmap 1.3's descriptor fields.
    ophyd_name: Mapped[Optional[str]] = mapped_column(String(100), default=None, index=True)


class DeviceBase(BaseModel):
    station_uuid: UUID
    ophyd_name: Optional[str] = Field(
        default=None, max_length=100, description="Name of the ophyd device in the station pod, e.g. hotplate1."
    )


class Device(Object, DeviceBase, ObjectGeometry):
    """A device located within a station."""

    model_config = ConfigDict(from_attributes=True)


class CreateDevice(CreateObject, ObjectGeometry, DeviceBase):
    object_geometry: GeometryDescriptor = Field(default_factory=get_default_geometry)


class UpdateDevice(UpdateObject, DeviceBase, ObjectGeometry):
    name: Optional[str] = None
    station_uuid: Optional[UUID] = None