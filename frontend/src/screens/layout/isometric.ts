/**
 * The layout canvas geometry — one metric model, three levels (plan §10.3, ADRs
 * 0010/0012). Every level (site → labs, lab → stations, station → devices) is
 * the *same* thing: boxes on a metric floor. So this file knows nothing about
 * sites/labs/stations/devices — it deals in a generic `Box` and a `CanvasModel`,
 * and the per-level adapters (`levels.ts`) turn registry rows into boxes.
 *
 *     iso:  screen.x = origin.x + (x - y) * mHalfW
 *           screen.y = origin.y + (x + y) * mHalfH - heightU * heightUnit
 *     2d:   screen.x = origin.x + x * scale2d
 *           screen.y = origin.y + y * scale2d          (height not drawn)
 *     depth = x + y            // painter's algorithm: render ascending
 *
 * Pure functions, no JointJS and no React — the geometry is the part that's easy
 * to get subtly wrong and hard to eyeball on a canvas, so it lives apart from
 * the rendering and is tested directly (`isometric.test.ts`). `toFloor` is the
 * inverse of `toScreen` and is what makes dragging work; `snap` rounds to the
 * grid (snap-but-not-bound, ADR 0010).
 */

/** How the canvas projects floor metres to screen pixels. */
export type Projection = "iso" | "2d";

/**
 * Scale, in screen pixels. `metricsFor` derives these per level so a 40 m site
 * and a 1 m station both fill roughly the same space — the levels span three
 * orders of magnitude, so a fixed px-per-metre would make one tiny and one huge.
 */
export interface TileMetrics {
  /** Screen px per metre along the isometric horizontal (x−y) spread. */
  mHalfW: number;
  /** Screen px per metre along the isometric vertical (x+y) spread. */
  mHalfH: number;
  /** Screen px a box rises per unit of height (isometric only). */
  heightUnit: number;
  /** Screen px per metre in the flat 2D projection. */
  scale2d: number;
}

/** The isometric aspect the classic view was tuned to; `metricsFor` scales it. */
const BASE = { mHalfW: 46, mHalfH: 27, heightUnit: 40 };
export const DEFAULT_METRICS: TileMetrics = { ...BASE, scale2d: 60 };

/** Default drawing span in px, so every level fits before the canvas measures itself. */
export const TARGET_PX = 860;

/**
 * Metrics scaled so a `widthU × depthU` floor draws at ~`targetPx`, whatever the
 * level's unit magnitude. Isometric scales `BASE` uniformly; 2D sets a plain
 * px-per-metre. Both projections' fields are always returned (the canvas may
 * toggle between them without re-deriving). `targetPx` lets the canvas fit the
 * drawing to its actual size — the full-bleed editor feeds it the container's
 * measured extent so a resize re-fits (extent is linear in `targetPx`).
 */
export function metricsFor(widthU: number, depthU: number, targetPx: number = TARGET_PX): TileMetrics {
  const span = Math.max(widthU + depthU, 1e-6);
  const k = targetPx / (span * BASE.mHalfW);
  return {
    mHalfW: BASE.mHalfW * k,
    mHalfH: BASE.mHalfH * k,
    heightUnit: BASE.heightUnit * k,
    scale2d: targetPx / Math.max(widthU, depthU, 1e-6),
  };
}

/** A screen position, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A position on the floor, in the level's canvas units (metres). */
export interface FloorPos {
  x: number;
  y: number;
}

/** Floor units → the screen position of that point (raised by `heightU` in iso). */
export function toScreen(
  pos: FloorPos,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  heightU = 0,
  projection: Projection = "iso",
): Point {
  if (projection === "2d") {
    return { x: origin.x + pos.x * metrics.scale2d, y: origin.y + pos.y * metrics.scale2d };
  }
  return {
    x: origin.x + (pos.x - pos.y) * metrics.mHalfW,
    y: origin.y + (pos.x + pos.y) * metrics.mHalfH - heightU * metrics.heightUnit,
  };
}

/**
 * Screen position → the floor units it lands on. The inverse of `toScreen`.
 *
 * `heightU` must match the value `toScreen` was given (iso only), or a raised
 * point reads as being further back on the floor than it is.
 */
