/**
 * The custom JointJS shapes the layout draws, and the unit→polygon geometry that
 * feeds them. Generic over the level (ADR 0012): a "box" is a station, a lab on a
 * site, or a device in a station — the shape doesn't care.
 *
 * `@joint/core` only (MPL-2.0). No Stencil, Inspector, Halo, Toolbar, Navigator
 * or Selection — those are JointJS+ commercial, and plan §10.2's recommendation
 * is the free core plus React-side panels, which is what the inspector next to
 * the canvas is. See ADR 0003 Q1.
 *
 * Flat polygons with 1px strokes and no gradients, per DESIGN.md §5 — the
 * isometric look comes from the projection, not from shading. In 2D a box is a
 * single top rectangle (no side faces).
 */

import { dia, util } from "@joint/core";

import type { FloorPos, Point, Projection, TileMetrics } from "./isometric";
import { gridLines, toScreen } from "./isometric";

/** The floor: a filled surface quad plus the grid raster, one element. */
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
 * A box: an isometric prism — top face plus two side faces — over a footprint,
 * `height` tall. Drawn as three polygons rather than one path so each face can
 * take its own fill: the sides are the same hue darkened, which reads as depth
 * without the gradients DESIGN.md rules out. In 2D the side polygons get empty
 * points and only the top rectangle shows.
 */
export const BoxTile = dia.Element.define(
  "epi.Box",
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

/** The four projected corners of the floor, as an absolute-coords polygon. */
export function floorSurfacePoints(
  widthU: number,
  depthU: number,
  origin: Point,
  metrics: TileMetrics,
  projection: Projection,
): string {
  const corners: FloorPos[] = [
    { x: 0, y: 0 },
    { x: widthU, y: 0 },
    { x: widthU, y: depthU },
    { x: 0, y: depthU },
  ];
  return corners
    .map((c) => {
      const p = toScreen(c, origin, metrics, 0, projection);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
}

/** An SVG path (absolute coords) of every grid line across the floor. */
export function floorGridPath(
  widthU: number,
  depthU: number,
  gridU: number,
  origin: Point,
  metrics: TileMetrics,
  projection: Projection,
): string {
  const seg = (a: FloorPos, b: FloorPos) => {
    const pa = toScreen(a, origin, metrics, 0, projection);
    const pb = toScreen(b, origin, metrics, 0, projection);
    return `M ${pa.x.toFixed(2)} ${pa.y.toFixed(2)} L ${pb.x.toFixed(2)} ${pb.y.toFixed(2)}`;
  };
  const parts: string[] = [];
  for (const x of gridLines(widthU, gridU)) parts.push(seg({ x, y: 0 }, { x, y: depthU }));
  for (const y of gridLines(depthU, gridU)) parts.push(seg({ x: 0, y }, { x: widthU, y }));
  return parts.join(" ");
}

/** Everything the renderer needs to draw and drag one box. */
export interface BoxRender {
  position: Point;
  size: { width: number; height: number };
  faces: { top: string; left: string; right: string };
  /** Top-face centre, relative to `position` — where the label/badge sit. */
  label: Point;
  badge: Point;
  /** Far top corner (pos+size), relative to `position` — the footprint handle sits here. */
  farCorner: Point;
  /** Top-face centre at full height, relative to `position` — the height handle sits here. */
  apex: Point;
  /** The floor anchor (near corner at height 0), relative to `position` —
   * added back to the dragged element position to recover floor coordinates. */
  anchor: Point;
}

/** A box's polygons/handles, in either projection. `pos`/`size`/`height` are units. */
export function boxShape(
  pos: FloorPos,
  size: { x: number; y: number },
  height: number,
  origin: Point,
  metrics: TileMetrics,
  projection: Projection,
): BoxRender {
  const { x: px, y: py } = pos;
  const { x: sx, y: sy } = size;
  // In 2D there is no raised face; both "top" and "bottom" collapse to the floor.
  const hm = projection === "2d" ? 0 : height;
  const flat = projection === "2d";

  // Floor corners: A near, B along +x, C far, D along +y.
  const at = toScreen({ x: px, y: py }, origin, metrics, hm, projection);
  const bt = toScreen({ x: px + sx, y: py }, origin, metrics, hm, projection);
  const ct = toScreen({ x: px + sx, y: py + sy }, origin, metrics, hm, projection);
  const dt = toScreen({ x: px, y: py + sy }, origin, metrics, hm, projection);
  const ab = toScreen({ x: px, y: py }, origin, metrics, 0, projection);
  const bb = toScreen({ x: px + sx, y: py }, origin, metrics, 0, projection);
  const cb = toScreen({ x: px + sx, y: py + sy }, origin, metrics, 0, projection);
  const db = toScreen({ x: px, y: py + sy }, origin, metrics, 0, projection);

  const all = [at, bt, ct, dt, ab, bb, cb, db];
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxX = Math.max(...all.map((p) => p.x));
  const maxY = Math.max(...all.map((p) => p.y));
  const rel = (p: Point) => `${(p.x - minX).toFixed(2)},${(p.y - minY).toFixed(2)}`;

  const centreTop = toScreen({ x: px + sx / 2, y: py + sy / 2 }, origin, metrics, hm, projection);

  return {
    position: { x: minX, y: minY },
    size: { width: maxX - minX || 1, height: maxY - minY || 1 },
    faces: {
      top: `${rel(at)} ${rel(bt)} ${rel(ct)} ${rel(dt)}`,
      right: flat ? "" : `${rel(bt)} ${rel(ct)} ${rel(cb)} ${rel(bb)}`,
      left: flat ? "" : `${rel(dt)} ${rel(ct)} ${rel(cb)} ${rel(db)}`,
    },
    label: { x: centreTop.x - minX, y: centreTop.y - minY },
    badge: { x: centreTop.x - minX, y: centreTop.y - minY - 12 },
    farCorner: { x: ct.x - minX, y: ct.y - minY },
    apex: { x: centreTop.x - minX, y: centreTop.y - minY },
    anchor: { x: ab.x - minX, y: ab.y - minY },
  };
}
