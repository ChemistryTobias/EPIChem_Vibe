from typing import Literal, Optional

from pydantic import BaseModel, Field
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column


class GeometryDescriptor(BaseModel):
    detail: str
    shape: Literal["rectangle", "sphere", "cylinder"] = Field(
        default="rectangle", description="The primitive geometric shape type."
    )
    box_position_xyz: tuple[float, float, float]
    box_dimension_xyz: tuple[float, float, float]
    internal_positions: dict[str, tuple[float, ...]] = Field(
        default_factory=dict,
        description=(
            "Named points inside this object, relative to its own origin -- a "
            "port, a mount, a pick position. Each entry sets its own length, so "
            "an (x, y) and an (x, y, z, rx, ry, rz) pose can sit side by side. "
            "Not surfaced in the console yet."
        ),
    )
    # asset_2d: Optional[str] = None  # e.g. an svg/png FileDB reference
    # asset_3d: Optional[str] = None  # e.g. a usd/usdz FileDB reference


class ObjectGeometryDB:
    object_geometry: Mapped[Optional[GeometryDescriptor]] = mapped_column(JSON, default=None)


class ObjectGeometry(BaseModel):
    object_geometry: Optional[GeometryDescriptor] = None


class ObjectGeometryListDB:
    object_geometry: Mapped[list[GeometryDescriptor]] = mapped_column(JSON, default=list)


class ObjectGeometryList(BaseModel):
    object_geometry: list[GeometryDescriptor] = Field(default_factory=list)
