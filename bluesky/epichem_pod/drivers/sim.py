"""Simulated drivers with the method surface of real lab-instrument drivers.

Behaviour worth simulating is simulated -- motion takes time, a hotplate warms
at a finite rate, a pipette refuses to aspirate without a tip and reports it
with the module's own style of error code -- so workflows fail in the
simulator the way they would on the bench. Time runs `EPICHEM_SIM_SPEED`
times faster than real.
"""

import math
from typing import ClassVar
import os
import threading
import time

SPEED = float(os.environ.get("EPICHEM_SIM_SPEED", "10"))


class _Simulated:
    """Marks a simulator: wrappers scale their own waits (polls, hold times) by
    `time_scale`, so a 60 s anneal in a simulated station takes 6 s."""

    time_scale = 1.0 / SPEED


def _sleep(seconds: float) -> None:
    time.sleep(max(seconds, 0) / SPEED)


class SimArm(_Simulated):
    """A 4-axis SCARA arm with a gripper on digital outputs (Dobot-M1-like API).

    Cartesian moves in mm/deg; joint moves in deg (j3 is the vertical axis, mm).
    """

    L1, L2 = 200.0, 200.0  # link lengths, mm
    REACH = L1 + L2
    Z_RANGE = (0.0, 245.0)

    def __init__(self, ip: str = "sim", speed_ratio: float = 50, acceleration_ratio: float = 50,
                 robot_safe_height: float = 180.0, gripper_IO_pins: list | None = None, **_ignored):
        self.ip = ip
        self.speed_ratio = speed_ratio
        self.acceleration_ratio = acceleration_ratio
        self.robot_safe_height = robot_safe_height
        self.gripper_IO_pins = gripper_IO_pins or [22, 21]
        self._pose = [250.0, 0.0, robot_safe_height, 0.0]
        self._gripper_open = True
        self._connected = False
        self._alarm = False

    # --- connection -------------------------------------------------------
    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def _check(self) -> None:
        if not self._connected:
            raise ConnectionError("Not connected to robot. Call connect() first.")
        if self._alarm:
            raise RuntimeError("Alarm active -- clear_alarm() first.")

    # --- state ------------------------------------------------------------
    def _joints(self, x: float, y: float) -> tuple[float, float]:
        d = (x * x + y * y - self.L1**2 - self.L2**2) / (2 * self.L1 * self.L2)
        d = max(-1.0, min(1.0, d))
        j2 = math.degrees(math.acos(d))
        j1 = math.degrees(math.atan2(y, x) - math.atan2(self.L2 * math.sin(math.radians(j2)),
                                                        self.L1 + self.L2 * math.cos(math.radians(j2))))
        return j1, j2

    def get_position(self) -> tuple[float, ...]:
        self._check()
        x, y, z, r = self._pose
        j1, j2 = self._joints(x, y)
        return (x, y, z, r, j1, j2, z, r)

    def is_alarm_active(self) -> bool:
        return self._alarm

    def clear_alarm(self) -> None:
        self._alarm = False

    # --- motion -----------------------------------------------------------
    def _travel(self, target: list[float], lift: bool) -> None:
        x, y, z, r = target
        if math.hypot(x, y) > self.REACH or math.hypot(x, y) < 60 or not (self.Z_RANGE[0] <= z <= self.Z_RANGE[1]):
            self._alarm = True
            raise RuntimeError(f"Alarm detected during movement: ({x:.1f}, {y:.1f}, {z:.1f}) is outside the workspace.")
        distance = math.dist(self._pose[:3], target[:3])
        if lift:
            distance += 2 * max(self.robot_safe_height - min(self._pose[2], z), 0)
        _sleep(0.3 + distance / (4.0 * self.speed_ratio))  # ~200 mm/s at 50 %
        self._pose = [float(x), float(y), float(z), float(r)]

    def jump(self, x: float, y: float, z: float, r: float, is_queued: bool = True) -> None:
        """Lift to the safe height, travel, lower -- the move for anything carried.

        Args:
            x (float, [-400, 400]): X in mm.
            y (float, [-400, 400]): Y in mm.
            z (float, [0, 245]): Z in mm.
            r (float, [-180, 180]): End-effector rotation in deg.
            is_queued (bool): Queue on the controller (always true here).
        """
        self._check()
        self._travel([x, y, z, r], lift=True)

    def move_linear(self, x: float, y: float, z: float, r: float, is_queued: bool = True) -> None:
        """Move in a straight line.

        Args:
            x (float, [-400, 400]): X in mm.
            y (float, [-400, 400]): Y in mm.
            z (float, [0, 245]): Z in mm.
            r (float, [-180, 180]): End-effector rotation in deg.
            is_queued (bool): Queue on the controller (always true here).
        """
        self._check()
        self._travel([x, y, z, r], lift=False)

    def move_joint(self, x: float, y: float, z: float, r: float, is_queued: bool = True) -> None:
        self.move_linear(x, y, z, r)

    def jump_angle(self, j1: float, j2: float, j3: float, j4: float, is_queued: bool = True) -> None:
        """Jump to joint angles.

        Args:
            j1 (float, [-180, 180]): Joint 1 in deg.
            j2 (float, [-180, 180]): Joint 2 in deg.
            j3 (float, [0, 245]): Joint 3 (height) in mm.
            j4 (float, [-360, 360]): Joint 4 in deg.
            is_queued (bool): Queue on the controller (always true here).
        """
        self._check()
        a1, a12 = math.radians(j1), math.radians(j1 + j2)
        x = self.L1 * math.cos(a1) + self.L2 * math.cos(a12)
        y = self.L1 * math.sin(a1) + self.L2 * math.sin(a12)
        self._travel([x, y, j3, j4], lift=True)

    def gripper(self, is_open: bool, open_pin: int | None = None, close_pin: int | None = None) -> None:
        """Open or close the gripper.

        Args:
            is_open (bool): True opens, false closes.
            open_pin (int, [0, 23]): Digital output that opens it (default from setup).
            close_pin (int, [0, 23]): Digital output that closes it (default from setup).
        """
        self._check()
        _sleep(0.4)
        self._gripper_open = bool(is_open)


