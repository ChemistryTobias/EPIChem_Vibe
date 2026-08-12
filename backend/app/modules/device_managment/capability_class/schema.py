"""CapabilityClass schemas: the SQLAlchemy model (CapabilityClassDB) and the
Pydantic model (CapabilityClass). Not a spatial entity, so instead of
dimensions/visualizer it carries `actions` (the interface it promises).
"""

from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class CapabilityClassDB(Database):
    __tablename__ = "dm_capability_classes"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(default=None)
    actions: Mapped[dict] = mapped_column(JSON, default=dict)


class CapabilityClass(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: Optional[UUID]
    name: str
    description: Optional[str] = None
    actions: dict = Field(default_factory=dict)
