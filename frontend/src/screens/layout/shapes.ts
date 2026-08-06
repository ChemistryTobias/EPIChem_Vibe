/**
 * The two custom JointJS shapes the layout draws.
 *
 * `@joint/core` only (MPL-2.0). No Stencil, Inspector, Halo, Toolbar,
 * Navigator or Selection — those are JointJS+ commercial, and plan §10.2's
 * recommendation is the free core plus React-side panels, which is what the
 * inspector next to the canvas is. The bundled prototype already proved this
 * works for an isometric floor plan; see ADR 0003 Q1.
 *
 * Both shapes are flat polygons with 1px strokes and no gradients, per
 * DESIGN.md §5 — the isometric look comes from the projection, not from
 * shading.
 */

import { dia, util } from "@joint/core";

import type { TileMetrics } from "./isometric";

/** An empty floor cell: one diamond. */
export const FloorTile = dia.Element.define(
  "epi.FloorTile",
  {
    attrs: {
      body: {
        fill: "#FFFFFF",
        stroke: "#DCDCDC",
        strokeWidth: 1,
      },
    },
  },
  {
    markup: util.svg`<polygon @selector="body" />`,
  },
);

/**
 * A station: an isometric box — top diamond plus two side faces — whose
 * height comes from `stack_height`.
 *
 * Drawn as three polygons rather than one path so each face can take its own
 * fill: the sides are the same hue darkened, which reads as depth without
 * the gradients DESIGN.md rules out.
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

/** Points for a floor diamond filling a tileW x tileH box. */
export function floorPoints({ tileW: w, tileH: h }: TileMetrics): string {
  return `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
}

/**
 * The three faces of a station box `boxHeight` px tall, inside a bounding
 * box of tileW x (tileH + boxHeight).
 */
export function stationFaces(
  { tileW: w, tileH: h }: TileMetrics,
  boxHeight: number,
): { top: string; left: string; right: string } {
  return {
    top: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
    left: `0,${h / 2} ${w / 2},${h} ${w / 2},${h + boxHeight} 0,${h / 2 + boxHeight}`,
    right: `${w},${h / 2} ${w / 2},${h} ${w / 2},${h + boxHeight} ${w},${h / 2 + boxHeight}`,
  };
}

/** Fill for a station's top face, by whether a device is bound and its mode. */
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
