"""Station pods EPIChem has heard from but a person hasn't adopted yet (plan §6.2, Roadmap 1.3).

Pods announce themselves (`epichem-pod` does on start and then periodically),
or a person probes a URL. Either way a pod lands here, *pending*: plan §6.2 --
discovery assists, it never registers anything without human confirmation.
Adopting one links it to a station and registers its devices. Operational
state, not lab configuration, so no revisions here; adoption's writes (the
station, its devices) are revisioned as usual.
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database
from app.modules.sample_tracking.samples.schema import utc_now


class DiscoveredPodDB(Database):
    __tablename__ = "discovered_pods"

    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    url: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    station: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, default=None)
    devices: Mapped[dict] = mapped_column(JSON, default=dict)
    plans: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(20), default="announce")  # "announce" | "probe"
    first_seen: Mapped[datetime] = mapped_column(default=utc_now)
    last_seen: Mapped[datetime] = mapped_column(default=utc_now)


class Announcement(BaseModel):
    """What a pod says about itself."""

    url: str = Field(max_length=200, description="How EPIChem reaches the pod's HTTP server.")
    station: str = Field(max_length=100, description="The pod's own name for its station.")
    description: Optional[str] = None
    devices: dict[str, Any] = Field(default_factory=dict)
    plans: list[str] = Field(default_factory=list)


class DiscoveredPod(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: UUID
    url: str
    station: str
    description: Optional[str] = None
    devices: dict[str, Any]
    plans: list[str]
    source: str
    first_seen: datetime
    last_seen: datetime
    online: bool = False
    station_uuid: Optional[UUID] = Field(default=None, description="The station already using this URL, if any.")


class Probe(BaseModel):
    url: str = Field(max_length=200)


class Adopt(BaseModel):
    """Link to an existing station, or create one in a lab."""

    station_uuid: Optional[UUID] = None
    lab_uuid: Optional[UUID] = None
    name: Optional[str] = Field(default=None, max_length=50)
    register_devices: bool = True