export function toFloor(
  point: Point,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  heightU = 0,
  projection: Projection = "iso",
): FloorPos {
  if (projection === "2d") {
    return { x: (point.x - origin.x) / metrics.scale2d, y: (point.y - origin.y) / metrics.scale2d };
  }
  const dx = (point.x - origin.x) / metrics.mHalfW;
  const dy = (point.y - origin.y + heightU * metrics.heightUnit) / metrics.mHalfH;
  return {
    x: (dx + dy) / 2,
    y: (dy - dx) / 2,
  };
}

/** Round a floor position to the nearest grid intersection (soft snap). */
export function snap(pos: FloorPos, gridSizeU: number): FloorPos {
  if (gridSizeU <= 0) return pos;
  return {
    x: Math.round(pos.x / gridSizeU) * gridSizeU,
    y: Math.round(pos.y / gridSizeU) * gridSizeU,
  };
}

/** Painter's algorithm: render ascending, so nearer boxes paint over farther. */
export function depth(pos: FloorPos): number {
  return pos.x + pos.y;
}

/**
 * How big the drawing is, in screen px, for a `widthU × depthU` floor, plus the
 * origin that keeps the far-left corner from clipping. Iso is a diamond shifted
 * right by the depth; 2D is an axis-aligned rectangle at the origin.
 */
export function canvasExtent(
  widthU: number,
  depthU: number,
  metrics: TileMetrics = DEFAULT_METRICS,
  projection: Projection = "iso",
): { width: number; height: number; origin: Point } {
  if (projection === "2d") {
    return {
      width: widthU * metrics.scale2d,
      height: depthU * metrics.scale2d,
      origin: { x: 0, y: 0 },
    };
  }
  return {
    width: (widthU + depthU) * metrics.mHalfW,
    height: (widthU + depthU) * metrics.mHalfH,
    // Shift right by the depth so the far-left corner (0, depthU) sits at x=0.
    origin: { x: depthU * metrics.mHalfW, y: 0 },
  };
}

/** Grid-line intersections along each axis, as unit offsets 0..extent. */
export function gridLines(extentU: number, gridSizeU: number): number[] {
  const lines: number[] = [];
  if (gridSizeU <= 0) return [0, extentU];
  // A tiny epsilon so a floor that divides evenly still gets its far edge line.
  for (let v = 0; v <= extentU + 1e-9; v += gridSizeU) lines.push(Math.min(v, extentU));
  if (lines[lines.length - 1] < extentU) lines.push(extentU);
  return lines;
}

// ---- the generic model: boxes on a floor -----------------------------------

/** Face fills for a box; in 2D only `top` is drawn. */
export interface BoxFill {
  top: string;
  left: string;
  right: string;
  /** Optional top-face stroke when unselected (defaults to white). Lets a flat
   * lab read like a zone: a translucent fill with a coloured border (req). */
  stroke?: string;
  /** Optional top-face stroke dash (defaults to solid) — the zone look. */
  dash?: string;
}

/**
 * One box on the canvas, in the level's canvas units. The adapter (`levels.ts`)
 * decides everything level-specific — the fill, the label, whether a badge shows
 * — so the canvas renderer stays ignorant of what a box *is*.
 */
export interface Box {
  /** The registry code of the row this box stands for — the selection key. */
  code: string;
  /** Near corner on the floor. */
  pos: FloorPos;
  /** Footprint. */
  size: { x: number; y: number };
  /** Isometric box height (units); 0 draws flat. Ignored in 2D. */
  height: number;
  fill: BoxFill;
  label: string;
  /** Draw the small "has a child bound" dot. */
  badge: boolean;
}

/**
 * A faint footprint drawn one level *below* the current one — the stations
 * inside each lab (site view) or the devices inside each station (lab view),
 * projected into the current canvas so you can feel how the space is used
 * without drilling in. Non-interactive: it's context, not something to place.
 */
export interface Outline {
  /** Child's registry code (kept for a stable key; not selectable). */
  code: string;
  /** Footprint on the current floor, in the current level's units. */
  pos: FloorPos;
  size: { x: number; y: number };
  /** Elevation to draw the outline at — the parent box's height, so the hint
   * sits *on the parent's top face* rather than hidden under the box (0 draws
   * it flat on the floor, e.g. under a flat lab). */
  height: number;
  /** The parent box this outline belongs to, so the canvas can move the hints
   * with the box while it's dragged (req: children follow the drag). */
  parentCode: string;
}

