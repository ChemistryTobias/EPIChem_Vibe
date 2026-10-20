"""Wrap instrument drivers as ophyd Devices.

The building block is `DriverAction`: a Signal whose `set(args)` runs one
method of its device on a worker thread and returns a Status that finishes
when the call returns (or fails with the driver's exception -- which then
fails the plan, and the queue item, with that message). So a driver method
like `arm.jump(x, y, z, r)` is used from a plan as

    yield from do(arm.jump, (x, y, z, r))       # do() = bps.mv + the driver's error message

and gets everything a motor move gets: waiting, pausing between steps,
failure reporting. Adding an instrument type means: write its wrapper class
here (state Signals + DriverActions + small methods doing unit conversion),
register it in `DEVICE_TYPES`, and use it from plans.
"""

import threading
import time
from typing import Any

import bluesky.plan_stubs as bps
from bluesky.utils import FailedStatus
from ophyd import Component as Cpt
from ophyd import Device, Signal
from ophyd.status import DeviceStatus, Status


class DriverAction(Signal):
    """One driver call, exposed as a Movable. The value is the last arguments sent."""

    def __init__(self, *args, call: str, **kwargs):
        kwargs.setdefault("value", None)
        kwargs.setdefault("kind", "omitted")
        super().__init__(*args, **kwargs)
        self._call = call

    def set(self, value, **kwargs):
        device = self.parent
        method = getattr(device, self._call)
        status = Status(obj=self)

        def work():
            try:
                with device.lock:
                    if isinstance(value, dict):
                        method(**value)
                    elif isinstance(value, (list, tuple)):
                        method(*value)
                    elif value is None:
                        method()
                    else:
                        method(value)
                    device.refresh()
                self.put(value)
                status.set_finished()
            except Exception as exc:  # the driver's own message reaches the run's report
                status.set_exception(exc)

        threading.Thread(target=work, daemon=True, name=f"{self.name}").start()
        return status


def do(target, value=None):
    """Plan stub: `bps.mv(target, value)`, but a failure carries the driver's
    own message ("PipetteError: 75 - No tip present") instead of a bare Status
    repr -- that message is what EPIChem shows on the failed run."""
    try:
        yield from bps.mv(target, value)
    except FailedStatus as failure:
        cause = failure.__cause__
        if cause is None:
            raise
        raise RuntimeError(f"{target.name}: {type(cause).__name__}: {cause}") from failure


def action(call: str) -> Cpt:
    """A DriverAction component. `kind="omitted"` must be passed here -- a
    Component hands its own default kind (normal) to the Signal, and an action
    in a device's readings would break every `trigger_and_read`."""
    return Cpt(DriverAction, call=call, kind="omitted")


class DriverDevice(Device):
    """Base: holds the driver and serialises access to it (one conversation at a time)."""

    def __init__(self, *args, driver: Any, options: dict | None = None, **kwargs):
        self.driver = driver
        self.options = options or {}
        self.lock = threading.RLock()
        super().__init__(*args, **kwargs)

    @property
    def time_scale(self) -> float:
        """Simulated drivers run faster than real time; waits shrink with them."""
        return getattr(self.driver, "time_scale", 1.0)

    def refresh(self) -> None:
        """Re-read state from the driver into the Signals. Override per type."""

    def trigger(self):
        status = DeviceStatus(self)
        try:
            with self.lock:
                self.refresh()
            status.set_finished()
        except Exception as exc:
            status.set_exception(exc)
        return status


class RobotArm(DriverDevice):
    """A SCARA arm with a gripper. Cartesian in mm/deg, joints in deg (j3 in mm)."""

    x = Cpt(Signal, value=0.0, kind="hinted")
    y = Cpt(Signal, value=0.0, kind="hinted")
    z = Cpt(Signal, value=0.0, kind="hinted")
    r = Cpt(Signal, value=0.0, kind="normal")
    gripper_open = Cpt(Signal, value=True, kind="normal")

    jump = action("_jump")
    move_linear = action("_move_linear")
    jump_angle = action("_jump_angle")
    gripper = action("_gripper")
    retract = action("_retract")

    def _jump(self, x, y, z, r):
        self.driver.jump(x=x, y=y, z=z, r=r)

    def _move_linear(self, x, y, z, r):
        self.driver.move_linear(x=x, y=y, z=z, r=r)

    def _jump_angle(self, j1, j2, j3, j4):
        self.driver.jump_angle(j1=j1, j2=j2, j3=j3, j4=j4)

    def _gripper(self, is_open):
        self.driver.gripper(is_open=bool(is_open))
        self.gripper_open.put(bool(is_open))

    def _retract(self, safe_z):
        """Straight up to `safe_z` where it stands -- how every handling step ends."""
        x, y, _z, r, *_ = self.driver.get_position()
        self.driver.move_linear(x=x, y=y, z=safe_z, r=r)

    def refresh(self):
        x, y, z, r, *_ = self.driver.get_position()
        self.x.put(x)
        self.y.put(y)
        self.z.put(z)
        self.r.put(r)


