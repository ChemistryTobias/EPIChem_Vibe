from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import DeclarativeBase, Session

from .session_config import engine as engine
from .session_config import get_session


# Public API: the base class every model inherits from.
class Database(DeclarativeBase):
    pass


# Public API: reusable session dependency for endpoints.
SessionDepends = Annotated[Session, Depends(get_session)]
