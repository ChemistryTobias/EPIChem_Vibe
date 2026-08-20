import secrets
from uuid import UUID

from sqlalchemy.orm import Session

from .schema import AuthTokenDB


def authenticate_user(session: Session, name: str, password: str):
    """Returns the matching UserDB row, or None if the name/password is wrong
    or the account is inactive."""
    # Deferred import: this module (auth) is built before app.core.users
    # exists on disk (auth is committed first of the three additions), so
    # importing at call time rather than module load time keeps this file
    # valid on its own from the start -- same pattern the device-management
    # modules already use to avoid circular imports.
    from app.core.users.logic import verify_password
    from app.core.users.schema import UserDB

    user = session.query(UserDB).filter_by(name=name).first()
    if user is None or not user.active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def issue_token(session: Session, user_uuid: UUID) -> str:
    """Creates and stores a new opaque token for `user_uuid`. Caller commits."""
    token = secrets.token_urlsafe(32)
    session.add(AuthTokenDB(token=token, user_uuid=user_uuid))
    return token


def get_user_from_token(session: Session, token: str):
    """Resolves a bearer token to its UserDB row, or None if it doesn't
    exist or has been revoked."""
    from app.core.users.schema import UserDB

    entry = session.query(AuthTokenDB).filter_by(token=token, revoked=False).first()
    if entry is None:
        return None
    return session.get(UserDB, entry.user_uuid)
