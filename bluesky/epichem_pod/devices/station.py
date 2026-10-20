"""Load a station config (YAML) into drivers, ophyd devices and named positions.

    devices:            # name -> wrapper type + driver (sim or real) + options
    positions:          # named teach points, grouped by place
    settings:           # anything the station's plans need (pipette defaults...)

Positions are grouped (`processing_rack`, `hotplate`, ...) and keyed by slot
(`1`, `2`, ... or a name like `carrier_pickup`); a value is `[x, y, z, r]`, or
`[j1, j2, j3, j4]` in a group marked `space: joint`. Racks can be written as a
grid instead of listing every slot:

    hotplate:
      grid: {first: [300, -150, 55, 0], step: [0, 18, 0, 0], count: 8}
    pipette_rack_1:
      space: joint
      grid: {first: [40, 30, 110, 0], row_step: [1.5, 0, 0, 0],
             col_step: [0, 1.5, 0, 0], rows: 8, cols: 12}     # slots 1..96, row-major

Named points like these are what EPIChem's `GeometryDescriptor.internal_positions`
is for -- the long-term home for teach points is the station's own record.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from epichem_pod.drivers.load import build_driver

from .lab import DEVICE_TYPES


def _expand_grid(grid: dict[str, Any]) -> dict[int, list[float]]:
    first = grid["first"]
    start = int(grid.get("start", 1))
    slots: dict[int, list[float]] = {}
    if "count" in grid:
        step = grid["step"]
        for i in range(int(grid["count"])):
            slots[start + i] = [round(a + i * d, 4) for a, d in zip(first, step)]
    else:
        rows, cols = int(grid["rows"]), int(grid["cols"])
        for row in range(rows):
            for col in range(cols):
                slots[start + row * cols + col] = [
                    round(a + row * dr + col * dc, 4) for a, dr, dc in zip(first, grid["row_step"], grid["col_step"])
                ]
    return slots


def _expand_positions(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for group, entries in (raw or {}).items():
        if isinstance(entries, list):  # a single point, e.g. safe_home_pos
            groups[group] = {"space": "cartesian", "slots": {"position": entries}}
            continue
        entries = dict(entries)
        space = entries.pop("space", "cartesian")
        slots: dict[Any, list[float]] = {}
        if "grid" in entries:
            slots.update(_expand_grid(entries.pop("grid")))
        for key, value in entries.items():
            slots[int(key) if str(key).isdigit() else str(key)] = value
        groups[group] = {"space": space, "slots": slots}
    return groups


@dataclass
class Station:
    name: str
    devices: dict[str, Any]
    positions: dict[str, dict[str, Any]]
    settings: dict[str, Any] = field(default_factory=dict)

    def of_type(self, kind: str) -> list[str]:
        return [n for n, d in self.devices.items() if type(d) is DEVICE_TYPES[kind]]

    def groups(self, space: str) -> list[str]:
        return [g for g, v in self.positions.items() if v["space"] == space]

    def point(self, group: str, slot: Any) -> list[float]:
        """A teach point, by group and slot ('3' and 3 are the same slot)."""
        key = int(slot) if str(slot).isdigit() else slot
        try:
            return list(self.positions[group]["slots"][key])
        except KeyError:
            available = ", ".join(map(str, self.positions.get(group, {}).get("slots", {}))) or "none"
            raise KeyError(f"No position '{slot}' in '{group}' (available: {available}).") from None

    def space(self, group: str) -> str:
        return self.positions[group]["space"]


def load_station(path: str | Path) -> Station:
    config = yaml.safe_load(Path(path).read_text())
    devices = {}
    for name, spec in config["devices"].items():
        wrapper = DEVICE_TYPES[spec["type"]]
        devices[name] = wrapper(name=name, driver=build_driver(spec), options=spec.get("options"))
    return Station(
        name=config.get("station", Path(path).parent.name),
        devices=devices,
        positions=_expand_positions(config.get("positions")),
        settings=config.get("settings") or {},
    )
