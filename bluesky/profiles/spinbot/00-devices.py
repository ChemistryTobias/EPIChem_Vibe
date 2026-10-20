"""Spinbot's devices, built from station.yaml: drivers (simulated or real), wrapped as ophyd Devices.

Each device lands in the worker namespace under its config name (arm,
pipette, hotplate1, ...), which is what `devices_allowed` reports and what
EPIChem's palette offers.
"""

import os

from epichem_pod.devices.station import load_station

station = load_station(
    os.environ.get("EPICHEM_STATION_CONFIG")
    or os.path.join(os.environ.get("STARTUP_DIR", os.path.dirname(os.path.abspath(__file__))), "station.yaml")
)
globals().update(station.devices)

# Bring the instruments to a known state when the worker opens -- as the SDL
# did in its constructor. Skipped while the entrypoint is only listing the
# profile's plans and devices.
if not os.environ.get("EPICHEM_LISTING"):
    station.devices["pipette"].initialize.set(None).wait(timeout=120)
