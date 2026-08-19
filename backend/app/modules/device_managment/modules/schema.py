from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Database
from app.core.geometry.schema import GeometryDB, ObjectGeometry
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject
# StationDB already imported their own api.py; import here would cause circular imports.


class ModuleDB(ObjectDB, GeometryDB, Database):
    """A module located within a station."""

    __tablename__ = "modules"
    __object_type__ = "module"

    station_uuid: Mapped[UUID] = mapped_column(ForeignKey("stations.uuid"), index=True)
    station: Mapped["StationDB"] = relationship(back_populates="modules")


class ModuleBase(BaseModel):
    station_uuid: UUID


class Module(Object, ModuleBase, ObjectGeometry):
    """A module located within a station."""

    model_config = ConfigDict(from_attributes=True)


class CreateModule(CreateObject, ModuleBase, ObjectGeometry):
    pass


class UpdateModule(UpdateObject, ModuleBase, ObjectGeometry):
    name: Optional[str] = None
    station_uuid: Optional[UUID] = None