class Pipette(DriverDevice):
    """A pipetting module. Plans speak uL; the module speaks 0.1 uL integers."""

    tip_present = Cpt(Signal, value=False, kind="normal")
    last_volume_ul = Cpt(Signal, value=0.0, kind="hinted")

    initialize = action("_initialize")
    pick_up_tip = action("_pick_up_tip")
    discard_tip = action("_discard_tip")
    aspirate = action("_aspirate")
    dispense = action("_dispense")
    move_z = action("_move_z")

    def _initialize(self):
        self.driver.initialize_dosing_drive()
        self.driver.initialize_z_drive()
        deck = self.options.get("deck_geometry")
        if deck:
            self.driver.set_deck_geometry_parameters(**deck)

    def _pick_up_tip(self, tip_type_index=0, deck_geometry_index=0):
        self.driver.pick_up_tip(tip_type_index=tip_type_index, deck_geometry_index=deck_geometry_index)

    def _discard_tip(self, deck_geometry_index=0):
        self.driver.discard_tip(deck_geometry_index=deck_geometry_index)
        self.driver.move_z_drive(0)

    def _aspirate(self, volume_ul, **params):
        self.driver.aspirate(aspiration_volume=round(volume_ul * 10), **params)
        self.last_volume_ul.put(float(volume_ul))

    def _dispense(self, volume_ul, **params):
        self.driver.dispense(dispensing_volume=round(volume_ul * 10), **params)
        self.last_volume_ul.put(-float(volume_ul))

    def _move_z(self, position, speed=1):
        self.driver.move_z_drive(position=int(position), speed=int(speed))

    def refresh(self):
        if hasattr(self.driver, "request_tip_presence_status"):
            self.tip_present.put(bool(self.driver.request_tip_presence_status()))


class Hotplate(DriverDevice):
    """A heater-stirrer. Moving it sets the temperature and waits until it's
    within `tolerance_c` (option, default 2 degC), or fails after `timeout_s`."""

    temperature = Cpt(Signal, value=0.0, kind="hinted")
    setpoint = Cpt(Signal, value=0.0, kind="config")
    stir_rpm = Cpt(Signal, value=0.0, kind="normal")

    heat = action("_heat")  # start heating, don't wait
    off = action("_off")
    stir = action("_stir")

    @property
    def position(self) -> float:
        return self.temperature.get()

    def _heat(self, setpoint_c):
        self.driver.set_temperature_setpoint(round(setpoint_c))
        self.driver.start_heating()
        self.setpoint.put(float(setpoint_c))

    def _off(self):
        self.driver.stop_heating()

    def _stir(self, rpm):
        if rpm <= 0:
            self.driver.stop_stirring()
        else:
            self.driver.set_stirring_speed_setpoint(round(rpm))
            self.driver.start_stirring()

    def set(self, value, **kwargs):
        status = DeviceStatus(self)
        tolerance = float(self.options.get("tolerance_c", 2.0))
        timeout = float(self.options.get("timeout_s", 1800)) * self.time_scale
        poll = float(self.options.get("poll_s", 5.0)) * self.time_scale

        def work():
            try:
                with self.lock:
                    self._heat(value)
                deadline = time.monotonic() + timeout
                while True:
                    with self.lock:
                        self.refresh()
                    if abs(self.temperature.get() - value) < tolerance:
                        status.set_finished()
                        return
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"{self.name} didn't reach {value} degC within {timeout / self.time_scale:.0f} s.")
                    time.sleep(poll)
            except Exception as exc:
                status.set_exception(exc)

        threading.Thread(target=work, daemon=True, name=f"{self.name}-set").start()
        return status

    def refresh(self):
        self.temperature.put(float(self.driver.get_temperature()))
        if hasattr(self.driver, "get_stirring_speed"):
            self.stir_rpm.put(float(self.driver.get_stirring_speed()))


class SpinCoater(DriverDevice):
    """A spin coater: `spin` runs a whole profile -- ramp to speed, hold, stop."""

    speed_rpm = Cpt(Signal, value=0.0, kind="hinted")
    spin = action("_spin")
    home = action("_home")

    def _spin(self, speed_rpm, acceleration, duration_s):
        self.driver.set_spinning_parameter(int(speed_rpm), int(acceleration))
        self.driver.start_spinning()
        self.speed_rpm.put(float(speed_rpm))
        try:
            time.sleep(float(duration_s) * self.time_scale)
        finally:
            self.driver.stop_spinning()
            self.speed_rpm.put(0.0)

    def _home(self):
        self.driver.move_to_home_position()

    def refresh(self):
        if hasattr(self.driver, "get_speed"):
            self.speed_rpm.put(float(self.driver.get_speed()))


# The `type:` a station config gives a device -> its wrapper.
DEVICE_TYPES = {"arm": RobotArm, "pipette": Pipette, "hotplate": Hotplate, "spincoater": SpinCoater}
