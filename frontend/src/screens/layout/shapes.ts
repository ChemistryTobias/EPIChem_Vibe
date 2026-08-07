/**
 * The custom JointJS shapes the layout draws, and the metric→polygon geometry
 * that feeds them.
 *
 * `@joint/core` only (MPL-2.0). No Stencil, Inspector, Halo, Toolbar,
 * Navigator or Selection — those are JointJS+ commercial, and plan §10.2's
 * recommendation is the free core plus React-side panels, which is what the
 * inspector next to the canvas is. See ADR 0003 Q1.
 *
 * Both shapes are flat polygons with 1px strokes and no gradients, per
 * DESIGN.md §5 — the isometric look comes from the projection, not from
 * shading. Geometry is metric now (ADR 0010): a station is a box with a real
 * footprint, not a single unit-cell diamond.
 */

import { dia, util } from "@joint/core";

import type { Lab, Station } from "../../api/types";
import type { FloorPos, Point, TileMetrics } from "./isometric";
import { gridLines, toScreen } from "./isometric";

/** The lab floor: a filled surface quad plus the grid raster, one element. */
export const FloorGrid = dia.Element.define(
  "epi.FloorGrid",
  {
    attrs: {
      surface: { fill: "#EEEEEE", stroke: "#A7A7A8", strokeWidth: 1 },
      grid: { fill: "none", stroke: "#D8D8D8", strokeWidth: 1, pointerEvents: "none" },
    },
  },
  {
    markup: util.svg`
      <polygon @selector="surface" />
      <path @selector="grid" />
    `,
  },
);

/**
 * A station: an isometric box — top face plus two side faces — over a
 * size_x_m × size_y_m footprint, height_m tall.
 *
 * Drawn as three polygons rather than one path so each face can take its own
 * fill: the sides are the same hue darkened, which reads as depth without the
 * gradients DESIGN.md rules out.
 */
export const StationTile = dia.Element.define(
  "epi.Station",
  {
    attrs: {
      top: { fill: "#006C66", stroke: "#005555", strokeWidth: 1 },
      left: { fill: "#005555", stroke: "#005555", strokeWidth: 1 },
      right: { fill: "#00413F", stroke: "#005555", strokeWidth: 1 },
      label: {
        fill: "#FFFFFF",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 10,
        textAnchor: "middle",
        textVerticalAnchor: "middle",
        pointerEvents: "none",
      },
      badge: { r: 4, stroke: "#FFFFFF", strokeWidth: 1, pointerEvents: "none" },
    },
  },
  {
    markup: util.svg`
      <polygon @selector="left" />
      <polygon @selector="right" />
      <polygon @selector="top" />
      <circle @selector="badge" />
      <text @selector="label" />
    `,
  },
);

/** The four projected corners of the lab floor, as an absolute-coords polygon. */
export function floorSurfacePoints(lab: Lab, origin: Point, metrics: TileMetrics): string {
  const corners: FloorPos[] = [
    { x: 0, y: 0 },
    { x: lab.width_m, y: 0 },
    { x: lab.width_m, y: lab.depth_m },
    { x: 0, y: lab.depth_m },
  ];
  return corners
    .map((c) => {
      const p = toScreen(c, origin, metrics);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
}

/** An SVG path (absolute coords) of every grid line across the lab floor. */
export function floorGridPath(lab: Lab, origin: Point, metrics: TileMetrics): string {
  const seg = (a: FloorPos, b: FloorPos) => {
    const pa = toScreen(a, origin, metrics);
    const pb = toScreen(b, origin, metrics);
    return `M ${pa.x.toFixed(2)} ${pa.y.toFixed(2)} L ${pb.x.toFixed(2)} ${pb.y.toFixed(2)}`;
  };
  const parts: string[] = [];
  for (const x of gridLines(lab.width_m, lab.grid_size_m)) parts.push(seg({ x, y: 0 }, { x, y: lab.depth_m }));
  for (const y of gridLines(lab.depth_m, lab.grid_size_m)) parts.push(seg({ x: 0, y }, { x: lab.width_m, y }));
  return parts.join(" ");
}

/** Everything the renderer needs to draw and drag one station box. */
export interface StationBox {
  position: Point;
  size: { width: number; height: number };
  faces: { top: string; left: string; right: string };
  /** Top-face centre, relative to `position` — where the label/badge sit. */
  label: Point;
  badge: Point;
  /** The floor anchor (near corner at height 0), relative to `position` —
   * added back to the dragged element position to recover metric coordinates. */
  anchor: Point;
}

export function stationBox(station: Station, origin: Point, metrics: TileMetrics): StationBox {
  const { pos_x: px, pos_y: py, size_x_m: sx, size_y_m: sy, height_m: hm } = station;
  // Floor corners: A near, B along +x, C far, D along +y.
  const at = toScreen({ x: px, y: py }, origin, metrics, hm);
  const bt = toScreen({ x: px + sx, y: py }, origin, metrics, hm);
  const ct = toScreen({ x: px + sx, y: py + sy }, origin, metrics, hm);
  const dt = toScreen({ x: px, y: py + sy }, origin, metrics, hm);
  const ab = toScreen({ x: px, y: py }, origin, metrics, 0);
  const bb = toScreen({ x: px + sx, y: py }, origin, metrics, 0);
  const cb = toScreen({ x: px + sx, y: py + sy }, origin, metrics, 0);
  const db = toScreen({ x: px, y: py + sy }, origin, metrics, 0);

  const all = [at, bt, ct, dt, ab, bb, cb, db];
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxX = Math.max(...all.map((p) => p.x));
  const maxY = Math.max(...all.map((p) => p.y));
  const rel = (p: Point) => `${(p.x - minX).toFixed(2)},${(p.y - minY).toFixed(2)}`;

  const centreTop = toScreen({ x: px + sx / 2, y: py + sy / 2 }, origin, metrics, hm);

  return {
    position: { x: minX, y: minY },
    size: { width: maxX - minX, height: maxY - minY },
    faces: {
      top: `${rel(at)} ${rel(bt)} ${rel(ct)} ${rel(dt)}`,
      right: `${rel(bt)} ${rel(ct)} ${rel(cb)} ${rel(bb)}`,
      left: `${rel(dt)} ${rel(ct)} ${rel(cb)} ${rel(db)}`,
    },
    label: { x: centreTop.x - minX, y: centreTop.y - minY },
    badge: { x: centreTop.x - minX, y: centreTop.y - minY - 12 },
    anchor: { x: ab.x - minX, y: ab.y - minY },
  };
}

/** Fill for a station's box, by whether a device is bound and its mode. */
export function stationFill(operationalMode: string | null): {
  top: string;
  left: string;
  right: string;
} {
  // Unbound stations are grey: an empty position is a real, common state and
  // shouldn't look like a device.
  if (operationalMode === null) return { top: "#A7A7A8", left: "#8E8E8F", right: "#767677" };
  if (operationalMode === "maintenance") {
    return { top: "#EF7C00", left: "#C66700", right: "#A35400" };
  }
  if (operationalMode === "disabled") return { top: "#777777", left: "#5F5F5F", right: "#4D4D4D" };
  if (operationalMode === "read_only") return { top: "#29485D", left: "#1F3747", right: "#182B37" };
  return { top: "#006C66", left: "#005553", right: "#00413F" };
}
