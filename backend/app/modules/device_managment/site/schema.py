from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import types
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.shared_schema.geometry.schema import GeometryDescriptor
from app.core.shared_schema.object.schema import CreateObject, Object, ObjectDB, UpdateObject
from app.modules.device_managment.lab.schema import Lab, LabDB
from app.modules.device_managment.zone.schema import Zone, ZoneDB

from .logic import default_floors, get_system_timezone

#: One storey: its description and the box it occupies. A site's own extent is
#: the union of these, so a site carries no `object_geometry` of its own.
Floor = tuple[str, GeometryDescriptor]


class SiteDB(ObjectDB, Database):
    """A physical site of an organisation, which contains labs and zones."""
    __tablename__ = "sites"
    __object_type__ = "site"

    organisation: Mapped[Optional[str]] = mapped_column(types.String(50), default=None)
    address: Mapped[Optional[str]] = mapped_column(types.Text, default=None)
    coordinates: Mapped[Optional[dict]] = mapped_column(types.JSON, default=None)
    timezone: Mapped[Optional[str]] = mapped_column(types.String(50), default=get_system_timezone)
    floor_no: Mapped[int] = mapped_column(types.Integer, default=1)
    floors: Mapped[list] = mapped_column(types.JSON, default=list)
    labs: Mapped[list["LabDB"]] = relationship(back_populates="site")
    # A zone's parent is a plain uuid + type rather than a foreign key (it can
    # hang off a site or a lab), so this join is spelled out and read-only.
    zones: Mapped[list["ZoneDB"]] = relationship(
        "ZoneDB",
        primaryjoin=(
            "and_(foreign(ZoneDB.parent_uuid) == SiteDB.uuid, ZoneDB.parent_type == 'site')"
        ),
        viewonly=True,
    )


class SiteBase(BaseModel):
    class Coordinates(BaseModel):
        latitude: float = Field(ge=-90, le=90)
        longitude: float = Field(ge=-180, le=180)

    organisation: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[Coordinates] = None
    timezone: Optional[str] = None


class Site(Object, SiteBase):
    """A physical site of an organisation, which contains labs and zones."""

    model_config = ConfigDict(from_attributes=True)

    floor_no: int = 1
    floors: list[Floor] = Field(default_factory=list)
    labs: list[Lab] = Field(default_factory=list)
    zones: list[Zone] = Field(default_factory=list)


class CreateSite(CreateObject, SiteBase):
    floor_no: int = Field(default=1, ge=1)
    floors: list[Floor] = Field(default_factory=list)

    @model_validator(mode="after")
    def fill_floors(self) -> "CreateSite":
        """Generate the storeys from `floor_no` unless they were given.

        A `default_factory` can't see `floor_no`, so this runs after the whole
        body is validated instead.
        """
        if not self.floors:
            self.floors = default_floors(self.floor_no)
        return self


class UpdateSite(UpdateObject, SiteBase):
    name: Optional[str] = None
    floor_no: Optional[int] = Field(default=None, ge=1)
    floors: Optional[list[Floor]] = None
