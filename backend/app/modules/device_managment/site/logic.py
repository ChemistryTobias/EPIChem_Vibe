from datetime import datetime

from app.core.geometry.schema import GeometryDescriptor


def get_system_timezone() -> str:
    try:
        tz = datetime.now().astimezone().tzinfo
        return str(tz) if tz is not None else "UNKNOWN"
    except Exception:
        return "UNKNOWN"