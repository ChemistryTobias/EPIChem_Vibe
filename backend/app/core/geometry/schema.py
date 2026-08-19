# object_geometry holds 0..N boxes; an EMPTY list means the object is virtual.
# asset_2d/asset_3d below are commented out on purpose -- not wired up yet.

from pydantic import BaseModel, Field
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column


class GeometryDescriptor(BaseModel):
    detail: str
    box_position_xyz: tuple[float, float, float]
    box_dimension_xyz: tuple[float, float, float]
    # asset_2d: Optional[str] = None  # e.g. an svg/png FileDB reference
    # asset_3d: Optional[str] = None  # e.g. a usd/usdz FileDB reference


class GeometryDB:
    object_geometry: Mapped[list[GeometryDescriptor]] = mapped_column(JSON, default=list)


class ObjectGeometry(BaseModel):
    object_geometry: list[GeometryDescriptor] = Field(default_factory=list)
