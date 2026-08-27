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

import { devicesApi, labsApi, modulesApi, sitesApi, stationsApi } from "../../../api/entities";
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
import { FILL_ACTIVE, FILL_GREY, LAB, type BoxFill } from "./palette";

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

export interface LayoutBox {
  uuid: string;
  kind: EntityKind;
  name: string;
  rect: Rect;
  /** Metres tall. Zero draws the footprint flat on the floor. */
  height: number;
  fill: BoxFill;
  /** Labs draw as a translucent wash rather than a solid box. */
  flat: boolean;
  row: EntityRow;
  /** The geometry to PATCH back, with everything but the numbers preserved. */
  geometry: GeometryDescriptor;
}

export interface LayoutZone {
  uuid: string;
  name: string;
  rect: Rect;
}

export interface LevelModel {
  level: Level;
  /** Floor extent in metres. */
  size: Vec2;
  grid: number;
  boxes: LayoutBox[];
  zones: LayoutZone[];
  /** What a box at this level is, for labels and empty states. */
  childLabel: string;
  /** The entity an Add on this level creates. */
  childKind: EntityKind;
}

/** Backend Z-up geometry → a floor footprint plus a height, in metres. */
function rectOf(g: GeometryDescriptor): { rect: Rect; height: number } {
  const [x, y] = g.box_position_xyz;
  const [w, d, h] = g.box_dimension_xyz;
  return { rect: { pos: { x, y }, size: { x: w, y: d } }, height: h };
}

/** A gridline every ~1/20th of the floor, rounded to something human. */
function gridFor(span: number): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  return steps.find((s) => span / s <= 24) ?? 10;
}

const box = (
  kind: EntityKind,
  row: EntityRow & { object_geometry: GeometryDescriptor | null },
  fill: BoxFill,
  flat = false,
): LayoutBox | null => {
  if (row.object_geometry === null) return null;
  const { rect, height } = rectOf(row.object_geometry);
  return {
    uuid: row.uuid,
    kind,
    name: row.name,
    rect,
    height: flat ? 0 : height,
    fill,
    flat,
    row,
    geometry: row.object_geometry,
  };
};

const isRect = (g: { box_dimension_xyz: number[] }) => g.box_dimension_xyz[0] > 0;

function zonesOf(rows: Zone[], parentUuid: string): LayoutZone[] {
  return rows
    .filter((z) => z.parent_uuid === parentUuid && z.object_geometry !== null)
    .filter((z) => isRect(z.object_geometry!))
    .map((z) => ({ uuid: z.uuid, name: z.name, rect: rectOf(z.object_geometry!).rect }));
}

/** The level the current context points at, or null when it isn't reachable. */
export function buildLevel(ctx: LevelContext, data: LayoutData): LevelModel | null {
  if (ctx.station) return stationLevel(ctx.station, data);
  if (ctx.lab) return labLevel(ctx.lab, data);
  if (ctx.site) return siteLevel(ctx.site, data, ctx.floor);
  return null;
}

function frame(size: Vec2) {
  return { size, grid: gridFor(Math.max(size.x, size.y)) };
}

function siteLevel(site: Site, data: LayoutData, floor: number): LevelModel | null {
  const plan = site.object_geometry[floor] ?? site.object_geometry[0];
  if (!plan) return null;
  const { rect } = rectOf(plan);
  return {
    level: "site",
    ...frame(rect.size),
    // Labs carry no floor number yet, so every lab draws on whichever floor
    // is showing — the single-floor case, which is all that exists today.
    boxes: data.labs
      .filter((l) => l.site_uuid === site.uuid)
      .map((l) => box("Lab", l, { top: LAB.fill, left: LAB.fill, right: LAB.fill }, true))
      .filter((b): b is LayoutBox => b !== null),
    zones: zonesOf(data.zones, site.uuid),
    childLabel: "lab",
    childKind: "Lab",
  };
}

function labLevel(lab: Lab, data: LayoutData): LevelModel | null {
  if (lab.object_geometry === null) return null;
  const { rect } = rectOf(lab.object_geometry);
  return {
    level: "lab",
    ...frame(rect.size),
    boxes: data.stations
      .filter((s) => s.lab_uuid === lab.uuid)
      .map((s) => box("Station", s, FILL_ACTIVE))
      .filter((b): b is LayoutBox => b !== null),
    zones: zonesOf(data.zones, lab.uuid),
    childLabel: "station",
    childKind: "Station",
  };
}

function stationLevel(station: Station, data: LayoutData): LevelModel | null {
  if (station.object_geometry === null) return null;
  const { rect } = rectOf(station.object_geometry);
  return {
    level: "station",
    ...frame(rect.size),
    boxes: [
      ...data.modules
        .filter((m) => m.station_uuid === station.uuid)
        .map((m) => box("Module", m, FILL_GREY)),
      ...data.devices
        .filter((d) => d.station_uuid === station.uuid)
        .map((d) => box("Device", d, FILL_ACTIVE)),
    ].filter((b): b is LayoutBox => b !== null),
    zones: [],
    childLabel: "device",
    childKind: "Device",
  };
}

/** Which endpoint owns a box, for writing its geometry back. */
export const API_FOR: Record<
  string,
  { update: (id: string, body: unknown) => Promise<unknown>; remove: (id: string) => Promise<unknown> }
> = {
  Site: sitesApi,
  Lab: labsApi,
  Station: stationsApi,
  Module: modulesApi,
  Device: devicesApi,
};

/** The context patch that descends into a box, or null at the leaf. */
export function drillInto(model: LevelModel, box: LayoutBox): Partial<LevelContext> | null {
  if (model.level === "site") return { lab: box.row as Lab, station: null };
  if (model.level === "lab") return { station: box.row as Station };
  return null;
}
