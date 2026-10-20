"""{{name}} -- an EPIChem station pod.

Run it:      epichem-pod serve station.py --epichem http://<epichem-host>:8000
Inspect it:  epichem-pod discover station.py

Create your instrument drivers below, as plain Python objects, then call
expose(globals()). Every driver becomes an ophyd device (its get_*/read_*
methods are its live readings) and every other public method becomes a
Bluesky plan EPIChem's workflow designer and Device Monitoring can run --
parameters, defaults, descriptions and [min, max] ranges are taken from the
method signatures and docstrings. Nothing else to write.
"""

from epichem_pod import expose

# --- your drivers ----------------------------------------------------------------
# These are simulators so the station runs anywhere. Swap each for your real
# driver, e.g.
#     from mylab.ika import HotplateDriver
#     hotplate = HotplateDriver("192.168.10.22", 4001, hotplate_number=1, T_max=300)
from epichem_pod.drivers.sim import SimHotplate, SimPipette

hotplate = SimHotplate(hotplate_number=1, T_max=300)
pipette = SimPipette()
pipette.initialize_dosing_drive()

expose(globals())  # drivers -> ophyd devices + one plan per method (e.g. hotplate_set_temperature_setpoint)


# --- your own plans (optional) ------------------------------------------------
# Compose the generated plans into the operations your scientists think in.
# Type hints, defaults and a docstring are all the UI needs.
def warm_up(setpoint_c: float = 60.0):
    """Set the hotplate to a temperature and switch the heater on.

    Args:
        setpoint_c (float, [20, 300]): Target temperature in degC.
    """
    yield from hotplate_set_temperature_setpoint(T_SET=round(setpoint_c))  # noqa: F821 -- made by expose()
    yield from hotplate_start_heating()  # noqa: F821
