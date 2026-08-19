from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import GeometryDB, ObjectGeometry
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.lab.schema import Lab, LabDB
from app.modules.device_managment.station.schema import Station, StationDB


class ZoneDB(ObjectDB, GeometryDB, Database):
    """A zone: a short tag grouping labs (under a site) or stations (under a lab)."""

    __tablename__ = "zones"
    __object_type__ = "zone"

    tag: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    parent_type: Mapped[str] = mapped_column(String(20))
    parent_uuid: Mapped[UUID] = mapped_column(index=True)
    labs: Mapped[list["LabDB"]] = relationship(foreign_keys="LabDB.zone_uuid", back_populates="zone")
    stations: Mapped[list["StationDB"]] = relationship(foreign_keys="StationDB.zone_uuid", back_populates="zone")


class ZoneBase(BaseModel):
    tag: Optional[str] = None
    parent_uuid: UUID


class Zone(Object, ZoneBase, ObjectGeometry):
    """A zone: a short tag grouping labs (under a site) or stations (under a lab)."""
    model_config = ConfigDict(from_attributes=True)

    parent_type: str
    labs: list[Lab] = Field(default_factory=list)
    stations: list[Station] = Field(default_factory=list)


class CreateZone(CreateObject, ZoneBase, ObjectGeometry):
    pass


class UpdateZone(UpdateObject, ZoneBase, ObjectGeometry):
    name: Optional[str] = None
    parent_uuid: Optional[UUID] = None
