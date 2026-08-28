from datetime import datetime

from app.core.shared_schema.geometry.schema import GeometryDescriptor


def get_system_timezone() -> str:
    try:
        tz = datetime.now().astimezone().tzinfo
        return str(tz) if tz is not None else "UNKNOWN"
    except Exception:
        return "UNKNOWN"
    
def get_default_geometry() -> list[GeometryDescriptor]:
    return [
        GeometryDescriptor(
            detail="Floor 1", 
            shape="rectangle", 
            box_position_xyz=(0, 0, 0), 
            box_dimension_xyz=(60, 50, 3)
        )
    ]
