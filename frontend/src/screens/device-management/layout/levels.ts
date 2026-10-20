/**
 * Turns registry rows into a floor and the boxes standing on it — one adapter
 * per level, exactly the contract the old editor's `levels.ts` had:
 *
 *     site    → the site's floor, labs on it
 *     lab     → the lab's floor, stations on it
 *     station → the station's floor, its modules and devices on it
 *
 * Every level is the same thing: boxes on a metric floor. The canvas knows
 * nothing about what a box *is*, which is what lets one renderer serve all
 * three.
 *
 * **The one axis conversion in the app lives here.** The backend is Z-up
 * (`box_*_xyz` = across, depth, height); three.js is Y-up. `rectOf` is the
 * only place that mapping happens — do it anywhere else and the two
 * conventions will drift.
 */

import type {
  Device,
  EntityKind,
  EntityRow,
  GeometryDescriptor,
  Lab,
  Module,
  Site,
  Station,
  Zone,
} from "../../../api/types";
import type { Rect, Vec2 } from "./constraints";
import { FILL_ACTIVE, FILL_GREY, LAB, ZONE, type BoxFill, type Wash } from "./palette";

export type Level = "site" | "lab" | "station";

/** Everything the screen fetches once, shared by every level. */
export interface LayoutData {
  sites: Site[];
  labs: Lab[];
  zones: Zone[];
  stations: Station[];
  modules: Module[];
  devices: Device[];
}

/** Where in the hierarchy the editor currently is. */
export interface LevelContext {
  site: Site | null;
  lab: Lab | null;
  station: Station | null;
  /** Which of a site's floors is showing; 0 for a single-floor site. */
  floor: number;
}

/**
 * Which boxes may not overlap. Solids (labs on a site, stations, modules,
 * devices) keep off each other; zones are areas drawn *around* solids, so they
 * only keep off other zones.
 */
export type Layer = "solid" | "zone";

export interface LayoutBox {
  uuid: string;
  kind: EntityKind;
  name: string;
  rect: Rect;
  /** Metres tall. Zero draws the footprint flat on the floor. */
  height: number;
  fill: BoxFill;
  /** Labs and zones draw as a translucent wash rather than a solid box. */
  flat: boolean;
  /** The wash colours, for a flat box. */
  wash?: Wash;
  layer: Layer;
  /** The primitive the geometry asks for — the renderer's one switch point
   * for what a body looks like (see `Body` in Scene.tsx). */
  shape: GeometryDescriptor["shape"];
  /** Whether its name drills down a level. */
  enterable: boolean;
  row: EntityRow;
  /** The geometry to PATCH back, with everything but the numbers preserved. */
  geometry: GeometryDescriptor;
}

export interface LevelModel {
  level: Level;
  /** Floor extent in metres. */
  size: Vec2;
  grid: number;
  /** Everything on this floor, zones included (they're boxes on the zone
   * layer). */
  boxes: LayoutBox[];
  /** What a box at this level is, for labels and empty states. */
  childLabel: string;
  /** What an Add on this level can create, the main kind first. */
  addable: EntityKind[];
}

/** Backend Z-up geometry → a floor footprint plus a height, in metres. */
function rectOf(g: GeometryDescriptor): { rect: Rect; height: number } {
  const [x, y] = g.box_position_xyz;
  const [w, d, h] = g.box_dimension_xyz;
  return { rect: { pos: { x, y }, size: { x: w, y: d } }, height: h };
}

/**
 * The grid, in metres, per level. Fixed rather than derived from the floor's
 * size: a grid that rescaled as you resized the floor moved every gridline
 * under whatever you were placing, and a metre has to stay a metre for the
 * spacing to mean anything.
 *
 * A settings screen can overwrite these later — one object, one place.
 */
export const GRID_SIZES: Record<Level, number> = {
  site: 1,
  lab: 0.5,
  station: 0.05,
};

