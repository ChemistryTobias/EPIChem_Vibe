/**
 * Geometry is the part of the layout that's easy to get subtly wrong and
 * impossible to eyeball — a half-metre offset looks plausible until you drag
 * something. These test plan §10.3 / ADRs 0010/0012's formulas directly, for
 * both projections, plus the generic box model the three levels share.
 */

import { describe, expect, test } from "vitest";

import type { Box, BoxFill } from "./isometric";
import {
  DEFAULT_METRICS,
  boxProblems,
  canvasExtent,
  depth,
  metricsFor,
  snap,
  sortBoxes,
  toFloor,
  toScreen,
} from "./isometric";

const ORIGIN = { x: 0, y: 0 };
const M = DEFAULT_METRICS;
const FILL: BoxFill = { top: "#000", left: "#000", right: "#000" };

describe("toScreen (iso)", () => {
  test("puts the origin at the origin", () => {
    expect(toScreen({ x: 0, y: 0 }, ORIGIN)).toEqual({ x: 0, y: 0 });
  });

  test("moves right and down along the x axis", () => {
    expect(toScreen({ x: 1, y: 0 }, ORIGIN)).toEqual({ x: M.mHalfW, y: M.mHalfH });
  });

  test("raises a box without moving it sideways", () => {
    const flat = toScreen({ x: 2, y: 1 }, ORIGIN);
    const raised = toScreen({ x: 2, y: 1 }, ORIGIN, M, 1.5);
    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 1.5 * M.heightUnit);
  });
});

describe("toScreen (2d)", () => {
  test("is a plain scale with no diamond and no height", () => {
    expect(toScreen({ x: 2, y: 3 }, ORIGIN, M, 0, "2d")).toEqual({
      x: 2 * M.scale2d,
      y: 3 * M.scale2d,
    });
  });

  test("ignores height entirely", () => {
    const flat = toScreen({ x: 2, y: 3 }, ORIGIN, M, 0, "2d");
    const raised = toScreen({ x: 2, y: 3 }, ORIGIN, M, 5, "2d");
    expect(raised).toEqual(flat);
  });
});

describe("toFloor inverts toScreen", () => {
  test("iso, including raised points", () => {
    const pos = { x: 3, y: 2 };
    const back = toFloor(toScreen(pos, ORIGIN, M, 1.1), ORIGIN, M, 1.1);
    expect(back.x).toBeCloseTo(3, 9);
    expect(back.y).toBeCloseTo(2, 9);
  });

  test("2d", () => {
    const pos = { x: 3.5, y: 1.25 };
    const back = toFloor(toScreen(pos, ORIGIN, M, 0, "2d"), ORIGIN, M, 0, "2d");
    expect(back.x).toBeCloseTo(3.5, 9);
    expect(back.y).toBeCloseTo(1.25, 9);
  });
});

describe("snap", () => {
  test("rounds to the nearest grid multiple", () => {
    expect(snap({ x: 2.2, y: 1.9 }, 0.5)).toEqual({ x: 2.0, y: 2.0 });
  });

  test("is a no-op for a non-positive grid", () => {
    expect(snap({ x: 2.2, y: 1.9 }, 0)).toEqual({ x: 2.2, y: 1.9 });
  });
});

describe("metricsFor", () => {
  test("scales a small floor up and a large floor down toward the same span", () => {
    const small = metricsFor(1, 1); // a 1 m station floor
    const large = metricsFor(40, 40); // a 40 m site floor
    expect(small.mHalfW).toBeGreaterThan(M.mHalfW);
    expect(large.mHalfW).toBeLessThan(M.mHalfW);
    // Both draw their diamond at roughly the same width.
    expect((1 + 1) * small.mHalfW).toBeCloseTo((40 + 40) * large.mHalfW, 6);
  });
});

describe("canvasExtent", () => {
  test("iso is wide enough for both diagonals and un-clips the far-left corner", () => {
    const { width, origin } = canvasExtent(6, 4, M, "iso");
    expect(width).toBe((6 + 4) * M.mHalfW);
    expect(toScreen({ x: 0, y: 4 }, origin).x).toBeGreaterThanOrEqual(0);
  });

  test("2d is an axis-aligned rectangle at the origin", () => {
    const { width, height, origin } = canvasExtent(6, 4, M, "2d");
    expect({ width, height, origin }).toEqual({
      width: 6 * M.scale2d,
      height: 4 * M.scale2d,
      origin: { x: 0, y: 0 },
    });
  });
});

// --- generic box model ------------------------------------------------------

function box(code: string, x: number, y: number, size = 1): Box {
  return { code, pos: { x, y }, size: { x: size, y: size }, height: 0.5, fill: FILL, label: code, badge: false };
}

describe("depth / sortBoxes", () => {
  test("orders back-to-front so nearer boxes paint last", () => {
    const sorted = sortBoxes([box("far", 2, 2), box("near", 0, 0), box("mid", 1, 0)]);
    expect(sorted.map((b) => b.code)).toEqual(["near", "mid", "far"]);
  });

  test("depth is x + y", () => {
    expect(depth({ x: 1.5, y: 2.5 })).toBe(4);
  });
});

describe("boxProblems", () => {
  test("says nothing about a well-formed layout", () => {
    expect(boxProblems([box("A", 0, 0), box("B", 2, 2)], 6, 4)).toEqual([]);
  });

  test("flags a box that spills off the floor", () => {
    const problems = boxProblems([box("A", 5.5, 0)], 6, 4); // 5.5 + 1 > 6
    expect(problems[0]).toMatchObject({ code: "A" });
    expect(problems[0].reason).toContain("spills outside");
  });

  test("flags a negative coordinate", () => {
    expect(boxProblems([box("A", -1, 0)], 6, 4)).toHaveLength(1);
  });

  test("flags two overlapping boxes but lets them touch edge-to-edge", () => {
    expect(boxProblems([box("A", 1, 1), box("B", 1.5, 1.5)], 6, 4)).toHaveLength(1);
    expect(boxProblems([box("A", 0, 0), box("B", 1, 0)], 6, 4)).toEqual([]);
  });
});
