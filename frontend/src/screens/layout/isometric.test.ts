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
  clampResize,
  clampToFloor,
  depth,
  metricsFor,
  overlapsAny,
  placeNextSlot,
  projectOutline,
  rectContainsBox,
  rectsOverlap,
  slidePos,
  snap,
  softSnap,
  sortBoxes,
  toFloor,
  toScreen,
} from "./isometric";
import type { Outline } from "./isometric";

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

const floor = { widthU: 6, depthU: 4, gridU: 1 };
const geom = (x: number, y: number, sx = 1, sy = 1) => ({ pos: { x, y }, size: { x: sx, y: sy }, height: 0.5 });

describe("clampToFloor (ADR 0014 border constraint)", () => {
  test("pulls a box back inside the floor", () => {
    const c = clampToFloor(geom(10, 10, 2, 2), floor);
    expect(c.pos).toEqual({ x: 4, y: 2 }); // 6-2, 4-2
    expect(c.size).toEqual({ x: 2, y: 2 });
  });

  test("shrinks a footprint larger than the floor and floors a negative height", () => {
    const c = clampToFloor({ pos: { x: 0, y: 0 }, size: { x: 99, y: 99 }, height: -3 }, floor);
    expect(c.size).toEqual({ x: 6, y: 4 });
    expect(c.height).toBe(0);
  });
});

describe("rectsOverlap / overlapsAny", () => {
  test("overlap yes, edge-touch no", () => {
    expect(rectsOverlap(geom(0, 0), geom(0.5, 0.5))).toBe(true);
    expect(rectsOverlap(geom(0, 0), geom(1, 0))).toBe(false);
    expect(overlapsAny(geom(0, 0), [geom(2, 2), geom(0.5, 0)])).toBe(true);
    expect(overlapsAny(geom(0, 0), [geom(2, 2), geom(3, 3)])).toBe(false);
  });
});

describe("placeNextSlot (ADR 0014 auto-tiling)", () => {
  test("fills the origin when empty, then the next free grid slot", () => {
    expect(placeNextSlot({ x: 1, y: 1 }, floor, [])).toEqual({ x: 0, y: 0 });
    expect(placeNextSlot({ x: 1, y: 1 }, floor, [geom(0, 0)])).toEqual({ x: 1, y: 0 });
  });

  test("returns null when the floor is full", () => {
    const packed = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) packed.push(geom(x, y));
    expect(placeNextSlot({ x: 1, y: 1 }, floor, packed)).toBeNull();
  });
});

