from typing import Optional
from uuid import UUID

from pydantic import ConfigDict
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database
from app.core.shared_schema.object.schema import Object, ObjectDB


class FileDB(ObjectDB, Database):
    __tablename__ = "core_files"

    # imported schema
    # - object (uuid, name, description, created_at, updated_at)
    # `name` holds a generated, unique file slug -- see api.upload_file

    owner_object_type: Mapped[str] = mapped_column(String(50), index=True)  # e.g. "site"
    owner_object_uuid: Mapped[UUID] = mapped_column(index=True)  # the owning row's PK
    filename: Mapped[str] = mapped_column(String(255))
    extension: Mapped[str] = mapped_column(String(20))  # no leading dot, e.g. "svg"
    size: Mapped[int]
    mimetype: Mapped[Optional[str]] = mapped_column(default=None)


class FileMetadata(Object):
    model_config = ConfigDict(from_attributes=True)

    owner_object_type: str
    owner_object_uuid: UUID
    filename: str
    extension: str
    size: int
    mimetype: Optional[str] = None
