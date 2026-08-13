"""Station schemas: SQLAlchemy model (StationDB) and Pydantic models (Station / CreateStation / UpdateStation)."""

from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class StationDB(Database):
    __tablename__ = "dm_stations"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(default=None)
    dimensions: Mapped[list] = mapped_column(JSON, default=list)
    visualizer: Mapped[dict] = mapped_column(JSON, default=dict)


class Station(BaseModel):
    uuid: UUID
    name: str
    description: Optional[str] = None
    dimensions: Optional[list] = Field(default_factory=list)
    visualizer: Optional[dict] = Field(default_factory=dict)


class CreateStation(Station):
    model_config = ConfigDict(from_attributes=True)
    uuid: Optional[UUID] = None


class UpdateStation(Station):
    uuid: Optional[UUID] = None
    name: Optional[str] = None
