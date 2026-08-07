/**
 * Isometric projection in metres, from plan §10.3 and ADR 0010.
 *
 * The lab is a metric canvas: a width_m × depth_m floor with a grid_size_m
 * raster. A station is a box placed on it at (pos_x, pos_y) metres, with a
 * size_x_m × size_y_m footprint and a height_m box height. Everything here is
 * metres in, screen pixels out.
 *
 *     screen.x = origin.x + (x - y) * mHalfW
 *     screen.y = origin.y + (x + y) * mHalfH - heightM * heightUnit
 *     depth    = x + y            // painter's algorithm: render ascending
 *
 * Pure functions, no JointJS and no React — the geometry is the part that's
 * easy to get subtly wrong and hard to eyeball on a canvas, so it lives apart
 * from the rendering and is tested directly (`isometric.test.ts`).
 *
 * `toFloor` is the inverse, and it's what makes dragging work: a box dropped
 * at some pixel position becomes a metric (pos_x, pos_y) the registry accepts.
 * `snap` rounds that to the grid — the editor snaps by default but nothing
 * forces it (snap-but-not-bound, ADR 0010).
 */

import type { Device, Lab, Station } from "../../api/types";

/**
 * Scale, in screen pixels. Per metre rather than per cell now (ADR 0010), so
 * the projection is independent of the lab's grid_size_m — a finer grid just
 * draws more lines, it doesn't rescale the room.
 */
export interface TileMetrics {
  /** Screen px per metre along the horizontal (x−y) spread. */
  mHalfW: number;
  /** Screen px per metre along the vertical (x+y) spread. */
  mHalfH: number;
  /** Screen px a box rises per metre of height_m. */
  heightUnit: number;
}

export const DEFAULT_METRICS: TileMetrics = { mHalfW: 46, mHalfH: 27, heightUnit: 40 };

/** A screen position, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A position on the lab floor, in metres. */
export interface FloorPos {
  x: number;
  y: number;
}

/** Floor metres → the screen position of that point (raised by heightM). */
export function toScreen(
  pos: FloorPos,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  heightM = 0,
): Point {
  return {
    x: origin.x + (pos.x - pos.y) * metrics.mHalfW,
    y: origin.y + (pos.x + pos.y) * metrics.mHalfH - heightM * metrics.heightUnit,
  };
}

/**
 * Screen position → the floor metres it lands on. The inverse of `toScreen`.
 *
 * `heightM` must match the value `toScreen` was given, or a raised point reads
 * as being further back on the floor than it is.
 */
export function toFloor(
  point: Point,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  heightM = 0,
): FloorPos {
  const dx = (point.x - origin.x) / metrics.mHalfW;
  const dy = (point.y - origin.y + heightM * metrics.heightUnit) / metrics.mHalfH;
  return {
    x: (dx + dy) / 2,
    y: (dy - dx) / 2,
  };
}

/** Round a floor position to the nearest grid intersection (soft snap). */
export function snap(pos: FloorPos, gridSizeM: number): FloorPos {
  if (gridSizeM <= 0) return pos;
  return {
    x: Math.round(pos.x / gridSizeM) * gridSizeM,
    y: Math.round(pos.y / gridSizeM) * gridSizeM,
  };
}

/** Painter's algorithm: render ascending, so nearer boxes paint over farther. */
export function depth(pos: FloorPos): number {
  return pos.x + pos.y;
}

/**
 * How big the drawing is, in screen px, for a width_m × depth_m floor.
 * Used to size the paper and to place the origin so nothing is clipped: the
 * leftmost point of the diamond is the far corner (x=0, y=depth_m).
 */
export function canvasExtent(
  widthM: number,
  depthM: number,
  metrics: TileMetrics = DEFAULT_METRICS,
): { width: number; height: number; origin: Point } {
  return {
    width: (widthM + depthM) * metrics.mHalfW,
    height: (widthM + depthM) * metrics.mHalfH,
    // Shift right by the depth so the far-left corner (0, depth_m) sits at x=0.
    origin: { x: depthM * metrics.mHalfW, y: 0 },
  };
}

/** Grid-line intersections along each axis, as metre offsets 0..extent. */
export function gridLines(extentM: number, gridSizeM: number): number[] {
  const lines: number[] = [];
  if (gridSizeM <= 0) return [0, extentM];
  // A tiny epsilon so a floor that divides evenly still gets its far edge line.
  for (let v = 0; v <= extentM + 1e-9; v += gridSizeM) lines.push(Math.min(v, extentM));
  if (lines[lines.length - 1] < extentM) lines.push(extentM);
  return lines;
}

/**
 * What the canvas draws: one lab's stations, each with whatever device it
 * holds, sorted back-to-front (ADR 0007: the grid is the lab's, and a station
 * belongs to a lab).
 *
 * The pairing is by `Device.station_code`, which the API derives from the
 * station FK — the canvas doesn't re-implement that relationship, it reads it.
 * A station holds several devices; the canvas shows the first as its badge.
 */
export interface PlacedStation {
  station: Station;
  device: Device | null;
  /** The station box's near corner on the floor, in metres. */
  pos: FloorPos;
}

export function placeStations(
  stations: Station[],
  devices: Device[],
  lab: Lab,
): PlacedStation[] {
  const deviceByStation = new Map<string, Device>();
  for (const d of devices) {
    if (d.station_code && !deviceByStation.has(d.station_code)) {
      deviceByStation.set(d.station_code, d);
    }
  }

  return stations
    .filter((s) => s.lab_id === lab.id)
    .map((station) => ({
      station,
      device: deviceByStation.get(station.code) ?? null,
      pos: { x: station.pos_x, y: station.pos_y },
    }))
    .sort((a, b) => depth(a.pos) - depth(b.pos));
}

/** Stations whose box falls off the lab canvas, or overlaps another. */
export interface PlacementProblem {
  code: string;
  reason: string;
}

export function placementProblems(placed: PlacedStation[], lab: Lab): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const seen: { code: string; x0: number; y0: number; x1: number; y1: number }[] = [];

  for (const { station, pos } of placed) {
    const x0 = pos.x;
    const y0 = pos.y;
    const x1 = pos.x + station.size_x_m;
    const y1 = pos.y + station.size_y_m;

    if (x0 < -1e-6 || y0 < -1e-6 || x1 > lab.width_m + 1e-6 || y1 > lab.depth_m + 1e-6) {
      problems.push({
        code: station.code,
        reason: `box at (${x0}, ${y0}) m spills outside the ${lab.width_m}×${lab.depth_m} m floor`,
      });
      continue;
    }

    const hit = seen.find((s) => x0 < s.x1 - 1e-6 && x1 > s.x0 + 1e-6 && y0 < s.y1 - 1e-6 && y1 > s.y0 + 1e-6);
    if (hit) {
      problems.push({ code: station.code, reason: `overlaps ${hit.code}` });
    } else {
      seen.push({ code: station.code, x0, y0, x1, y1 });
    }
  }

  return problems;
}
