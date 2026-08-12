"""Site schemas: the SQLAlchemy model (SiteDB) and the Pydantic model (Site)."""

from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class SiteDB(Database):
    __tablename__ = "dm_sites"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(default=None)
    address: Mapped[Optional[str]] = mapped_column(default=None)
    timezone: Mapped[Optional[str]] = mapped_column(default=None)
    dimensions: Mapped[list] = mapped_column(JSON, default=list)
    visualizer: Mapped[dict] = mapped_column(JSON, default=dict)


class Site(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: Optional[UUID]
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    timezone: Optional[str] = None
    dimensions: list = Field(default_factory=list)
    visualizer: dict = Field(default_factory=dict)
