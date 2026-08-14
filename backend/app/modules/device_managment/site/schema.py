"""Site schemas: the SQLAlchemy model (SiteDB) and the Pydantic model (Site)."""

from typing import Optional
from uuid import UUID, uuid4
from datetime import 

from pydantic import BaseModel, ConfigDict, Field, NaiveDatetime
from sqlalchemy import types
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Database


class SiteDB(Database):
    __tablename__ = "dm_sites"

    # object base 
    uuid: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(types.String(50), unique=True)
    created_at: Mapped[NaiveDatetime] = mapped_column(types.DateTime)# default=on creation
    updated_at: Mapped[NaiveDatetime] = mapped_column(types.DateTime)# default=on update
    description: Mapped[Optional[str]] = mapped_column(types.Text, default=None)

    # site specific
    organisation: Mapped[???]
    address: Mapped[Optional[???]] = mapped_column(default=None)
    coordinates: Mapped[Optional[???]] 
    timezone: Mapped[] # default=on creation
    site_zones: Mapped[Optional[zones]] 
    labs: Mapped[Optional[labs]] 
    
    # dimension object
    dimensions: Mapped[list] = mapped_column(types.JSON, default=list) # very simple list (<-e.g. for levels or for more complex stuff) [(posx, posy, posz, dimx, dimy, dimz), ...] to roughly represent any object physical object as a rectangle (on this level optional coordinates would set the origina)
    svg: Mapped[Optional[bin]] # optional svg object(s) list -> must adhere to the dimensions provided
    usd: Mapped[Optional[bin]] # optional Universal Scene Description object(s) list -> must be inside the dimensions provided

class Site(BaseModel):
    uuid: UUID
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    timezone: Optional[str] = None
    dimensions: Optional[list] = Field(default_factory=list)
    visualizer: Optional[dict] = Field(default_factory=dict)

class CreateSite(Site):
    model_config = ConfigDict(from_attributes=True)
    uuid: Optional[UUID] = None
    
class UpdateSite(Site):
    uuid: Optional[UUID] = None
    name: Optional[str] = None
