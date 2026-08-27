/**
 * Where a box is allowed to be — ported from the old editor's `isometric.ts`.
 *
 * This is the half of that file that survived the move to Three.js: the
 * projection maths went to the GPU, but nothing about staying on the floor,
 * off your neighbour, and near the grid is about rendering. Pure functions
 * over floor metres, no React and no three.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** A footprint on the floor: near corner plus extent, in metres. */
export interface Rect {
  pos: Vec2;
  size: Vec2;
}

/** Metres, rounded to millimetres — the precision the backend stores. */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Keep a footprint fully inside a `width × depth` floor. */
export function clampToFloor(rect: Rect, floor: Vec2): Rect {
  const clamp = (v: number, span: number, extent: number) =>
    round3(Math.min(Math.max(v, 0), Math.max(extent - span, 0)));
  return {
    size: rect.size,
    pos: {
      x: clamp(rect.pos.x, rect.size.x, floor.x),
      y: clamp(rect.pos.y, rect.size.y, floor.y),
    },
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.pos.x < b.pos.x + b.size.x &&
    b.pos.x < a.pos.x + a.size.x &&
    a.pos.y < b.pos.y + b.size.y &&
    b.pos.y < a.pos.y + a.size.y
  );
}

export const overlapsAny = (rect: Rect, others: Rect[]) => others.some((o) => rectsOverlap(rect, o));

/**
 * Move towards `to`, sliding along whichever axis is still free rather than
 * stopping dead — dragging a box along a wall should follow the wall.
 */
export function slideTo(rect: Rect, to: Vec2, floor: Vec2, others: Rect[]): Rect {
  const tries = [
    { x: to.x, y: to.y },
    { x: to.x, y: rect.pos.y },
    { x: rect.pos.x, y: to.y },
  ];
  for (const pos of tries) {
    const candidate = clampToFloor({ pos, size: rect.size }, floor);
    if (!overlapsAny(candidate, others)) return candidate;
  }
  return rect;
}

/**
 * Snap to the grid as a guide, not a constraint (plan §10.3): a value within
 * `tolerance` of a gridline goes to it, anything further stays put, so a bench
 * that doesn't sit on a clean raster can still be placed truthfully.
 */
export function softSnap(value: number, grid: number, tolerance: number): number {
  const nearest = Math.round(value / grid) * grid;
  return Math.abs(nearest - value) <= tolerance ? round3(nearest) : round3(value);
}

/** The first free grid slot for a `size` footprint — where a new box lands. */
export function placeNextSlot(size: Vec2, floor: Vec2, others: Rect[], grid: number): Vec2 {
  for (let y = 0; y + size.y <= floor.y + 1e-9; y = round3(y + grid)) {
    for (let x = 0; x + size.x <= floor.x + 1e-9; x = round3(x + grid)) {
      if (!overlapsAny({ pos: { x, y }, size }, others)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}
