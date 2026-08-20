"""Opaque bearer tokens issued on login. The account they authenticate lives
in app.core.users; a token is a random string in its own row rather than a
signed/encoded value (JWT), so revoking one is a plain DELETE and there is
nothing to decode or verify beyond a database lookup.
"""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel
from sqlalchemy import Boolean, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class AuthTokenDB(Database):
    __tablename__ = "core_auth_tokens"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # String FK target (not an imported UserDB) so this module has no
    # import-time dependency on app.core.users -- see logic.py for why.
    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("core_users.uuid"), index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class LoginRequest(BaseModel):
    name: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
