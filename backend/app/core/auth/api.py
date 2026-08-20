from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionDepends

from .logic import authenticate_user, get_user_from_token, issue_token
from .schema import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    session: SessionDepends,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)],
):
    """Reusable dependency for future routes: 401s unless `Authorization:
    Bearer <token>` resolves to an active, non-revoked-token user. Not wired
    into any device-management route yet -- see the Roadmap for the
    none/read/read-write access model this is meant to sit underneath.
    """
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


@router.get("/me")
def me(user=Depends(get_current_user)):
    # A plain dict, not the `User` schema from app.core.users -- keeps this
    # module import-independent of app.core.users at load time (see logic.py).
    return {"uuid": user.uuid, "name": user.name}
