/**
 * Isometric projection, straight from plan §10.3.
 *
 *     screen.x = origin.x + (col - row) * (tileW / 2)
 *     screen.y = origin.y + (col + row) * (tileH / 2) - stackHeight
 *     depth    = col + row            // painter's algorithm: render ascending
 *
 * Pure functions, no JointJS and no React — the geometry is the part that's
 * easy to get subtly wrong and hard to eyeball on a canvas, so it lives
 * apart from the rendering and is tested directly (`isometric.test.ts`).
 *
 * `toGrid` is the inverse, and it's what makes dragging work: a tile is
 * dropped at some pixel position and has to become a `grid_col`/`grid_row`
 * the registry will accept.
 */

import type { Bench, Device, Station } from "../../api/types";

/**
 * §10.3: "Prototype values (W2=50, H2=29, TW=100, TH=58, per-kind default
 * heights) are a good starting scale; make them configurable per lab."
 * Configurable per call rather than per lab for now — no lab-level display
 * settings exist in the registry yet.
 */
export interface TileMetrics {
  /** Full tile width in screen px. */
  tileW: number;
  /** Full tile height in screen px. */
  tileH: number;
  /** Screen px a station rises per unit of `stack_height`. */
  stackUnit: number;
}

export const DEFAULT_METRICS: TileMetrics = { tileW: 100, tileH: 58, stackUnit: 22 };

export interface Point {
  x: number;
  y: number;
}

export interface GridCell {
  col: number;
  row: number;
}

/** Grid cell -> the screen position of that tile's centre. */
export function toScreen(
  cell: GridCell,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  stackHeight = 0,
): Point {
  return {
    x: origin.x + (cell.col - cell.row) * (metrics.tileW / 2),
    y: origin.y + (cell.col + cell.row) * (metrics.tileH / 2) - stackHeight * metrics.stackUnit,
  };
}

/**
 * Screen position -> the grid cell it lands in. The inverse of `toScreen`,
 * rounded to the nearest cell so a drop snaps.
 *
 * `stackHeight` must be the same value `toScreen` was given, or a raised
 * tile reads as being one row further back than it is.
 */
export function toGrid(
  point: Point,
  origin: Point,
  metrics: TileMetrics = DEFAULT_METRICS,
  stackHeight = 0,
): GridCell {
  const dx = (point.x - origin.x) / (metrics.tileW / 2);
  const dy = (point.y - origin.y + stackHeight * metrics.stackUnit) / (metrics.tileH / 2);
  return {
    col: Math.round((dx + dy) / 2),
    row: Math.round((dy - dx) / 2),
  };
}

/** Painter's algorithm: render ascending, so nearer tiles paint over farther. */
export function depth(cell: GridCell): number {
  return cell.col + cell.row;
}

/** The four corners of a tile's diamond, relative to its own bounding box. */
export function diamondPoints(metrics: TileMetrics = DEFAULT_METRICS): string {
  const { tileW: w, tileH: h } = metrics;
  return [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ]
    .map((p) => p.join(","))
    .join(" ");
}

/**
 * How big the drawing is, in screen px, for a bench of `cols x rows`.
 * Used to size the paper and to place the origin so nothing is clipped:
 * the leftmost point of the diamond field is at col=0,row=rows-1.
 */
export function benchExtent(
  cols: number,
  rows: number,
  metrics: TileMetrics = DEFAULT_METRICS,
): { width: number; height: number; origin: Point } {
  const width = (cols + rows) * (metrics.tileW / 2);
  const height = (cols + rows) * (metrics.tileH / 2);
  return {
    width,
    height,
    // Shift right by the depth of the row axis so col=0,row=max sits at x=0.
    origin: { x: rows * (metrics.tileW / 2), y: 0 },
  };
}

/** Every cell of a bench grid, in paint order. */
export function benchCells(cols: number, rows: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) cells.push({ col, row });
  }
  return cells.sort((a, b) => depth(a) - depth(b));
}

/**
 * What the canvas draws: one bench's stations, each with whatever device is
 * bound to it, sorted back-to-front.
 *
 * The pairing is by `Device.station_code`, which the API already derives
 * from the station_device_bindings join — the canvas doesn't re-implement
 * that relationship, it reads it.
 */
export interface PlacedStation {
  station: Station;
  device: Device | null;
  cell: GridCell;
}

export function placeStations(
  stations: Station[],
  devices: Device[],
  bench: Bench,
): PlacedStation[] {
  const deviceByStation = new Map(
    devices.filter((d) => d.station_code).map((d) => [d.station_code as string, d]),
  );

  return stations
    .filter((s) => s.bench_id === bench.id)
    .map((station) => ({
      station,
      device: deviceByStation.get(station.code) ?? null,
      cell: { col: station.grid_col, row: station.grid_row },
    }))
    .sort((a, b) => depth(a.cell) - depth(b.cell));
}

/** Stations sitting outside their bench's declared grid, or on top of each other. */
export interface PlacementProblem {
  code: string;
  reason: string;
}

export function placementProblems(placed: PlacedStation[], bench: Bench): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const occupied = new Map<string, string>();

  for (const { station, cell } of placed) {
    if (cell.col < 0 || cell.col >= bench.grid_cols || cell.row < 0 || cell.row >= bench.grid_rows) {
      problems.push({
        code: station.code,
        reason: `at (${cell.col}, ${cell.row}), outside the bench's ${bench.grid_cols}×${bench.grid_rows} grid`,
      });
      continue;
    }
    const key = `${cell.col},${cell.row}`;
    const existing = occupied.get(key);
    if (existing) {
      problems.push({
        code: station.code,
        reason: `shares cell (${cell.col}, ${cell.row}) with ${existing}`,
      });
    } else {
      occupied.set(key, station.code);
    }
  }

  return problems;
}
