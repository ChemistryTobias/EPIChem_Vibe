"""User accounts, on the same Object mixin every entity uses -- `name` is the username."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject


class UserDB(ObjectDB, Database):
    __tablename__ = "core_users"

    email: Mapped[Optional[str]] = mapped_column(String(120), default=None)
    password_hash: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserBase(BaseModel):
    email: Optional[str] = None
    active: bool = True


class User(Object, UserBase):
    """Response shape -- never carries password_hash."""

    model_config = ConfigDict(from_attributes=True)


class CreateUser(CreateObject, UserBase):
    password: str = Field(min_length=8)


class UpdateUser(UpdateObject, UserBase):
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)
