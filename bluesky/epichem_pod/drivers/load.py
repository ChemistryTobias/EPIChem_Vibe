"""Build drivers from a station config -- the one switch between simulation and hardware.

    devices:
      arm:
        driver: epichem_pod.epichem_pod.drivers.sim:SimArm          # or e.g. mylab.dobot_driver:DobotM1
        args: {ip: 192.168.10.20, speed_ratio: 50}
        connect: true                        # call .connect() after construction

`driver` is an import path (`module:Class`), the same idea as a device
descriptor's `ophyd_import` (plan §6.1).
"""

import importlib
from typing import Any


def import_object(path: str) -> Any:
    module, _, name = path.partition(":")
    if not name:
        raise ValueError(f"Driver path {path!r} must look like 'package.module:ClassName'.")
    return getattr(importlib.import_module(module), name)


def build_driver(spec: dict[str, Any]) -> Any:
    driver = import_object(spec["driver"])(**(spec.get("args") or {}))
    if spec.get("connect") and hasattr(driver, "connect"):
        driver.connect()
    return driver