const box = (
  kind: EntityKind,
  row: EntityRow & { object_geometry: GeometryDescriptor | null },
  fill: BoxFill,
  options: { wash?: Wash; layer?: Layer; enterable?: boolean } = {},
): LayoutBox | null => {
  if (row.object_geometry === null) return null;
  const { rect, height } = rectOf(row.object_geometry);
  const flat = options.wash !== undefined;
  return {
    uuid: row.uuid,
    kind,
    name: row.name,
    rect,
    height: flat ? 0 : height,
    fill,
    flat,
    wash: options.wash,
    layer: options.layer ?? "solid",
    shape: row.object_geometry.shape ?? "rectangle",
    enterable: options.enterable ?? false,
    row,
    geometry: row.object_geometry,
  };
};

const isRect = (g: { box_dimension_xyz: number[] }) => g.box_dimension_xyz[0] > 0;

function zonesOf(rows: Zone[], parentUuid: string): LayoutBox[] {
  return rows
    .filter((z) => z.parent_uuid === parentUuid && z.object_geometry !== null)
    .filter((z) => isRect(z.object_geometry!))
    .map((z) => box("Zone", z, FILL_GREY, { wash: ZONE, layer: "zone" }))
    .filter((b): b is LayoutBox => b !== null);
}

const present = (b: LayoutBox | null): b is LayoutBox => b !== null;

/** The level the current context points at, or null when it isn't reachable. */
export function buildLevel(ctx: LevelContext, data: LayoutData): LevelModel | null {
  if (ctx.station) return stationLevel(ctx.station, data);
  if (ctx.lab) return labLevel(ctx.lab, data);
  if (ctx.site) return siteLevel(ctx.site, data, ctx.floor);
  return null;
}

function frame(level: Level, size: Vec2) {
  return { size, grid: GRID_SIZES[level] };
}

function siteLevel(site: Site, data: LayoutData, floor: number): LevelModel | null {
  const plan = site.object_geometry[floor] ?? site.object_geometry[0];
  if (!plan) return null;
  const { rect } = rectOf(plan);
  return {
    level: "site",
    ...frame("site", rect.size),
    // Labs carry no floor number yet, so every lab draws on whichever floor
    // is showing — the single-floor case, which is all that exists today.
    boxes: [
      ...zonesOf(data.zones, site.uuid),
      ...data.labs
        .filter((l) => l.site_uuid === site.uuid)
        .map((l) => box("Lab", l, FILL_ACTIVE, { wash: LAB, enterable: true }))
        .filter(present),
    ],
    childLabel: "lab",
    addable: ["Lab", "Zone"],
  };
}

function labLevel(lab: Lab, data: LayoutData): LevelModel | null {
  if (lab.object_geometry === null) return null;
  const { rect } = rectOf(lab.object_geometry);
  return {
    level: "lab",
    ...frame("lab", rect.size),
    boxes: [
      ...zonesOf(data.zones, lab.uuid),
      ...data.stations
        .filter((s) => s.lab_uuid === lab.uuid)
        .map((s) => box("Station", s, FILL_ACTIVE, { enterable: true }))
        .filter(present),
    ],
    childLabel: "station",
    addable: ["Station", "Zone"],
  };
}

function stationLevel(station: Station, data: LayoutData): LevelModel | null {
  if (station.object_geometry === null) return null;
  const { rect } = rectOf(station.object_geometry);
  return {
    level: "station",
    ...frame("station", rect.size),
    boxes: [
      ...data.modules
        .filter((m) => m.station_uuid === station.uuid)
        .map((m) => box("Module", m, FILL_GREY)),
      ...data.devices
        .filter((d) => d.station_uuid === station.uuid)
        .map((d) => box("Device", d, FILL_ACTIVE)),
    ].filter(present),
    childLabel: "device",
    addable: ["Device", "Module"],
  };
}

/** The context patch that descends into a box, or null at the leaf. */
export function drillInto(model: LevelModel, box: LayoutBox): Partial<LevelContext> | null {
  if (!box.enterable) return null;
  if (model.level === "site") return { lab: box.row as Lab, station: null };
  if (model.level === "lab") return { station: box.row as Station };
  return null;
}
