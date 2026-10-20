"""Functions EPIChem may call in this worker (not plans): live readings for Device Monitoring."""

from epichem_devices.readings import make_read_devices as _make_read_devices

read_devices = _make_read_devices(globals())
