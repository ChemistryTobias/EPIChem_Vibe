"""Groups: a named collection of users, meant as the subject for the coarse
none/read/read-write access model this backend doesn't enforce yet (see the
Roadmap). Membership is a plain association table, not a pydantic-nested
list or an ORM relationship -- keeps this module import-independent from
app.core.users (string FK target only), the same pattern app.core.auth's
AuthTokenDB uses. Membership is read/written directly against the table in
logic.py.
"""

from pydantic import ConfigDict
from sqlalchemy import Column, ForeignKey, Table

from app.core.database import Database
from app.core.object.schema import CreateObject, Object, ObjectDB, UpdateObject

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