/**
 * A zone: a flat 2D area on the current floor (ADR 0015) — a walkable region, a
 * keep-out, a robot cell. Drawn as a translucent labelled rectangle *under* the
 * boxes, in both projections (no height). `members` are the codes of the boxes
 * whose footprint is fully inside it — geometric membership, computed on read.
 */
export interface ZoneShape {
  code: string;
  label: string;
  purpose: string;
  pos: FloorPos;
  size: { x: number; y: number };
  members: string[];
}

/** A whole level's canvas: floor dimensions plus the boxes on it. */
export interface CanvasModel {
  /** Floor width/depth/grid, in the level's canvas units. */
  widthU: number;
  depthU: number;
  gridU: number;
  boxes: Box[];
  /** Weak footprints of the grandchildren (one level down); optional. */
  outlines?: Outline[];
  /** Zones (flat 2D areas) on this floor; optional. */
  zones?: ZoneShape[];
}

/** Is a box's footprint (pos, size) fully inside a zone rectangle? (⊆, ADR 0015) */
export function rectContainsBox(
  zonePos: FloorPos,
  zoneSize: { x: number; y: number },
  boxPos: FloorPos,
  boxSize: { x: number; y: number },
): boolean {
  return (
    boxPos.x >= zonePos.x - 1e-6 &&
    boxPos.y >= zonePos.y - 1e-6 &&
    boxPos.x + boxSize.x <= zonePos.x + zoneSize.x + 1e-6 &&
    boxPos.y + boxSize.y <= zonePos.y + zoneSize.y + 1e-6
  );
}

/** Back-to-front order (painter's algorithm, §10.3) — nearer boxes paint last. */
export function sortBoxes(boxes: Box[]): Box[] {
  return [...boxes].sort((a, b) => depth(a.pos) - depth(b.pos));
}

/** A box that falls off its canvas, or overlaps another. */
export interface BoxProblem {
  code: string;
  reason: string;
}

/** Off-canvas / overlap warnings — soft, like the rest of placement (ADR 0010). */
export function boxProblems(boxes: Box[], widthU: number, depthU: number): BoxProblem[] {
  const problems: BoxProblem[] = [];
  const seen: { code: string; x0: number; y0: number; x1: number; y1: number }[] = [];

  for (const box of boxes) {
    const x0 = box.pos.x;
    const y0 = box.pos.y;
    const x1 = box.pos.x + box.size.x;
    const y1 = box.pos.y + box.size.y;

    if (x0 < -1e-6 || y0 < -1e-6 || x1 > widthU + 1e-6 || y1 > depthU + 1e-6) {
      problems.push({
        code: box.code,
        reason: `box at (${round(x0)}, ${round(y0)}) spills outside the ${round(widthU)}×${round(depthU)} floor`,
      });
      continue;
    }

    const hit = seen.find((s) => x0 < s.x1 - 1e-6 && x1 > s.x0 + 1e-6 && y0 < s.y1 - 1e-6 && y1 > s.y0 + 1e-6);
    if (hit) {
      problems.push({ code: box.code, reason: `overlaps ${hit.code}` });
    } else {
      seen.push({ code: box.code, x0, y0, x1, y1 });
    }
  }

  return problems;
}

/** Trim float noise in warning text without rounding real values away. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---- placement constraints (the isometric-diagram demo's "keep it inside") ---
//
// A box must stay inside its floor and off every other box — for drags, handle
// resizes and numeric entry alike. These pure helpers are the one place that
// rule lives; the screen calls them at the moment an edit commits.

/** A box's geometry in canvas units — position, footprint, height. */
export interface RectGeom {
  pos: FloorPos;
  size: { x: number; y: number };
  height: number;
}

