"""Shared database setup: engine, session factory, declarative base, and the
FastAPI session dependency. Every module's models and endpoints import from here.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

engine = create_engine("sqlite:///./site.db", connect_args={"check_same_thread": False}, echo=True)
SessionLocal = sessionmaker(bind=engine)


class Database(DeclarativeBase):
    pass


def get_session():
    with SessionLocal() as session:
        yield session


# Reusable session dependency: type an endpoint parameter as `SessionDepends`
# instead of writing `session: Session = Depends(get_session)` each time.
SessionDepends = Annotated[Session, Depends(get_session)]
