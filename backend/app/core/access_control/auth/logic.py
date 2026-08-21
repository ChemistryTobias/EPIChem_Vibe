import secrets
from uuid import UUID

from sqlalchemy.orm import Session

from .schema import AuthTokenDB


def authenticate_user(session: Session, name: str, password: str):
    """Returns the matching UserDB row, or None if the name/password is wrong or inactive."""
    from app.core.access_control.users.logic import verify_password  # deferred: users module lands after auth in git history
    from app.core.access_control.users.schema import UserDB

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
    """Resolves a bearer token to its UserDB row, or None if invalid/revoked."""
    from app.core.access_control.users.schema import UserDB

    entry = session.query(AuthTokenDB).filter_by(token=token, revoked=False).first()
    if entry is None:
        return None
    return session.get(UserDB, entry.user_uuid)


def revoke_token(session: Session, token: str) -> None:
    """Marks a token revoked. No-op if it doesn't exist. Caller commits."""
    entry = session.query(AuthTokenDB).filter_by(token=token).first()
    if entry is not None:
        entry.revoked = True
