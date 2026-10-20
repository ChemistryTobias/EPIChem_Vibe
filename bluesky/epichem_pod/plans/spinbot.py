"""Spinbot, high level: the operations a scientist thinks in -- move a
substrate, take up a solution, coat, anneal -- each composed from the
low-level device actions, so the RunEngine can pause between any two moves
and every move is on record.

Names and parameters follow the station's existing SDL layer
(`move_home`, `pickup_and_deliver`, `pickup_tip`, `aspirate_liquid`, ...), so
a procedure written against that API reads the same here.
"""

import bluesky.plan_stubs as bps
import bluesky.preprocessors as bpp
from bluesky_queueserver import parameter_annotation_decorator

from epichem_pod.devices.lab import do
from epichem_pod.devices.station import Station


def build(station: Station) -> dict:
    arm = station.devices[station.of_type("arm")[0]]
    pipette = station.devices[station.of_type("pipette")[0]]
    spincoater = station.devices[station.of_type("spincoater")[0]]
    hotplates = {int(station.devices[n].options.get("number", i + 1)): station.devices[n]
                 for i, n in enumerate(station.of_type("hotplate"))}
    pip = station.settings.get("pipette", {})
    per_carrier = int(station.settings.get("carriers", {}).get("slots_per_carrier", 8))
    safe_z = station.point("safe_home_pos", "position")[2]
    handling = {"HandlingStations": station.groups("cartesian")}

    # --- building blocks (not plans themselves: no annotations, not exported) ---
    def _carry(start: list[float], end: list[float]):
        """Grip at `start`, carry to `end`, release, retract to the safe height."""
        yield from do(arm.gripper, True)
        yield from do(arm.jump, tuple(start))
        yield from do(arm.gripper, False)
        yield from do(arm.jump, tuple(end))
        yield from do(arm.gripper, True)
        yield from do(arm.retract, safe_z)

    def _hotplate(number: int):
        if number not in hotplates:
            raise ValueError(f"Hotplate number must be one of {sorted(hotplates)}; got {number}.")
        return hotplates[number]

    def _vial_geometry(vial_no: int) -> int:
        for geometry, vials in (pip.get("vial_geometry") or {}).items():
            if vial_no in vials:
                return int(geometry)
        raise ValueError(f"Vial {vial_no} isn't in the station's vial map.")

    def _wait(seconds: float, device):
        yield from bps.sleep(seconds * device.time_scale)

    # --- arm ----------------------------------------------------------------
    @parameter_annotation_decorator({"description": "Move the arm to its safe home position."})
    def move_home():
        """Move the arm to its safe home position."""
        yield from do(arm.jump, tuple(station.point("safe_home_pos", "position")))

    @parameter_annotation_decorator({
        "description": "Pick up a substrate/holder/carrier at one position and deliver it to another.",
        "parameters": {
            "start_station": {"annotation": "HandlingStations", "enums": handling, "description": "Where to pick up."},
            "start_pos": {"description": "Slot there: a number, or e.g. carrier_pickup / position."},
            "end_station": {"annotation": "HandlingStations", "enums": handling, "description": "Where to deliver."},
            "end_pos": {"description": "Slot there."},
        },
    })
    def pickup_and_deliver(start_station: str, start_pos: str, end_station: str, end_pos: str):
        """Pick up and deliver."""
        yield from _carry(station.point(start_station, start_pos), station.point(end_station, end_pos))

    @parameter_annotation_decorator({
        "description": "Every 8th sample (1, 9, 17, ...), move a fresh carrier from the start stack to the processing rack.",
        "parameters": {
            "sample_no": {"description": "Running sample number.", "min": 1, "max": 10000},
            "total_carrier_no": {"description": "Carriers stacked in the start rack at the beginning.", "min": 1, "max": 50},
            "carrier_thickness": {"description": "Carrier thickness in mm (stack height step).", "min": 0, "max": 50},
        },
    })
    def add_carrier_to_process_rack(sample_no: int, total_carrier_no: int = 8, carrier_thickness: float = 4.0):
        """Add a carrier when a new batch starts."""
        if (sample_no - 1) % per_carrier != 0:
            return
        index = total_carrier_no - ((sample_no - 1) // per_carrier + 1)
        start = station.point("start_rack", "carrier_pickup")
        start[2] += index * carrier_thickness
        yield from _carry(start, station.point("processing_rack", "carrier_pickup"))

    @parameter_annotation_decorator({
        "description": "Every 8th sample (8, 16, ...), move the full carrier to the finished stack.",
        "parameters": {
            "sample_no": {"description": "Running sample number.", "min": 1, "max": 10000},
            "carrier_thickness": {"description": "Carrier thickness in mm (stack height step).", "min": 0, "max": 50},
        },
    })
    def remove_carrier_from_process_rack(sample_no: int, carrier_thickness: float = 4.0):
        """Remove a carrier when its batch is done."""
        if sample_no % per_carrier != 0:
            return
        end = station.point("finished_rack", "carrier_pickup")
        end[2] += (sample_no // per_carrier - 1) * carrier_thickness
        yield from _carry(station.point("processing_rack", "carrier_pickup"), end)

    # --- pipette ------------------------------------------------------------
    @parameter_annotation_decorator({"description": "Re-initialise the pipette (empties and drops any tip)."})
    def reinit_pipette():
        """Re-initialise the pipette."""
        yield from do(pipette.initialize, None)

    @parameter_annotation_decorator({
        "description": "Pick up a new pipette tip from a tip rack.",
        "parameters": {
            "rack_no": {"description": "Tip rack.", "min": 1, "max": 2},
            "tip_pos": {"description": "Unused tip position in the rack.", "min": 1, "max": 96},
        },
    })
    def pickup_tip(rack_no: int, tip_pos: int):
        """Pick up a tip."""
        yield from do(arm.jump_angle, tuple(station.point(f"pipette_rack_{rack_no}", tip_pos)))
        yield from do(pipette.pick_up_tip, {"tip_type_index": pip.get("tip_type_index", 0),
                                                "deck_geometry_index": pip.get("deck_geometry_index", 0)})

    @parameter_annotation_decorator({
        "description": "Aspirate a volume from a vial in the liquid handler.",
        "parameters": {
            "vial_no": {"description": "Vial number.", "min": 1, "max": 22},
            "volume_uL": {"description": "Volume in uL (0.1 uL steps).", "min": 0.1, "max": 300, "step": 0.1},
        },
    })
    def aspirate_liquid(vial_no: int, volume_uL: float):
        """Aspirate from a vial."""
        params = dict(pip.get("aspiration", {}))
        yield from do(arm.jump_angle, tuple(station.point("liquid_handler_pipettePos", vial_no)))
        yield from do(pipette.aspirate, {"volume_ul": volume_uL, "container_geometry_index": _vial_geometry(vial_no),
                                             "deck_geometry_index": pip.get("deck_geometry_index", 0), **params})
        yield from do(arm.retract, safe_z)

    @parameter_annotation_decorator({
        "description": "Dispense the aspirated liquid onto the substrate on the spin coater.",
        "parameters": {
            "volume_uL": {"description": "Volume in uL (0.1 uL steps).", "min": 0.1, "max": 300, "step": 0.1},
            "dispensing_height_above_substrate": {"description": "Drop-casting height in mm.", "min": 0, "max": 50},
        },
    })
    def dispense_liquid(volume_uL: float, dispensing_height_above_substrate: float = 5.0):
        """Dispense onto the substrate."""
        j1, j2, j3, j4 = station.point("spincoater_pipettePos", "dispense_location")
        yield from do(arm.jump_angle, (j1, j2, j3 + dispensing_height_above_substrate, j4))
        yield from do(pipette.dispense, {"volume_ul": volume_uL,
                                             "deck_geometry_index": pip.get("deck_geometry_index", 0),
                                             **pip.get("dispensing", {})})
        yield from do(arm.retract, safe_z)

    @parameter_annotation_decorator({"description": "Discard the pipette tip -- the last step of any liquid handling."})
    def discard_pipette_tip():
        """Discard the tip."""
        yield from do(arm.jump_angle, tuple(station.point("pipette_disposal", "position")))
        yield from do(pipette.discard_tip, {"deck_geometry_index": pip.get("deck_geometry_index", 0)})

    # --- hotplates, spin coater -----------------------------------------------
    @parameter_annotation_decorator({
        "description": "Start heating a hotplate.",
        "parameters": {
            "hotplate_no": {"description": "Hotplate number.", "min": 1, "max": max(hotplates, default=1)},
            "T_set_celsius": {"description": "Setpoint in degC.", "min": 0, "max": 300},
            "wait_until_T_set": {"description": "Wait until the setpoint is reached."},
        },
    })
    def start_heating(hotplate_no: int, T_set_celsius: float, wait_until_T_set: bool = True):
        """Start heating."""
        plate = _hotplate(hotplate_no)
        yield from do(plate if wait_until_T_set else plate.heat, T_set_celsius)

    @parameter_annotation_decorator({
        "description": "Stop heating a hotplate.",
        "parameters": {"hotplate_no": {"description": "Hotplate number.", "min": 1, "max": max(hotplates, default=1)}},
    })
    def stop_heating(hotplate_no: int):
        """Stop heating."""
        yield from do(_hotplate(hotplate_no).off, None)

    @parameter_annotation_decorator({
        "description": "Spin the substrate on the spin coater.",
        "parameters": {
            "speed_rpm": {"description": "Spin speed in rpm.", "min": 100, "max": 10000},
            "acceleration": {"description": "Ramp in rpm/s.", "min": 10, "max": 10000},
            "duration_s": {"description": "Hold time at speed, s.", "min": 1, "max": 3600},
        },
    })
    def spin(speed_rpm: float, acceleration: float = 1000, duration_s: float = 30):
        """Spin."""
        yield from do(spincoater.spin, (speed_rpm, acceleration, duration_s))

    # --- the whole thing ----------------------------------------------------
    @parameter_annotation_decorator({
        "description": "Coat one sample end to end: substrate to the coater, drop-cast, spin, anneal, back to its slot.",
        "parameters": {
            "sample_no": {"description": "Running sample number (decides carrier changes and its slot).", "min": 1, "max": 10000},
            "vial_no": {"description": "Vial holding the solution.", "min": 1, "max": 22},
            "volume_uL": {"description": "Volume to drop-cast in uL.", "min": 0.1, "max": 300, "step": 0.1},
            "speed_rpm": {"description": "Spin speed in rpm.", "min": 100, "max": 10000},
            "duration_s": {"description": "Spin time, s.", "min": 1, "max": 3600},
            "anneal_T_celsius": {"description": "Anneal temperature in degC.", "min": 20, "max": 300},
            "anneal_time_s": {"description": "Anneal time, s.", "min": 0, "max": 86400},
            "hotplate_no": {"description": "Hotplate to anneal on.", "min": 1, "max": max(hotplates, default=1)},
            "tip_rack": {"description": "Tip rack to take a tip from.", "min": 1, "max": 2},
            "tip_pos": {"description": "Tip position.", "min": 1, "max": 96},
        },
    })
    def coat_sample(sample_no: int, vial_no: int, volume_uL: float, speed_rpm: float = 2000, duration_s: float = 30,
                    anneal_T_celsius: float = 100, anneal_time_s: float = 600, hotplate_no: int = 1,
                    tip_rack: int = 1, tip_pos: int = 1, md: dict | None = None):
        """Coat one sample end to end, recording it as one bluesky run."""
        slot = (sample_no - 1) % per_carrier + 1
        plate = _hotplate(hotplate_no)
        readings = [plate, spincoater, arm, pipette]
        run_md = {"plan_name": "coat_sample", "sample_no": sample_no, "vial_no": vial_no, "volume_uL": volume_uL,
                  "speed_rpm": speed_rpm, "anneal_T_celsius": anneal_T_celsius, **(md or {})}

        @bpp.run_decorator(md=run_md)
        def inner():
            yield from do(plate.heat, anneal_T_celsius)  # warm up while coating
            yield from add_carrier_to_process_rack(sample_no)
            yield from _carry(station.point("processing_rack", slot), station.point("spincoater", "position"))
            yield from pickup_tip(tip_rack, tip_pos)
            yield from aspirate_liquid(vial_no, volume_uL)
            yield from dispense_liquid(volume_uL)
            yield from discard_pipette_tip()
            yield from spin(speed_rpm, 1000, duration_s)
            yield from bps.trigger_and_read(readings, name="coated")
            yield from do(plate, anneal_T_celsius)
            yield from _carry(station.point("spincoater", "position"), station.point("hotplate", slot))
            yield from _wait(anneal_time_s, plate)
            yield from bps.trigger_and_read(readings, name="annealed")
            yield from _carry(station.point("hotplate", slot), station.point("processing_rack", slot))
            yield from remove_carrier_from_process_rack(sample_no)
            yield from move_home()

        yield from inner()

    return {
        f.__name__: f
        for f in (
            move_home, pickup_and_deliver, add_carrier_to_process_rack, remove_carrier_from_process_rack,
            reinit_pipette, pickup_tip, aspirate_liquid, dispense_liquid, discard_pipette_tip,
            start_heating, stop_heating, spin, coat_sample,
        )
    }
