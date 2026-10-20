"""Live device readings for EPIChem's Device Monitoring (plan §13: "every live value shows its timestamp").

`make_read_devices(namespace)` returns a plain function that the profile puts
into the worker namespace as `read_devices`. EPIChem calls it through the
queueserver's function-execution API, in the background, so readings keep
coming while a plan runs. Driver-backed devices re-read their driver first;
soft devices are read as they are.
"""

import math
from typing import Any

from ophyd import Device


def _plain(value: Any) -> Any:
    """JSON-safe: numbers, bools and strings as they are, anything else as text."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return value if not (isinstance(value, float) and not math.isfinite(value)) else None
    return str(value)


def make_read_devices(namespace: dict):
    def read_devices(names: list | None = None) -> dict:
        """Current readings of the station's devices (all, or those named)."""
        out: dict[str, Any] = {}
        for name, device in list(namespace.items()):
            if name.startswith("_") or not isinstance(device, Device) or device.parent is not None:
                continue
            if names and name not in names:
                continue
            try:
                if hasattr(device, "refresh") and hasattr(device, "lock"):
                    with device.lock:
                        device.refresh()
                described = device.describe()
                readings = {
                    key: {
                        "value": _plain(reading["value"]),
                        "timestamp": reading["timestamp"],
                        "units": described.get(key, {}).get("units") or "",
                    }
                    for key, reading in device.read().items()
                }
                out[name] = {"class": type(device).__name__, "readings": readings, "error": None}
            except Exception as exc:  # one broken device mustn't blank the whole panel
                out[name] = {"class": type(device).__name__, "readings": {}, "error": f"{type(exc).__name__}: {exc}"}
        return out

    return read_devices
