"""Example schema for the plugin template. Real plugins define their own
Pydantic models (and SQLAlchemy models inheriting core.database.Database) here,
exactly like a normal module's schema.py.
"""

from pydantic import BaseModel


class Pong(BaseModel):
    plugin: str
    status: str = "ok"
