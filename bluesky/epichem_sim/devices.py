"""Soft (simulated) lab instruments as real ophyd Devices.

They implement the same bluesky protocols a hardware-backed ophyd device would
(`Movable`: set() returns a Status; `Readable`: read()/describe(); `Triggerable`
where it makes sense), so plans written against them run unchanged once the
class behind a device name is swapped for an EPICS-backed one.

Time is compressed by `EPICHEM_SIM_SPEED` (default 10x) so a demo heat ramp
takes seconds, not minutes.
"""

import math
import os
import random
import threading
import time

from ophyd import Component as Cpt
from ophyd import Device, Signal
from ophyd.status import DeviceStatus

SPEED = float(os.environ.get("EPICHEM_SIM_SPEED", "10"))
TICK_S = 0.05


class SimRamp(Device):
    """A quantity that approaches its setpoint at a fixed rate — a heater's
    temperature, a stirrer's speed, a pump's dispensed volume.

    `set(value)` returns a Status that finishes once the readback arrives.
    """

    readback = Cpt(Signal, value=0.0, kind="hinted")
    setpoint = Cpt(Signal, value=0.0, kind="config")

    def __init__(self, *args, rate: float = 1.0, initial: float = 0.0, units: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._rate = rate  # units per (simulated) second
        self._units = units
        self._lock = threading.Lock()
        self._generation = 0
        self.readback.put(initial)
        self.setpoint.put(initial)

    @property
    def position(self) -> float:
        return self.readback.get()

    def describe(self):
        description = super().describe()
        for entry in description.values():
            entry["units"] = self._units
        return description

    def set(self, value, **kwargs):
        value = float(value)
        status = DeviceStatus(self)
        with self._lock:
            self._generation += 1
            generation = self._generation
        self.setpoint.put(value)

        def ramp():
            while True:
                with self._lock:
                    if generation != self._generation:  # superseded by a newer set()
                        status.set_exception(RuntimeError(f"{self.name}: setpoint changed before arrival"))
                        return
                current = self.readback.get()
                step = self._rate * SPEED * TICK_S
                if abs(value - current) <= step:
                    self.readback.put(value)
                    status.set_finished()
                    return
                self.readback.put(current + math.copysign(step, value - current))
                time.sleep(TICK_S)

        threading.Thread(target=ramp, daemon=True, name=f"{self.name}-ramp").start()
        return status

    def stop(self, *, success: bool = False):
        with self._lock:
            self._generation += 1
        self.setpoint.put(self.readback.get())


class SimHeaterStirrer(SimRamp):
    """A hotplate: moving it sets the plate temperature (°C); `stir_rpm` is a
    second axis with its own ramp."""

    stir_rpm = Cpt(SimRamp, rate=200.0, units="rpm", kind="normal")

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("rate", 2.0)
        kwargs.setdefault("initial", 21.0)
        kwargs.setdefault("units", "degC")
        super().__init__(*args, **kwargs)


class SimSyringePump(SimRamp):
    """A syringe pump: its position is the total volume dispensed (mL)."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("rate", 0.5)
        kwargs.setdefault("units", "mL")
        super().__init__(*args, **kwargs)


class SimSpectrometer(Device):
    """A UV-Vis probe: trigger() integrates for `exposure_s`, then `absorbance`
    holds a reading that depends on the coupled hotplate's temperature — so a
    temperature series produces a curve rather than noise."""

    absorbance = Cpt(Signal, value=0.0, kind="hinted")
    exposure_s = Cpt(Signal, value=0.5, kind="config")

    def __init__(self, *args, heater: SimRamp | None = None, peak_c: float = 65.0, **kwargs):
        super().__init__(*args, **kwargs)
        self._heater = heater
        self._peak_c = peak_c

    def trigger(self):
        status = DeviceStatus(self)

        def integrate():
            time.sleep(self.exposure_s.get() / SPEED)
            t = self._heater.position if self._heater is not None else 25.0
            signal = math.exp(-(((t - self._peak_c) / 15.0) ** 2))
            self.absorbance.put(round(0.05 + 0.9 * signal + random.gauss(0, 0.01), 4))
            status.set_finished()

        threading.Thread(target=integrate, daemon=True, name=f"{self.name}-trigger").start()
        return status
