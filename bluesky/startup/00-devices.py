"""Devices in this station's worker namespace.

Every name defined here that is an ophyd Device becomes usable in plans and
shows up in `devices_allowed` — and therefore in EPIChem's workflow palette.
To onboard a real instrument, replace a simulated class with its EPICS-backed
ophyd class (same name, same protocols), e.g.

    from ophyd import EpicsMotor
    stage_x = EpicsMotor("MPIFKF:STAGE:X", name="stage_x")

and regenerate `existing_plans_and_devices.yaml` (the entrypoint does it on start).
"""

from ophyd.sim import det, motor  # noqa: F401 -- generic sims for the stock count/scan plans

from epichem_sim import SimHeaterStirrer, SimSpectrometer, SimSyringePump

hotplate = SimHeaterStirrer(name="hotplate")
pump = SimSyringePump(name="pump")
spectrometer = SimSpectrometer(name="spectrometer", heater=hotplate)
