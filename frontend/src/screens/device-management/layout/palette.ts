/**
 * The layout canvas's colours, taken verbatim from the old JointJS editor
 * (`frontend_old/src/screens/layout/{shapes,levels}.ts`) so the 3D rewrite
 * reads as the same product rather than a new one.
 *
 * The room shell — floor slab and the two back walls — is the one addition:
 * a light, flat, thin-outlined enclosure in the manner of a technical
 * illustration, in the same grey family the old floor already used.
 */

/** The three tones a box shows: its top face and its two visible sides. */
export interface BoxFill {
  top: string;
  left: string;
  right: string;
}

/** A station, module or device. The old canvas coloured these by the bound
 * device's operational mode; the new backend has no mode field yet, so
 * everything real is MPG green and anything unplaceable is grey. */
export const FILL_ACTIVE: BoxFill = { top: "#006C66", left: "#005553", right: "#00413F" };
export const FILL_GREY: BoxFill = { top: "#A7A7A8", left: "#8E8E8F", right: "#767677" };

/** Labs draw flat and translucent, like zones, so the floor grid and the
 * station footprints on top read straight through them. */
export const LAB = { fill: "#00B1EA", opacity: 0.14, edge: "#0090BE" };

/** Zones: the olive wash of the old ZoneArea shape. */
export const ZONE = { fill: "#C6D325", opacity: 0.16, edge: "#8C9519" };

export const FLOOR = "#EEEEEE";
export const FLOOR_EDGE = "#A7A7A8";
export const GRID = "#D8D8D8";

/** The two walls differ slightly so the back corner reads without lighting. */
export const WALL_LEFT = "#F4F4F4";
export const WALL_RIGHT = "#E9E9E9";
export const WALL_EDGE = "#C9C9C9";

/** The old canvas's white tile outline, and its cyan selection. */
export const EDGE = "#FFFFFF";
export const SELECT = "#00B1EA";
