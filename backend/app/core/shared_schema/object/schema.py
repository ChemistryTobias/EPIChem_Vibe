from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel
from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column


class ObjectDB:
    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Object(BaseModel):
    uuid: UUID
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateObject(BaseModel):
    uuid: Optional[UUID] = None
    name: str
    description: Optional[str] = None


class UpdateObject(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
