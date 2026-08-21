"""Named user groups; membership is a plain association table, not a relationship, so this module has no import-time dependency on app.core.access_control.users."""

from pydantic import ConfigDict
from sqlalchemy import Column, ForeignKey, Table

from app.core.database import Database
from app.core.shared_schema.object.schema import CreateObject, Object, ObjectDB, UpdateObject

group_membership = Table(
    "core_group_membership",
    Database.metadata,
    Column("group_uuid", ForeignKey("core_groups.uuid"), primary_key=True),
    Column("user_uuid", ForeignKey("core_users.uuid"), primary_key=True),
)


class GroupDB(ObjectDB, Database):
    __tablename__ = "core_groups"


class Group(Object):
    model_config = ConfigDict(from_attributes=True)


class CreateGroup(CreateObject):
    pass


class UpdateGroup(UpdateObject):
    pass
