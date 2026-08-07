/**
 * Geometry is the part of the isometric view that's easy to get subtly
 * wrong and impossible to eyeball — a half-metre offset looks plausible
 * until you drag something. These test plan §10.3 / ADR 0010's formulas
 * directly, in metres.
 */

import { describe, expect, test } from "vitest";

import type { Device, Lab, Station } from "../../api/types";
import {
  DEFAULT_METRICS,
  canvasExtent,
  depth,
  placeStations,
  placementProblems,
  snap,
  toFloor,
  toScreen,
} from "./isometric";

const ORIGIN = { x: 0, y: 0 };
const M = DEFAULT_METRICS;

describe("toScreen", () => {
  test("puts the origin at the origin", () => {
    expect(toScreen({ x: 0, y: 0 }, ORIGIN)).toEqual({ x: 0, y: 0 });
  });

  test("moves right and down along the x axis", () => {
    expect(toScreen({ x: 1, y: 0 }, ORIGIN)).toEqual({ x: M.mHalfW, y: M.mHalfH });
  });

  test("moves left and down along the y axis", () => {
    expect(toScreen({ x: 0, y: 1 }, ORIGIN)).toEqual({ x: -M.mHalfW, y: M.mHalfH });
  });

  test("raises a box without moving it sideways", () => {
    const flat = toScreen({ x: 2, y: 1 }, ORIGIN);
    const raised = toScreen({ x: 2, y: 1 }, ORIGIN, M, 1.5);

    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 1.5 * M.heightUnit);
  });
});

describe("toFloor", () => {
  test("inverts toScreen exactly", () => {
    for (const pos of [{ x: 0, y: 0 }, { x: 3, y: 2 }, { x: 1.5, y: 0.5 }]) {
      const back = toFloor(toScreen(pos, ORIGIN), ORIGIN);
      expect(back.x).toBeCloseTo(pos.x, 9);
      expect(back.y).toBeCloseTo(pos.y, 9);
    }
  });

  test("inverts toScreen for raised points too", () => {
    const pos = { x: 3, y: 2 };
    const back = toFloor(toScreen(pos, ORIGIN, M, 1.1), ORIGIN, M, 1.1);
    expect(back.x).toBeCloseTo(pos.x, 9);
    expect(back.y).toBeCloseTo(pos.y, 9);
  });

  test("respects a non-zero origin", () => {
    const origin = { x: 400, y: 120 };
    const back = toFloor(toScreen({ x: 4, y: 3 }, origin), origin);
    expect(back.x).toBeCloseTo(4, 9);
    expect(back.y).toBeCloseTo(3, 9);
  });
});

describe("snap", () => {
  test("rounds to the nearest grid multiple", () => {
    expect(snap({ x: 2.2, y: 1.9 }, 0.5)).toEqual({ x: 2.0, y: 2.0 });
  });

  test("leaves a value already on the grid alone", () => {
    expect(snap({ x: 2.5, y: 1.0 }, 0.5)).toEqual({ x: 2.5, y: 1.0 });
  });

  test("is a no-op for a non-positive grid", () => {
    expect(snap({ x: 2.2, y: 1.9 }, 0)).toEqual({ x: 2.2, y: 1.9 });
  });
});

describe("depth", () => {
  test("orders back-to-front so nearer boxes paint last", () => {
    const positions = [
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];

    expect([...positions].sort((a, b) => depth(a) - depth(b))[0]).toEqual({ x: 0, y: 0 });
  });
});

describe("canvasExtent", () => {
  test("is wide and tall enough for both diagonals", () => {
    const { width, height } = canvasExtent(6, 4);

    expect(width).toBe((6 + 4) * M.mHalfW);
    expect(height).toBe((6 + 4) * M.mHalfH);
  });

  test("places the origin so the far-left corner is not clipped", () => {
    const { origin } = canvasExtent(6, 4);
    const farLeft = toScreen({ x: 0, y: 4 }, origin);

    expect(farLeft.x).toBeGreaterThanOrEqual(0);
  });
});

// --- placement ------------------------------------------------------------

const lab: Lab = {
  id: "lab1",
  code: "LAB-1",
  name: "Lab 1",
  site_id: "s1",
  room_number: null,
  environment_class: "ambient",
  access_control_group: null,
  width_m: 6,
  depth_m: 4,
  grid_size_m: 0.5,
};

function station(
  code: string,
  pos_x: number,
  pos_y: number,
  lab_id = "lab1",
  size = 1,
): Station {
  return {
    id: `st-${code}`,
    code,
    name: `Station ${code}`,
    lab_id,
    zone_id: null,
    kind: "generic",
    pos_x,
    pos_y,
    size_x_m: size,
    size_y_m: size,
    height_m: 0.5,
    capacity: 1,
    accepted_labware_types: [],
    queueserver_endpoint: null,
    redis_namespace: null,
    state: "active",
    owning_group: null,
  };
}

function device(code: string, station_code: string | null): Device {
  return {
    id: `d-${code}`,
    code,
    name: `Device ${code}`,
    node_kind: "device",
    labels: {},
    station_id: null,
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
  test("keeps only this lab's stations", () => {
    const placed = placeStations(
      [station("A", 0, 0), station("B", 1, 0, "other-lab")],
      [],
      lab,
    );

    expect(placed.map((p) => p.station.code)).toEqual(["A"]);
  });

  test("pairs a device with its station by station_code", () => {
    const placed = placeStations([station("A", 0, 0)], [device("DEV-1", "A")], lab);

    expect(placed[0].device?.code).toBe("DEV-1");
  });

  test("leaves an unbound station without a device", () => {
    const placed = placeStations([station("A", 0, 0)], [device("DEV-1", null)], lab);

    expect(placed[0].device).toBeNull();
  });

  test("returns stations back-to-front", () => {
    const placed = placeStations(
      [station("far", 2, 2), station("near", 0, 0), station("mid", 1, 0)],
      [],
      lab,
    );

    expect(placed.map((p) => p.station.code)).toEqual(["near", "mid", "far"]);
  });
});

describe("placementProblems", () => {
  test("says nothing about a well-formed layout", () => {
    const placed = placeStations([station("A", 0, 0), station("B", 2, 2)], [], lab);

    expect(placementProblems(placed, lab)).toEqual([]);
  });

  test("flags a box that spills off the floor", () => {
    const placed = placeStations([station("A", 5.5, 0)], [], lab); // 5.5 + 1 > 6

    expect(placementProblems(placed, lab)[0]).toMatchObject({ code: "A" });
    expect(placementProblems(placed, lab)[0].reason).toContain("outside");
  });

  test("flags a negative coordinate", () => {
    const placed = placeStations([station("A", -1, 0)], [], lab);

    expect(placementProblems(placed, lab)).toHaveLength(1);
  });

  test("flags two overlapping boxes", () => {
    const placed = placeStations([station("A", 1, 1), station("B", 1.5, 1.5)], [], lab);

    const problems = placementProblems(placed, lab);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain("overlaps");
  });

  test("lets two boxes touch edge-to-edge without overlapping", () => {
    const placed = placeStations([station("A", 0, 0), station("B", 1, 0)], [], lab);

    expect(placementProblems(placed, lab)).toEqual([]);
  });
});
