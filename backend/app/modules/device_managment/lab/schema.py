from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import ObjectGeometryDB, ObjectGeometry, GeometryDescriptor
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.station.schema import Station
# SiteDB, StationDB, ZoneDB already imported their own api.py; import here would cause circular imports.

from .logic import get_default_geometry


class LabDB(ObjectDB, ObjectGeometryDB, Database):
    """A lab located within a site."""

    __tablename__ = "labs"
    __object_type__ = "lab"

    room_number: Mapped[Optional[str]] = mapped_column(String(10), default=None)
    site_uuid: Mapped[UUID] = mapped_column(ForeignKey("sites.uuid"), index=True)
    site: Mapped["SiteDB"] = relationship(back_populates="labs")
    stations: Mapped[list["StationDB"]] = relationship(foreign_keys="StationDB.lab_uuid", back_populates="lab")
    zone_uuid: Mapped[Optional[UUID]] = mapped_column(ForeignKey("zones.uuid"), index=True, default=None)
    zone: Mapped[Optional["ZoneDB"]] = relationship(back_populates="labs")


class LabBase(BaseModel):
    room_number: Optional[str] = None
    site_uuid: UUID
    zone_uuid: Optional[UUID] = None


class Lab(Object, LabBase, ObjectGeometry):
    """A lab located within a site."""

    model_config = ConfigDict(from_attributes=True)

    stations: list[Station] = Field(default_factory=list)


class CreateLab(CreateObject, ObjectGeometry, LabBase):
    object_geometry: GeometryDescriptor = Field(default_factory=get_default_geometry)


class UpdateLab(UpdateObject, LabBase, ObjectGeometry):
    name: Optional[str] = None
    site_uuid: Optional[UUID] = None