describe("rectContainsBox (zone membership, ADR 0015)", () => {
  const zp = { x: 1, y: 1 };
  const zs = { x: 4, y: 4 }; // zone spans [1,5]×[1,5]
  test("a footprint fully inside counts", () => {
    expect(rectContainsBox(zp, zs, { x: 2, y: 2 }, { x: 1, y: 1 })).toBe(true);
    expect(rectContainsBox(zp, zs, { x: 1, y: 1 }, { x: 4, y: 4 })).toBe(true); // flush edges
  });
  test("a footprint that spills out, or only overlaps, does not", () => {
    expect(rectContainsBox(zp, zs, { x: 4.5, y: 2 }, { x: 1, y: 1 })).toBe(false); // spills right
    expect(rectContainsBox(zp, zs, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false); // straddles corner
  });
});

describe("softSnap (snap only when near, else float)", () => {
  test("leaves a position that isn't near any line at its float value", () => {
    expect(softSnap({ x: 2.5, y: 1.5 }, { x: 1, y: 1 }, floor, [], 0.2)).toEqual({ x: 2.5, y: 1.5 });
  });

  test("snaps the near edge onto a grid line when within tolerance", () => {
    expect(softSnap({ x: 2.05, y: 0 }, { x: 1, y: 1 }, floor, [], 0.2).x).toBeCloseTo(2, 9);
  });

  test("snaps using the far edge when only that edge is near a line", () => {
    // near edge 1.6 is 0.4 off grid (no snap), far edge 3.1 is 0.1 off 3 (snaps).
    expect(softSnap({ x: 1.6, y: 0 }, { x: 1.5, y: 1 }, floor, [], 0.2).x).toBeCloseTo(1.5, 9);
  });

  test("snaps to a neighbour box's edge (an alignment line), flush not overlapping", () => {
    const others = [{ pos: { x: 3, y: 0 }, size: { x: 1, y: 1 }, height: 0 }];
    // far edge 2.9 snaps onto the neighbour's near edge 3 → box lands at x=2, flush.
    expect(softSnap({ x: 1.9, y: 0 }, { x: 1, y: 1 }, floor, others, 0.2).x).toBeCloseTo(2, 9);
  });
});

describe("clampResize (don't grow through a neighbour or off the floor)", () => {
  test("leaves a free resize untouched", () => {
    expect(clampResize({ x: 0, y: 0 }, { x: 2, y: 2 }, floor, [])).toEqual({ x: 2, y: 2 });
  });

  test("stops the far edge flush against a blocking neighbour ahead on x", () => {
    // Box at (0,0) growing to 3 wide hits B at x=2 (same y band) → capped to 2.
    const others = [{ pos: { x: 2, y: 0 }, size: { x: 1, y: 1 }, height: 0 }];
    expect(clampResize({ x: 0, y: 0 }, { x: 3, y: 1 }, floor, others).x).toBeCloseTo(2, 9);
  });

  test("ignores a neighbour that doesn't overlap on the other axis", () => {
    // B is at y=2, box only 1 deep at y=0 → no y-overlap, so x is free to the floor.
    const others = [{ pos: { x: 2, y: 2 }, size: { x: 1, y: 1 }, height: 0 }];
    expect(clampResize({ x: 0, y: 0 }, { x: 6, y: 1 }, floor, others).x).toBeCloseTo(6, 9);
  });

  test("caps to the floor edge", () => {
    expect(clampResize({ x: 4, y: 0 }, { x: 5, y: 1 }, floor, []).x).toBeCloseTo(2, 9); // 6 - 4
  });
});

describe("projectOutline (grandchild hints follow the parent)", () => {
  const o: Outline = { code: "d", parentCode: "s", pos: { x: 1, y: 1 }, size: { x: 1, y: 1 }, height: 0.5 };
  test("is identity when the parent hasn't moved", () => {
    const base = { pos: { x: 0, y: 0 }, size: { x: 4, y: 4 }, height: 0.5 };
    const r = projectOutline(o, base, base);
    expect(r.pos).toEqual({ x: 1, y: 1 });
    expect(r.size).toEqual({ x: 1, y: 1 });
  });

  test("translates with a moved parent and lifts to its new height", () => {
    const base = { pos: { x: 0, y: 0 }, size: { x: 4, y: 4 }, height: 0.5 };
    const eff = { pos: { x: 2, y: 3 }, size: { x: 4, y: 4 }, height: 1.2 };
    const r = projectOutline(o, base, eff);
    expect(r.pos).toEqual({ x: 3, y: 4 }); // same offset (1,1) from the new corner
    expect(r.height).toBe(1.2);
  });

  test("scales the fraction with a resized parent", () => {
    const base = { pos: { x: 0, y: 0 }, size: { x: 4, y: 4 }, height: 0.5 };
    const eff = { pos: { x: 0, y: 0 }, size: { x: 8, y: 8 }, height: 0.5 };
    const r = projectOutline(o, base, eff);
    expect(r.pos).toEqual({ x: 2, y: 2 }); // 1/4 of 8
    expect(r.size).toEqual({ x: 2, y: 2 });
  });
});

describe("slidePos (slide against walls/boxes, don't snap back)", () => {
  test("leaves a free move untouched", () => {
    const from = { x: 0, y: 0 };
    expect(slidePos(geom(3, 2), floor, [geom(0, 0)], from).pos).toEqual({ x: 3, y: 2 });
  });

  test("stops flush against a blocking neighbour instead of reverting", () => {
    // Dragging A (at 0,0) rightward onto B (at 2,0) lands it flush at x=1, not back at 0.
    const r = slidePos(geom(2.4, 0), floor, [geom(2, 0)], { x: 0, y: 0 });
    expect(r.pos).toEqual({ x: 1, y: 0 });
  });

  test("clamps to the floor wall", () => {
    expect(slidePos(geom(10, 0), floor, [], { x: 0, y: 0 }).pos).toEqual({ x: 5, y: 0 });
  });

  test("always resolves to an overlap-free position", () => {
    const others = [geom(0, 1), geom(2, 1), geom(1, 0), geom(1, 2)];
    const r = slidePos(geom(1.3, 1), floor, others, { x: 1, y: 1 });
    expect(overlapsAny(r, others)).toBe(false);
  });
});