/** The floor a box is constrained to, in the same units. */
export interface Floor {
  widthU: number;
  depthU: number;
  gridU: number;
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Pull a geometry back inside the floor: footprint no larger than the floor,
 * position so the whole box fits. Height is only floored at 0. This never fails —
 * it returns the nearest in-bounds geometry (overlap is checked separately).
 */
export function clampToFloor(g: RectGeom, floor: Floor): RectGeom {
  const minX = Math.min(floor.gridU || 0.01, floor.widthU);
  const minY = Math.min(floor.gridU || 0.01, floor.depthU);
  const sx = clampN(g.size.x, minX, floor.widthU);
  const sy = clampN(g.size.y, minY, floor.depthU);
  return {
    pos: { x: clampN(g.pos.x, 0, floor.widthU - sx), y: clampN(g.pos.y, 0, floor.depthU - sy) },
    size: { x: sx, y: sy },
    height: Math.max(g.height, 0),
  };
}

/** Do two footprints overlap (touching edges don't count)? */
export function rectsOverlap(a: RectGeom, b: RectGeom): boolean {
  return (
    a.pos.x < b.pos.x + b.size.x - 1e-6 &&
    a.pos.x + a.size.x > b.pos.x + 1e-6 &&
    a.pos.y < b.pos.y + b.size.y - 1e-6 &&
    a.pos.y + a.size.y > b.pos.y + 1e-6
  );
}

/** Does `g` overlap any of `others` (already excluding itself)? */
export function overlapsAny(g: RectGeom, others: RectGeom[]): boolean {
  return others.some((o) => rectsOverlap(g, o));
}

/**
 * Slide a *moved* box to the nearest overlap-free spot instead of snapping it
 * back (the isometric-diagram demo affordance): the box stops against the wall
 * or the neighbour it ran into rather than teleporting to where it started.
 *
 * The footprint and height are fixed (this is a move); only the position moves.
 * We clamp to the floor, then while the footprint still overlaps a neighbour we
 * push it out along the axis of least penetration and re-clamp — so it ends up
 * flush against whatever blocked it. `from` is the box's position before the
 * drag: if it stays trapped after a few pushes (wedged between boxes), we leave
 * it there so nothing jumps across the floor.
 */
export function slidePos(g: RectGeom, floor: Floor, others: RectGeom[], from: FloorPos): RectGeom {
  const size = g.size;
  const target = clampToFloor(g, floor).pos; // desired position, inside the walls
  const free = (x: number, y: number) => !overlapsAny({ pos: { x, y }, size, height: 0 }, others);

  // Move along X from the previous position, then along Y from there — so the box
  // stops flush where it first hits and can still slide along the wall/neighbour
  // on the free axis (the tile-collision "move X then Y" resolution).
  const x = sweep1D(from.x, target.x, (v) => free(v, from.y));
  const y = sweep1D(from.y, target.y, (v) => free(x, v));
  return { pos: { x: round4(x), y: round4(y) }, size, height: g.height };
}

/**
 * The value furthest along `a → b` that still satisfies `ok`, assuming `ok(a)`
 * holds and the blocked region (if any) is contiguous from some point onward
 * (true for axis-aligned box obstacles). Binary-searches the a→blocked boundary.
 */
function sweep1D(a: number, b: number, ok: (v: number) => boolean): number {
  if (ok(b)) return b;
  if (!ok(a)) return a; // shouldn't happen (a is the last valid spot); hold still
  let lo = a; // known free
  let hi = b; // known blocked
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Trim float noise from a slid position to 0.1 mm, keeping real (off-grid) values. */
function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Soft snap a moved box: nudge it onto a nearby grid line or neighbour edge, but
 * only when an edge is *within `tolU`* of one — otherwise the free (float)
 * position is kept (snap-but-not-bound, ADR 0010; the req: "only snap if it's a
 * few pixels near, not just snapping"). Both the near edge (`pos`) and the far
 * edge (`pos+size`) are candidates on each axis, so a box also snaps when its
 * trailing edge lines up ("use the other edge"), and it snaps to neighbour box
 * edges as well as the grid ("snap to lines"). The smallest in-tolerance nudge on
 * each axis wins; ties and misses leave the axis at its float value.
 */
export function softSnap(
  pos: FloorPos,
  size: { x: number; y: number },
  floor: Floor,
  others: RectGeom[],
  tolU: number,
): FloorPos {
  const axis = (p: number, s: number, grid: number, lines: number[]): number => {
    const targets = [...lines];
    if (grid > 0) {
      // The nearest grid multiple to each edge — so only the *closest* line is a
      // candidate, never every multiple across the floor.
      for (const edge of [p, p + s]) targets.push(Math.round(edge / grid) * grid);
    }
    let best = 0;
    let bestAbs = tolU; // only shifts strictly within tolerance are taken
    for (const t of targets) {
      for (const edge of [p, p + s]) {
        const d = t - edge;
        if (Math.abs(d) < bestAbs) {
          bestAbs = Math.abs(d);
          best = d;
        }
      }
    }
    return round4(p + best);
  };
  const xLines = others.flatMap((o) => [o.pos.x, o.pos.x + o.size.x]);
  const yLines = others.flatMap((o) => [o.pos.y, o.pos.y + o.size.y]);
  return {
    x: axis(pos.x, size.x, floor.gridU, xLines),
    y: axis(pos.y, size.y, floor.gridU, yLines),
  };
}

/**
 * The largest footprint a *resized* box may grow to from its fixed near corner
 * (`pos`) without leaving the floor or overlapping a neighbour (req: "if a device
 * or station is in the way while resizing, don't allow it"). Only the far edges
 * move; each axis is limited to the floor edge and to the nearest neighbour that
 * lies ahead on that axis and overlaps on the other. Run twice so the two axes'
 * limits settle together. Never smaller than one grid cell.
 */
export function clampResize(
  pos: FloorPos,
  size: { x: number; y: number },
  floor: Floor,
  others: RectGeom[],
): { x: number; y: number } {
  const minX = Math.min(floor.gridU || 0.01, floor.widthU);
  const minY = Math.min(floor.gridU || 0.01, floor.depthU);
  let sx = Math.min(size.x, floor.widthU - pos.x);
  let sy = Math.min(size.y, floor.depthU - pos.y);
  for (let pass = 0; pass < 2; pass++) {
    for (const o of others) {
      const yOverlap = pos.y < o.pos.y + o.size.y - 1e-6 && pos.y + sy > o.pos.y + 1e-6;
      const xOverlap = pos.x < o.pos.x + o.size.x - 1e-6 && pos.x + sx > o.pos.x + 1e-6;
      if (o.pos.x >= pos.x - 1e-6 && yOverlap) sx = Math.min(sx, o.pos.x - pos.x);
      if (o.pos.y >= pos.y - 1e-6 && xOverlap) sy = Math.min(sy, o.pos.y - pos.y);
    }
  }
  return { x: round4(Math.max(sx, minX)), y: round4(Math.max(sy, minY)) };
}

/**
 * Re-place a grandchild outline when its parent box has moved or resized in the
 * draft (req: children follow the parent). The child keeps the same *fraction* of
 * the parent's footprint and is lifted to the parent's (new) height so it stays
 * on the top face. `base` is the parent geometry the outline's absolute position
 * was originally computed against; `eff` is the parent's current (draft-aware)
 * geometry. Identity when `eff == base`.
 */
export function projectOutline(o: Outline, base: RectGeom, eff: RectGeom): Outline {
  const fx = base.size.x > 1e-9 ? (o.pos.x - base.pos.x) / base.size.x : 0;
  const fy = base.size.y > 1e-9 ? (o.pos.y - base.pos.y) / base.size.y : 0;
  const rx = base.size.x > 1e-9 ? o.size.x / base.size.x : 1;
  const ry = base.size.y > 1e-9 ? o.size.y / base.size.y : 1;
  return {
    ...o,
    pos: { x: eff.pos.x + fx * eff.size.x, y: eff.pos.y + fy * eff.size.y },
    size: { x: rx * eff.size.x, y: ry * eff.size.y },
    height: eff.height,
  };
}

/**
 * The first free slot for a `size` footprint, scanning the floor grid row by row
 * (left→right, top→bottom), so a new box lands next to the last rather than on
 * top of it (req: fill the canvas, don't stack). Null when nothing fits — the
 * canvas is full and the caller warns instead of placing.
 */
export function placeNextSlot(
  size: { x: number; y: number },
  floor: Floor,
  others: RectGeom[],
): FloorPos | null {
  const step = floor.gridU > 0 ? floor.gridU : Math.min(size.x, size.y) || 0.1;
  for (let y = 0; y + size.y <= floor.depthU + 1e-6; y = round(y + step)) {
    for (let x = 0; x + size.x <= floor.widthU + 1e-6; x = round(x + step)) {
      if (!overlapsAny({ pos: { x, y }, size, height: 0 }, others)) return { x, y };
    }
  }
  return null;
}
