from typing import Optional, ClassVar

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import GeometryDB, GeometryDescriptor, ObjectGeometry
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.lab.schema import Lab, LabDB
from app.modules.device_managment.zone.schema import Zone, ZoneDB

from .logic import get_system_timezone


class SiteDB(GeometryDB, ObjectDB, Database):
    """A physical site of an organisation, which contains labs and zones."""
    __tablename__ = "sites"
    __object_type__ = "site"

    organisation: Mapped[Optional[str]] = mapped_column(types.String(50), default=None)
    address: Mapped[Optional[str]] = mapped_column(types.Text, default=None)
    coordinates: Mapped[Optional[dict]] = mapped_column(types.JSON, default=None)
    timezone: Mapped[Optional[str]] = mapped_column(types.String(50), default=get_system_timezone)
    labs: Mapped[list["LabDB"]] = relationship()
    site_zones: Mapped[list["ZoneDB"]] = relationship()


class SiteBase(BaseModel):
    class Coordinates(BaseModel):
        latitude: float = Field(ge=-90, le=90)
        longitude: float = Field(ge=-180, le=180)

    organisation: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[Coordinates] = None
    timezone: Optional[str] = None


class Site(Object, SiteBase, ObjectGeometry):
    """A physical site of an organisation, which contains labs and zones."""

    model_config = ConfigDict(from_attributes=True)

    labs: list[Lab] = Field(default_factory=list)
    site_zones: list[Zone] = Field(default_factory=list)


class CreateSite(CreateObject, SiteBase, ObjectGeometry):
    default_geometry: ClassVar[list[GeometryDescriptor]] = [
        GeometryDescriptor(detail="Floor 1", box_position_xyz=(0,0,0), box_dimension_xyz=(60,50,3))
    ]
    
    object_geometry: list[GeometryDescriptor] = Field(default_factory=lambda: CreateSite.default_geometry)


class UpdateSite(UpdateObject, SiteBase, ObjectGeometry):
    name: Optional[str] = None