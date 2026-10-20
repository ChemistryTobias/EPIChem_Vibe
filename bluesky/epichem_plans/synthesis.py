"""Synthesis station: heat, stir, dispense, wait, measure -- simple, device-parameterised plans
over the soft devices in `epichem_devices.ramp`.

Annotate every parameter: EPIChem builds its node palette and parameter forms
from these signatures, docstrings and `parameter_annotation_decorator`
metadata (plan §9.2). Steps that only move/wait don't open a run; the
measuring plans do, and the queue item's `meta` (EPIChem's procedure, run and
sample ids) lands in their start document.
"""

import bluesky.plan_stubs as bps
import bluesky.plans as bp
from bluesky_queueserver import parameter_annotation_decorator


def build(devices: dict) -> dict:
    """`devices`: the station's device objects by name; measurements also read
    every heater, so a reading always carries the temperature it was taken at."""
    context = [d for name, d in devices.items() if name == "hotplate"]

    HEATERS = {"Heaters": ["hotplate"]}
    PUMPS = {"Pumps": ["pump"]}
    DETECTORS = {"Detectors": ["spectrometer"]}


    @parameter_annotation_decorator(
        {
            "description": "Bring a heater to a temperature setpoint.",
            "parameters": {
                "heater": {"annotation": "Heaters", "devices": HEATERS, "description": "Heater to drive."},
                "setpoint_c": {"description": "Target temperature in degC.", "min": 20, "max": 300, "step": 0.5},
                "wait_until_stable": {"description": "Block until the setpoint is reached."},
            },
        }
    )
    def heat(heater, setpoint_c: float, wait_until_stable: bool = True):
        """Heat (or cool) to a setpoint.

        Parameters
        ----------
        heater
            Heater to drive.
        setpoint_c
            Target temperature in degC.
        wait_until_stable
            Block until the setpoint is reached.
        """
        if wait_until_stable:
            yield from bps.mv(heater, setpoint_c)
        else:
            yield from bps.abs_set(heater, setpoint_c)


    @parameter_annotation_decorator(
        {
            "description": "Set a stirrer's speed.",
            "parameters": {
                "stirrer": {"annotation": "Heaters", "devices": HEATERS, "description": "Heater-stirrer to drive."},
                "rpm": {"description": "Stirring speed in rpm.", "min": 0, "max": 1500, "step": 10},
            },
        }
    )
    def stir(stirrer, rpm: float):
        """Set the stirring speed.

        Parameters
        ----------
        stirrer
            Heater-stirrer to drive.
        rpm
            Stirring speed in rpm.
        """
        yield from bps.mv(stirrer.stir_rpm, rpm)


    @parameter_annotation_decorator(
        {
            "description": "Dispense a volume of liquid with a syringe pump.",
            "parameters": {
                "pump": {"annotation": "Pumps", "devices": PUMPS, "description": "Pump to dispense with."},
                "volume_ml": {"description": "Volume to dispense in mL.", "min": 0.01, "max": 50, "step": 0.01},
            },
        }
    )
    def dispense(pump, volume_ml: float):
        """Dispense liquid.

        Parameters
        ----------
        pump
            Pump to dispense with.
        volume_ml
            Volume to dispense in mL.
        """
        yield from bps.mvr(pump, volume_ml)


    @parameter_annotation_decorator(
        {
            "description": "Wait, doing nothing, for a fixed time.",
            "parameters": {"duration_s": {"description": "How long to wait, in seconds.", "min": 0, "max": 86400}},
        }
    )
    def hold(duration_s: float):
        """Wait for a fixed time.

        Parameters
        ----------
        duration_s
            How long to wait, in seconds.
        """
        yield from bps.sleep(duration_s)


    @parameter_annotation_decorator(
        {
            "description": "Record absorbance (and the plate temperature alongside it).",
            "parameters": {
                "detector": {"annotation": "Detectors", "devices": DETECTORS, "description": "Spectrometer to read."},
                "num": {"description": "Number of readings.", "min": 1, "max": 1000},
                "delay_s": {"description": "Pause between readings, in seconds.", "min": 0, "max": 3600},
            },
        }
    )
    def measure_absorbance(detector, num: int = 1, delay_s: float = 0.0, md: dict | None = None):
        """Measure absorbance.

        Parameters
        ----------
        detector
            Spectrometer to read.
        num
            Number of readings.
        delay_s
            Pause between readings, in seconds.
        md
            Extra run metadata.
        """
        yield from bp.count([detector, *context], num=num, delay=delay_s, md=md)


    @parameter_annotation_decorator(
        {
            "description": "Step the temperature and read the detector at each step.",
            "parameters": {
                "detector": {"annotation": "Detectors", "devices": DETECTORS, "description": "Detector to read."},
                "heater": {"annotation": "Heaters", "devices": HEATERS, "description": "Heater to step."},
                "start_c": {"description": "First temperature in degC.", "min": 20, "max": 300},
                "stop_c": {"description": "Last temperature in degC.", "min": 20, "max": 300},
                "num": {"description": "Number of steps.", "min": 2, "max": 200},
            },
        }
    )
    def temperature_series(detector, heater, start_c: float, stop_c: float, num: int = 5, md: dict | None = None):
        """Temperature series.

        Parameters
        ----------
        detector
            Detector to read.
        heater
            Heater to step.
        start_c
            First temperature in degC.
        stop_c
            Last temperature in degC.
        num
            Number of steps.
        md
            Extra run metadata.
        """
        yield from bp.scan([detector], heater, start_c, stop_c, num, md=md)

    return {f.__name__: f for f in (heat, stir, dispense, hold, measure_absorbance, temperature_series)}
