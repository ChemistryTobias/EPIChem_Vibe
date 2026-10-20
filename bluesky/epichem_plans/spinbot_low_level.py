"""Spinbot, low level: one plan per device action -- arm moves, gripper,
pipette, hotplates, spin coater. For building new operations and for
debugging; scientists mostly want `epichem_plans.spinbot`."""

import bluesky.plans as bp
from bluesky_queueserver import parameter_annotation_decorator

from epichem_devices.lab import do
from epichem_devices.station import Station


def build(station: Station) -> dict:
    arms = {"Arms": station.of_type("arm")}
    pipettes = {"Pipettes": station.of_type("pipette")}
    hotplates = {"Hotplates": station.of_type("hotplate")}
    spincoaters = {"SpinCoaters": station.of_type("spincoater")}
    groups = {"PositionGroups": sorted(station.positions)}
    xyz = {
        "x": {"description": "X in mm.", "min": -400, "max": 400},
        "y": {"description": "Y in mm.", "min": -400, "max": 400},
        "z": {"description": "Z (height) in mm.", "min": 0, "max": 250},
        "r": {"description": "End-effector rotation in deg.", "min": -180, "max": 180},
    }

    def arm_param(description="Arm to move."):
        return {"annotation": "Arms", "devices": arms, "description": description}

    @parameter_annotation_decorator({"description": "Jump: lift to the safe height, travel, lower to (x, y, z, r).",
                                     "parameters": {"arm": arm_param(), **xyz}})
    def arm_jump(arm, x: float, y: float, z: float, r: float = 0.0):
        """Jump to a cartesian point."""
        yield from do(arm.jump, (x, y, z, r))

    @parameter_annotation_decorator({"description": "Move in a straight line to (x, y, z, r).",
                                     "parameters": {"arm": arm_param(), **xyz}})
    def arm_move_linear(arm, x: float, y: float, z: float, r: float = 0.0):
        """Straight-line move."""
        yield from do(arm.move_linear, (x, y, z, r))

    @parameter_annotation_decorator({
        "description": "Jump to joint angles (j3 is the vertical axis, in mm).",
        "parameters": {
            "arm": arm_param(),
            "j1": {"description": "Joint 1 in deg.", "min": -180, "max": 180},
            "j2": {"description": "Joint 2 in deg.", "min": -180, "max": 180},
            "j3": {"description": "Joint 3 (height) in mm.", "min": 0, "max": 250},
            "j4": {"description": "Joint 4 in deg.", "min": -360, "max": 360},
        },
    })
    def arm_jump_angle(arm, j1: float, j2: float, j3: float, j4: float = 0.0):
        """Joint-space jump."""
        yield from do(arm.jump_angle, (j1, j2, j3, j4))

    @parameter_annotation_decorator({
        "description": "Jump to a taught position from the station config.",
        "parameters": {
            "arm": arm_param(),
            "group": {"annotation": "PositionGroups", "enums": groups, "description": "Position group, e.g. hotplate."},
            "slot": {"description": "Slot in the group: a number or a name like carrier_pickup."},
        },
    })
    def arm_go_to(arm, group: str, slot: str = "position"):
        """Go to a taught position."""
        point = station.point(group, slot)
        action = arm.jump_angle if station.space(group) == "joint" else arm.jump
        yield from do(action, tuple(point))

    @parameter_annotation_decorator({"description": "Open the gripper.", "parameters": {"arm": arm_param("Arm whose gripper to open.")}})
    def gripper_open(arm):
        """Open the gripper."""
        yield from do(arm.gripper, True)

    @parameter_annotation_decorator({"description": "Close the gripper.", "parameters": {"arm": arm_param("Arm whose gripper to close.")}})
    def gripper_close(arm):
        """Close the gripper."""
        yield from do(arm.gripper, False)

    def pipette_param():
        return {"annotation": "Pipettes", "devices": pipettes, "description": "Pipetting module."}

    @parameter_annotation_decorator({"description": "Initialise the dosing and z drives (empties and drops any tip).",
                                     "parameters": {"pipette": pipette_param()}})
    def pipette_initialize(pipette):
        """Initialise the pipette."""
        yield from do(pipette.initialize, None)

    @parameter_annotation_decorator({
        "description": "Pick up a tip where the arm currently holds the pipette.",
        "parameters": {
            "pipette": pipette_param(),
            "tip_type_index": {"description": "Tip type table index.", "min": 0, "max": 15},
            "deck_geometry_index": {"description": "Deck geometry table index.", "min": 0, "max": 99},
        },
    })
    def pipette_pick_up_tip(pipette, tip_type_index: int = 4, deck_geometry_index: int = 0):
        """Pick up a tip."""
        yield from do(pipette.pick_up_tip, {"tip_type_index": tip_type_index, "deck_geometry_index": deck_geometry_index})

    liquid = {
        "pipette": pipette_param(),
        "volume_ul": {"description": "Volume in uL.", "min": 0.1, "max": 300, "step": 0.1},
        "container_geometry_index": {"description": "Container geometry table index.", "min": 0, "max": 99},
        "liquid_class_index": {"description": "Liquid class table index.", "min": 0, "max": 99},
        "liquid_surface": {"description": "Fixed liquid surface (no LLD), 0.1 mm.", "min": 0, "max": 2800},
    }

    @parameter_annotation_decorator({"description": "Aspirate at the current position.", "parameters": {
        **liquid,
        "lld_enabled": {"description": "Use liquid-level detection."},
        "lld_search_position": {"description": "LLD search start, 0.1 mm.", "min": 0, "max": 2800},
    }})
    def pipette_aspirate(pipette, volume_ul: float, container_geometry_index: int = 1, liquid_class_index: int = 0,
                         lld_enabled: bool = True, lld_search_position: int = 1200, liquid_surface: int = 0):
        """Aspirate."""
        yield from do(pipette.aspirate, {
            "volume_ul": volume_ul, "container_geometry_index": container_geometry_index,
            "liquid_class_index": liquid_class_index, "lld_enabled": int(lld_enabled),
            "lld_search_position": lld_search_position, "liquid_surface": liquid_surface,
        })

    @parameter_annotation_decorator({"description": "Dispense at the current position.", "parameters": liquid})
    def pipette_dispense(pipette, volume_ul: float, container_geometry_index: int = 4, liquid_class_index: int = 0,
                         liquid_surface: int = 900):
        """Dispense."""
        yield from do(pipette.dispense, {
            "volume_ul": volume_ul, "container_geometry_index": container_geometry_index,
            "liquid_class_index": liquid_class_index, "liquid_surface": liquid_surface,
        })

    @parameter_annotation_decorator({"description": "Discard the tip at the current position.", "parameters": {
        "pipette": pipette_param(),
        "deck_geometry_index": {"description": "Deck geometry table index.", "min": 0, "max": 99},
    }})
    def pipette_discard_tip(pipette, deck_geometry_index: int = 0):
        """Discard the tip."""
        yield from do(pipette.discard_tip, {"deck_geometry_index": deck_geometry_index})

    def hotplate_param():
        return {"annotation": "Hotplates", "devices": hotplates, "description": "Hotplate."}

    @parameter_annotation_decorator({"description": "Set a hotplate's temperature, optionally waiting until it's there.", "parameters": {
        "hotplate": hotplate_param(),
        "setpoint_c": {"description": "Setpoint in degC.", "min": 0, "max": 300},
        "wait": {"description": "Wait until within tolerance."},
    }})
    def hotplate_set_temperature(hotplate, setpoint_c: float, wait: bool = True):
        """Set temperature."""
        if wait:
            yield from do(hotplate, setpoint_c)
        else:
            yield from do(hotplate.heat, setpoint_c)

    @parameter_annotation_decorator({"description": "Switch a hotplate's heater off.", "parameters": {"hotplate": hotplate_param()}})
    def hotplate_off(hotplate):
        """Heater off."""
        yield from do(hotplate.off, None)

    @parameter_annotation_decorator({"description": "Set a hotplate's stirring speed (0 stops it).", "parameters": {
        "hotplate": hotplate_param(),
        "rpm": {"description": "Stirring speed in rpm.", "min": 0, "max": 1500},
    }})
    def hotplate_stir(hotplate, rpm: float):
        """Stir."""
        yield from do(hotplate.stir, rpm)

    @parameter_annotation_decorator({"description": "Run one spin profile: ramp up, hold, stop.", "parameters": {
        "spincoater": {"annotation": "SpinCoaters", "devices": spincoaters, "description": "Spin coater."},
        "speed_rpm": {"description": "Spin speed in rpm.", "min": 100, "max": 10000},
        "acceleration": {"description": "Ramp in rpm/s.", "min": 10, "max": 10000},
        "duration_s": {"description": "Hold time at speed, s.", "min": 1, "max": 3600},
    }})
    def spincoater_spin(spincoater, speed_rpm: float, acceleration: float = 1000, duration_s: float = 30):
        """Spin."""
        yield from do(spincoater.spin, (speed_rpm, acceleration, duration_s))

    @parameter_annotation_decorator({"description": "Record every device's current state as one run (a snapshot).",
                                     "parameters": {"num": {"description": "Number of readings.", "min": 1, "max": 100}}})
    def station_snapshot(num: int = 1, md: dict | None = None):
        """Snapshot the station."""
        yield from bp.count(list(station.devices.values()), num=num, md=md)

    return {
        f.__name__: f
        for f in (
            arm_jump, arm_move_linear, arm_jump_angle, arm_go_to, gripper_open, gripper_close,
            pipette_initialize, pipette_pick_up_tip, pipette_aspirate, pipette_dispense, pipette_discard_tip,
            hotplate_set_temperature, hotplate_off, hotplate_stir, spincoater_spin, station_snapshot,
        )
    }
