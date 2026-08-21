from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionDepends

from .logic import authenticate_user, get_user_from_token, issue_token, revoke_token
from .schema import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    session: SessionDepends,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)],
):
    """Reusable dependency for future routes; not wired into any device-management route yet."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    user = get_user_from_token(session, credentials.credentials)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked token.")
    return user


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, session: SessionDepends):
    user = authenticate_user(session, body.name, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Incorrect name or password.")
    token = issue_token(session, user.uuid)
    session.commit()
    return TokenResponse(access_token=token)


@router.post("/logout", status_code=204)
def logout(
    session: SessionDepends,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)],
):
    """Revokes the caller's own token."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    revoke_token(session, credentials.credentials)
    session.commit()


@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"uuid": user.uuid, "name": user.name}  # plain dict, not the User schema -- avoids importing app.core.access_control.users here
