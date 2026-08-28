from datetime import datetime

from app.core.shared_schema.geometry.schema import GeometryDescriptor

#: Storeys are stacked this far apart, in metres, when a site's floors are
#: generated from `floor_no`.
FLOOR_HEIGHT_M = 4.0


def get_system_timezone() -> str:
    try:
        tz = datetime.now().astimezone().tzinfo
        return str(tz) if tz is not None else "UNKNOWN"
    except Exception:
        return "UNKNOWN"


def default_floors(floor_no: int) -> list[tuple[str, GeometryDescriptor]]:
    """One floor per storey, each `FLOOR_HEIGHT_M` above the one below it."""
    return [
        (
            f"Floor {i + 1}",
            GeometryDescriptor(
                detail=f"Floor {i + 1}",
                shape="rectangle",
                box_position_xyz=(0, 0, i * FLOOR_HEIGHT_M),
                box_dimension_xyz=(60, 50, 3),
            ),
        )
        for i in range(max(floor_no, 1))
    ]
