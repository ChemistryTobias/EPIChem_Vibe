/**
 * Geometry is the part of the isometric view that's easy to get subtly
 * wrong and impossible to eyeball — a half-tile offset looks plausible
 * until you drag something. These test plan §10.3's formulas directly.
 */

import { describe, expect, test } from "vitest";

import type { Bench, Device, Station } from "../../api/types";
import {
  DEFAULT_METRICS,
  benchCells,
  benchExtent,
  depth,
  placeStations,
  placementProblems,
  toGrid,
  toScreen,
} from "./isometric";

const ORIGIN = { x: 0, y: 0 };

describe("toScreen", () => {
  test("puts the origin cell at the origin", () => {
    expect(toScreen({ col: 0, row: 0 }, ORIGIN)).toEqual({ x: 0, y: 0 });
  });

  test("moves right and down along the column axis", () => {
    expect(toScreen({ col: 1, row: 0 }, ORIGIN)).toEqual({ x: 50, y: 29 });
  });

  test("moves left and down along the row axis", () => {
    expect(toScreen({ col: 0, row: 1 }, ORIGIN)).toEqual({ x: -50, y: 29 });
  });

  test("raises a stacked tile without moving it sideways", () => {
    const flat = toScreen({ col: 2, row: 1 }, ORIGIN);
    const raised = toScreen({ col: 2, row: 1 }, ORIGIN, DEFAULT_METRICS, 2);

    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 2 * DEFAULT_METRICS.stackUnit);
  });
});

describe("toGrid", () => {
  test("inverts toScreen exactly for every cell of a grid", () => {
    for (const cell of benchCells(6, 4)) {
      expect(toGrid(toScreen(cell, ORIGIN), ORIGIN)).toEqual(cell);
    }
  });

  test("inverts toScreen for raised tiles too", () => {
    const cell = { col: 3, row: 2 };
    const screen = toScreen(cell, ORIGIN, DEFAULT_METRICS, 3);

    expect(toGrid(screen, ORIGIN, DEFAULT_METRICS, 3)).toEqual(cell);
  });

  test("snaps a near-miss drop to the nearest cell", () => {
    const exact = toScreen({ col: 2, row: 1 }, ORIGIN);

    expect(toGrid({ x: exact.x + 8, y: exact.y - 5 }, ORIGIN)).toEqual({ col: 2, row: 1 });
  });

  test("respects a non-zero origin", () => {
    const origin = { x: 400, y: 120 };

    expect(toGrid(toScreen({ col: 4, row: 3 }, origin), origin)).toEqual({ col: 4, row: 3 });
  });
});

describe("depth", () => {
  test("orders back-to-front so nearer tiles paint last", () => {
    const cells = [
      { col: 2, row: 2 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ];

    expect([...cells].sort((a, b) => depth(a) - depth(b))[0]).toEqual({ col: 0, row: 0 });
  });
});

describe("benchExtent", () => {
  test("is wide enough for both diagonals", () => {
    const { width, height } = benchExtent(4, 3);

    expect(width).toBe((4 + 3) * 50);
    expect(height).toBe((4 + 3) * 29);
  });

  test("places the origin so the leftmost tile is not clipped", () => {
    const { origin } = benchExtent(4, 3);
    const leftmost = toScreen({ col: 0, row: 2 }, origin);

    expect(leftmost.x).toBeGreaterThanOrEqual(0);
  });
});

describe("benchCells", () => {
  test("covers the whole grid exactly once", () => {
    const cells = benchCells(3, 2);

    expect(cells).toHaveLength(6);
    expect(new Set(cells.map((c) => `${c.col},${c.row}`)).size).toBe(6);
  });

  test("comes back in paint order", () => {
    const depths = benchCells(3, 3).map(depth);

    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });
});

// --- placement ------------------------------------------------------------

const bench: Bench = {
  id: "b1",
  code: "BENCH-1",
  name: "Bench 1",
  workcell_id: "w1",
  grid_cols: 4,
  grid_rows: 3,
  height_mm: null,
};

function station(code: string, col: number, row: number, bench_id = "b1"): Station {
  return {
    id: `st-${code}`,
    code,
    name: `Station ${code}`,
    bench_id,
    kind: "generic",
    grid_col: col,
    grid_row: row,
    stack_height: 1,
    capacity: 1,
    accepted_labware_types: [],
  };
}

function device(code: string, station_code: string | null): Device {
  return {
    id: `d-${code}`,
    code,
    name: `Device ${code}`,
    labels: {},
    parent_id: null,
    capability_class_ref: null,
    capability_class_id: null,
    capabilities: [],
    ophyd_import: null,
    ophyd_args: {},
    transport_protocol: null,
    transport_uri: null,
    transport_ioc_host: null,
    transport_quality: "nominal",
    network_netbox_device_id: null,
    network_primary_ip: null,
    network_mac: null,
    network_vlan: null,
    pose_x_mm: null,
    pose_y_mm: null,
    pose_z_mm: null,
    pose_yaw_deg: null,
    envelope: {},
    safety_flags: [],
    safety_interlocks: [],
    safety_max_unattended_minutes: null,
    operational_mode: "read_write",
    operational_calibration: null,
    station_code,
  };
}

describe("placeStations", () => {
  test("keeps only this bench's stations", () => {
    const placed = placeStations(
      [station("A", 0, 0), station("B", 1, 0, "other-bench")],
      [],
      bench,
    );

    expect(placed.map((p) => p.station.code)).toEqual(["A"]);
  });

  test("pairs a device with its station by station_code", () => {
    const placed = placeStations([station("A", 0, 0)], [device("DEV-1", "A")], bench);

    expect(placed[0].device?.code).toBe("DEV-1");
  });

  test("leaves an unbound station without a device", () => {
    const placed = placeStations([station("A", 0, 0)], [device("DEV-1", null)], bench);

    expect(placed[0].device).toBeNull();
  });

  test("returns stations back-to-front", () => {
    const placed = placeStations(
      [station("far", 2, 2), station("near", 0, 0), station("mid", 1, 0)],
      [],
      bench,
    );

    expect(placed.map((p) => p.station.code)).toEqual(["near", "mid", "far"]);
  });
});

describe("placementProblems", () => {
  test("says nothing about a well-formed layout", () => {
    const placed = placeStations([station("A", 0, 0), station("B", 1, 1)], [], bench);

    expect(placementProblems(placed, bench)).toEqual([]);
  });

  test("flags a station outside the bench grid", () => {
    const placed = placeStations([station("A", 9, 0)], [], bench);

    expect(placementProblems(placed, bench)[0]).toMatchObject({ code: "A" });
    expect(placementProblems(placed, bench)[0].reason).toContain("outside");
  });

  test("flags a negative coordinate", () => {
    const placed = placeStations([station("A", -1, 0)], [], bench);

    expect(placementProblems(placed, bench)).toHaveLength(1);
  });

  test("flags two stations sharing a cell", () => {
    const placed = placeStations([station("A", 1, 1), station("B", 1, 1)], [], bench);

    const problems = placementProblems(placed, bench);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain("shares cell");
  });
});