class PipetteError(Exception):
    """Same shape as a pipetting module's error: a numeric code and its meaning."""

    CODES: ClassVar[dict[int, str]] = {
        51: "Pipetting drive not initialized",
        53: "Maximum volume of the tip reached",
        55: "Volume check failed",
        75: "No tip present (no tip picked up)",
        76: "Tip already picked up",
    }

    def __init__(self, code: int):
        self.code = code
        super().__init__(f"PipetteError: {code} - {self.CODES.get(code, 'unknown error')}.")


class SimPipette(_Simulated):
    """An air-displacement pipetting module (Hamilton-ZEUS-like API).

    Volumes in 0.1 uL, z positions in 0.1 mm -- the integer units such modules speak.
    """

    TIP_CAPACITY = 3000  # 300 uL

    def __init__(self, ip: str = "sim", port: int = 0, **_ignored):
        self._initialized = False
        self._tip = False
        self._held = 0
        self._z = 0
        self.deck_geometry: dict = {}

    def connect(self) -> str:
        return "connected (simulated)"

    def disconnect(self) -> str:
        return "disconnected (simulated)"

    def initialize_dosing_drive(self) -> None:
        """Initialise the dosing drive (empties and drops any tip)."""
        _sleep(1.0)
        self._tip, self._held, self._initialized = False, 0, True

    def initialize_z_drive(self) -> None:
        """Move the z-drive to its origin."""
        _sleep(0.5)
        self._z = 0

    def set_deck_geometry_parameters(self, deck_geometry_index: int = 0, **params) -> None:
        self.deck_geometry[deck_geometry_index] = params

    def _ready(self) -> None:
        if not self._initialized:
            raise PipetteError(51)

    def move_z_drive(self, position: int = 0, speed: int = 1) -> None:
        """Move the z-drive.

        Args:
            position (int, [0, 2800]): Target height above the origin, 0.1 mm.
            speed (int, [0, 1]): 0 slow, 1 normal.
        """
        self._ready()
        _sleep(abs(position - self._z) / 1000)
        self._z = position

    def pick_up_tip(self, tip_type_index: int = 0, deck_geometry_index: int = 0) -> None:
        """Pick up a tip at the current position.

        Args:
            tip_type_index (int, [0, 15]): Tip type table index.
            deck_geometry_index (int, [0, 99]): Deck geometry table index.
        """
        self._ready()
        if self._tip:
            raise PipetteError(76)
        _sleep(1.5)
        self._tip = True

    def discard_tip(self, deck_geometry_index: int = 0) -> None:
        """Discard the tip at the current position.

        Args:
            deck_geometry_index (int, [0, 99]): Deck geometry table index.
        """
        self._ready()
        if not self._tip:
            raise PipetteError(75)
        _sleep(1.5)
        self._tip, self._held = False, 0

    def aspirate(self, aspiration_volume: int = 0, **params) -> int:
        """Aspirate at the current position.

        Args:
            aspiration_volume (int, [0, 3000]): Volume in 0.1 uL.
        """
        self._ready()
        if not self._tip:
            raise PipetteError(75)
        if self._held + aspiration_volume > self.TIP_CAPACITY:
            raise PipetteError(53)
        _sleep(1.0 + aspiration_volume / 1000)
        self._held += aspiration_volume
        return params.get("liquid_surface", 0)

    def dispense(self, dispensing_volume: int = 0, **params) -> int:
        """Dispense at the current position.

        Args:
            dispensing_volume (int, [0, 3000]): Volume in 0.1 uL.
        """
        self._ready()
        if not self._tip:
            raise PipetteError(75)
        if dispensing_volume > self._held:
            raise PipetteError(55)
        _sleep(1.0 + dispensing_volume / 1000)
        self._held -= dispensing_volume
        return params.get("liquid_surface", 0)

    def request_tip_presence_status(self) -> int:
        return int(self._tip)

    def request_volume_in_tip(self) -> int:
        """Simulator extra -- what's in the tip, 0.1 uL."""
        return self._held


