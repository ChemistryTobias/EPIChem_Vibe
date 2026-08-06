"""Capability classes (§6.3): the interface a device promises, decoupled
from vendor. `actions` holds the RFC 2119 contract as authored in the YAML
(plan reference, params, contract lines, emitted events) — the compiler that
maps abstract steps to a device's implementing plan doesn't exist yet (that's
M3); this model exists so classes can be registered and referenced now.
"""

import uuid as uuid_mod

from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from epichem.idgen import uuid7
from epichem.models.base import Base, TimestampMixin


class CapabilityClass(Base, TimestampMixin):
    __tablename__ = "capability_classes"

    id: Mapped[uuid_mod.UUID] = mapped_column(primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(unique=True, index=True)  # e.g. "HeaterStirrer"
    iri: Mapped[str | None] = mapped_column(default=None)
    extends: Mapped[list[str]] = mapped_column(JSON, default=list)
    actions: Mapped[dict] = mapped_column(JSON, default=dict)