class SimHotplate(_Simulated):
    """A heater-stirrer (IKA-like API): first-order approach to the setpoint while heating."""

    RATE = 0.08  # 1/s -- time constant ~12 s of simulated time

    def __init__(self, ip: str = "sim", port: int = 0, hotplate_number: int = 1, T_max: int = 300, **_ignored):
        self.hotplate_number = hotplate_number
        self.T_max = T_max
        self._ambient = 21.0
        self._t = self._ambient
        self._setpoint = self._ambient
        self._heating = False
        self._rpm_set = 0
        self._stirring = False
        self._stamp = time.monotonic()
        self._lock = threading.Lock()

    def _advance(self) -> None:
        now = time.monotonic()
        dt = (now - self._stamp) * SPEED
        self._stamp = now
        target = self._setpoint if self._heating else self._ambient
        self._t = target + (self._t - target) * math.exp(-self.RATE * dt)

    def get_device_name(self) -> str:
        return f"SIM-HOTPLATE-{self.hotplate_number}"

    def get_temperature(self) -> float:
        with self._lock:
            self._advance()
            return round(self._t, 2)

    def get_temperature_setpoint(self) -> float:
        return float(self._setpoint)

    def set_temperature_setpoint(self, T_SET: int) -> str:
        """Adjust the temperature setpoint.

        Args:
            T_SET (int, [0, 300]): Temperature setpoint [degC].
        """
        assert 0 <= T_SET <= self.T_max, f"Temperature setpoint must be between 0 and {self.T_max} °C."
        with self._lock:
            self._advance()
            self._setpoint = T_SET
        return f"T_SET = {T_SET} °C"

    def start_heating(self) -> str:
        """Start the heater."""
        with self._lock:
            self._advance()
            self._heating = True
        return "Heating ON"

    def stop_heating(self) -> str:
        """Stop the heater."""
        with self._lock:
            self._advance()
            self._heating = False
        return "Heating OFF"

    def set_stirring_speed_setpoint(self, stirSpeed_SET: int) -> str:
        """Adjust the stirring speed setpoint.

        Args:
            stirSpeed_SET (int, [0, 1500]): Stirring speed [rpm].
        """
        assert 0 <= stirSpeed_SET <= 1500, "Stirring speed setpoint must be between 0 and 1500 rpm."
        self._rpm_set = stirSpeed_SET
        return f"RPM_SET = {stirSpeed_SET} rpm"

    def start_stirring(self) -> str:
        """Start the stirrer motor."""
        self._stirring = True
        return "Stirrer motor START"

    def stop_stirring(self) -> str:
        """Stop the stirrer motor."""
        self._stirring = False
        return "Stirrer motor STOP"

    def get_stirring_speed(self) -> float:
        return float(self._rpm_set if self._stirring else 0)


class SimSpincoater(_Simulated):
    """A spin coater (stepper-drive-like API): set the profile, start, stop, home."""

    def __init__(self, **_ignored):
        self._speed = 0.0
        self._target = 1000
        self._acceleration = 300
        self._lid_homed = True

    def define_homing_parameter(self) -> None:
        pass

    def move_to_home_position(self) -> None:
        _sleep(0.5)
        self._lid_homed = True

    def set_spinning_parameter(self, speed: int = 1000, acceleration: int = 300) -> None:
        """Set the spin profile.

        Args:
            speed (int, [1, 10000]): Target speed [rpm].
            acceleration (int, [1, 10000]): Ramp [rpm/s].
        """
        if not 0 < speed <= 10000:
            raise ValueError("Spin speed must be 1-10000 rpm.")
        if not 0 < acceleration <= 10000:
            raise ValueError("Acceleration must be 1-10000 rpm/s.")
        self._target, self._acceleration = speed, acceleration

    def start_spinning(self) -> None:
        """Ramp up to the set speed."""
        _sleep(self._target / self._acceleration)
        self._speed = float(self._target)
        self._lid_homed = False

    def stop_spinning(self) -> None:
        """Ramp down to standstill."""
        _sleep(self._speed / self._acceleration)
        self._speed = 0.0

    def get_speed(self) -> float:
        return self._speed
