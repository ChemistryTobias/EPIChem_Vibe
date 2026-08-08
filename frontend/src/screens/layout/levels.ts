/**
 * The three layout levels, as data — the *only* place site/lab/station differ.
 *
 * The canvas, the drag/handle interaction and the inspector are one generic
 * implementation over `Box`/`CanvasModel` (`isometric.ts`, `useIsometricPaper`,
 * `LayoutScreen`). A level is nothing more than: which rows become boxes, what
 * unit they're in, and which write endpoint a drag/create/delete calls. This
 * module builds that `LevelConfig` so the rest of the editor never branches on
 * the level (ADR 0012 gave every level the geometry to make this possible).
 *
 *   Site  → labs are boxes on the site floor (metres)
 *   Lab   → stations are boxes on the lab floor (metres)
 *   Station → devices/modules are boxes on the station floor (mm, shown as metres)
 */

import {
  createLab,
  createStation,
  deleteNode,
  placeLabOnSite,
  reshapeStation,
  resizeLabCanvas,
  resizeSiteCanvas,
  setStationVirtual,
} from "../../api/topology";
import { createDevice, placeDeviceInStation, setDeviceVirtual } from "../../api/devices";
import type { HierarchyKind } from "../../api/topology";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import type { Box, BoxFill, CanvasModel, FloorPos } from "./isometric";
import { sortBoxes } from "./isometric";

export type Level = "site" | "lab" | "station";

/** Everything the layout screen fetches once, shared by every level. */
export interface LayoutData {
  sites: Site[];
  labs: Lab[];
  zones: Zone[];
  stations: Station[];
  devices: Device[];
}

/** Where in the hierarchy the editor currently is. */
export interface LevelContext {
  site: Site | null;
  lab: Lab | null;
  station: Station | null;
}

/** A box's full geometry in the level's canvas units (metres on screen). */
export interface BoxGeometry {
  pos: FloorPos;
  size: { x: number; y: number };
  height: number;
}

/** The floor's own dimensions, in the level's canvas units. */
export interface FloorGeometry {
  widthU: number;
  depthU: number;
  gridU: number;
}

/**
 * One level's behaviour. The screen holds a `LevelConfig` and never asks what
 * level it is — it just renders `model`, and calls `setGeometry`/`create`/
 * `remove`/`resizeFloor`/`drillInto` on interaction.
 */
export interface LevelConfig {
  level: Level;
  /** Human label for the child kind, e.g. "station". */
  childLabel: string;
  /** The child's registry kind, for the revision-history lookup. */
  childKind: HierarchyKind;
  /** "Delete" (hard) at the site level, "Hide" (soft) where `virtual` exists. */
  removeVerb: "Delete" | "Hide";
  /** True at the deepest level (station → devices), where a box can't be entered. */
  isLeaf: boolean;
  /** Floor + boxes for the current context. */
  model: CanvasModel;
  /** The floor's own size, for the floor-resize form. */
  floor: FloorGeometry;
  /** Whether this level can be entered at all (needs its parent context). */
  ready: boolean;
  /** Move+reshape a box (drag, handles, or numeric form), in canvas units. */
  setGeometry: (code: string, geom: BoxGeometry) => Promise<unknown>;
  /** Add a standard-size child at the origin; resolves to its new code. */
  create: () => Promise<string>;
  /** Remove a box — hard delete (labs) or soft-hide (stations/devices). */
  remove: (code: string) => Promise<unknown>;
  /** Resize the floor/grid itself. */
  resizeFloor: (floor: FloorGeometry) => Promise<unknown>;
  /** Drill into a box → the context patch to descend, or null if it's the leaf. */
  drillInto: (code: string) => Partial<LevelContext> | null;
  /** The current box's geometry, for prefilling the numeric form. */
  geometryOf: (code: string) => BoxGeometry | null;
}

// ---- fills (DESIGN.md brand palette) ---------------------------------------

const GREY: BoxFill = { top: "#A7A7A8", left: "#8E8E8F", right: "#767677" };
const LAB_FILL: BoxFill = { top: "#00B1EA", left: "#0090BE", right: "#00708F" };

/** Box fill for a device/station by the bound device's operational mode. */
export function fillForMode(mode: string | null): BoxFill {
  if (mode === null) return GREY;
  if (mode === "maintenance") return { top: "#EF7C00", left: "#C66700", right: "#A35400" };
  if (mode === "disabled") return { top: "#777777", left: "#5F5F5F", right: "#4D4D4D" };
  if (mode === "read_only") return { top: "#29485D", left: "#1F3747", right: "#182B37" };
  return { top: "#006C66", left: "#005553", right: "#00413F" };
}

// ---- unit helpers ----------------------------------------------------------

const NOMINAL_LAB_HEIGHT_M = 1.0; // labs have no height column; a low wall reads as a room
const MM_PER_M = 1000;
const DEFAULT_DEVICE_SIZE_M = 0.1; // 100 mm standard, when a device has no footprint yet

/** Next free `PREFIX-NN` code not already taken (zero-padded to 2). */
function nextCode(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const code = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
}

// ---- the three levels ------------------------------------------------------

export function buildLevel(ctx: LevelContext, data: LayoutData): LevelConfig {
  if (ctx.station) return stationLevel(ctx.station, ctx.lab, data);
  if (ctx.lab) return labLevel(ctx.lab, ctx.site, data);
  return siteLevel(ctx.site, data);
}

function siteLevel(site: Site | null, data: LayoutData): LevelConfig {
  const labs = site ? data.labs.filter((l) => l.site_id === site.id) : [];
  const boxes: Box[] = sortBoxes(
    labs.map((lab) => ({
      code: lab.code,
      pos: { x: lab.site_pos_x, y: lab.site_pos_y },
      size: { x: lab.site_size_x_m, y: lab.site_size_y_m },
      height: NOMINAL_LAB_HEIGHT_M,
      fill: LAB_FILL,
      label: lab.code,
      badge: data.stations.some((s) => s.lab_id === lab.id),
    })),
  );
  const floor: FloorGeometry = {
    widthU: site?.width_m ?? 40,
    depthU: site?.depth_m ?? 40,
    gridU: site?.grid_size_m ?? 1,
  };
  const byCode = new Map(labs.map((l) => [l.code, l]));

  return {
    level: "site",
    childLabel: "lab",
    childKind: "Lab",
    // Labs have no `virtual` flag (ADR 0011 is stations/devices), so the site
    // level hard-deletes rather than soft-hides.
    removeVerb: "Delete",
    isLeaf: false,
    model: { ...floor, boxes },
    floor,
    ready: site !== null,
    geometryOf: (code) => {
      const l = byCode.get(code);
      return l
        ? { pos: { x: l.site_pos_x, y: l.site_pos_y }, size: { x: l.site_size_x_m, y: l.site_size_y_m }, height: NOMINAL_LAB_HEIGHT_M }
        : null;
    },
    setGeometry: (code, g) => {
      const l = byCode.get(code)!;
      return placeLabOnSite(l, site!.code, {
        site_pos_x: g.pos.x,
        site_pos_y: g.pos.y,
        site_size_x_m: g.size.x,
        site_size_y_m: g.size.y,
      });
    },
    create: async () => {
      const code = nextCode("LAB", new Set(data.labs.map((l) => l.code)));
      await createLab(code, `New lab ${code}`, {
        site: site!.code,
        room_number: null,
        environment_class: "ambient",
      });
      return code;
    },
    remove: (code) => deleteNode("Lab", code),
    resizeFloor: (f) => resizeSiteCanvas(site!, { width_m: f.widthU, depth_m: f.depthU, grid_size_m: f.gridU }),
    drillInto: (code) => {
      const l = byCode.get(code);
      return l ? { lab: l } : null;
    },
  };
}

function labLevel(lab: Lab, site: Site | null, data: LayoutData): LevelConfig {
  const siteCode = site?.code ?? data.sites.find((s) => s.id === lab.site_id)?.code ?? "";
  const deviceByStation = new Map<string, Device>();
  for (const d of data.devices) {
    if (d.station_code && !d.virtual && !deviceByStation.has(d.station_code)) {
      deviceByStation.set(d.station_code, d);
    }
  }
  const stations = data.stations.filter((s) => s.lab_id === lab.id && !s.virtual);
  const boxes: Box[] = sortBoxes(
    stations.map((s) => {
      const dev = deviceByStation.get(s.code) ?? null;
      return {
        code: s.code,
        pos: { x: s.pos_x, y: s.pos_y },
        size: { x: s.size_x_m, y: s.size_y_m },
        height: s.height_m,
        fill: fillForMode(dev?.operational_mode ?? null),
        label: s.code,
        badge: dev !== null,
      };
    }),
  );
  const floor: FloorGeometry = { widthU: lab.width_m, depthU: lab.depth_m, gridU: lab.grid_size_m };
  const byCode = new Map(stations.map((s) => [s.code, s]));
  const zoneCodeOf = (s: Station) =>
    s.zone_id ? (data.zones.find((z) => z.id === s.zone_id)?.code ?? null) : null;

  return {
    level: "lab",
    childLabel: "station",
    childKind: "Station",
    removeVerb: "Hide",
    isLeaf: false,
    model: { ...floor, boxes },
    floor,
    ready: true,
    geometryOf: (code) => {
      const s = byCode.get(code);
      return s
        ? { pos: { x: s.pos_x, y: s.pos_y }, size: { x: s.size_x_m, y: s.size_y_m }, height: s.height_m }
        : null;
    },
    setGeometry: (code, g) => {
      const s = byCode.get(code)!;
      return reshapeStation(s, lab.code, zoneCodeOf(s), {
        pos_x: g.pos.x,
        pos_y: g.pos.y,
        size_x_m: g.size.x,
        size_y_m: g.size.y,
        height_m: g.height,
      });
    },
    create: async () => {
      const code = nextCode("ST", new Set(data.stations.map((s) => s.code)));
      await createStation(code, `New station ${code}`, {
        lab: lab.code,
        zone: null,
        kind: "generic",
        capacity: 1,
        state: "active",
        owning_group: null,
      });
      return code;
    },
    remove: (code) => {
      const s = byCode.get(code)!;
      return setStationVirtual(s, lab.code, zoneCodeOf(s), true);
    },
    resizeFloor: (f) =>
      resizeLabCanvas(lab, siteCode, { width_m: f.widthU, depth_m: f.depthU, grid_size_m: f.gridU }),
    drillInto: (code) => {
      const s = byCode.get(code);
      return s ? { station: s } : null;
    },
  };
}

function stationLevel(station: Station, _lab: Lab | null, data: LayoutData): LevelConfig {
  // The station's own footprint is the floor; devices sit within it, in mm shown
  // as metres (÷1000). An unplaced device renders at the standard 0.1 m default.
  const devices = data.devices.filter((d) => d.station_code === station.code && !d.virtual);
  const parentCodeOf = (d: Device) =>
    d.parent_id ? (data.devices.find((p) => p.id === d.parent_id)?.code ?? null) : null;

  const mToBox = (d: Device): Box => ({
    code: d.code,
    pos: { x: (d.pose_x_mm ?? 0) / MM_PER_M, y: (d.pose_y_mm ?? 0) / MM_PER_M },
    size: {
      x: (d.size_x_mm ?? DEFAULT_DEVICE_SIZE_M * MM_PER_M) / MM_PER_M,
      y: (d.size_y_mm ?? DEFAULT_DEVICE_SIZE_M * MM_PER_M) / MM_PER_M,
    },
    height: (d.size_z_mm ?? DEFAULT_DEVICE_SIZE_M * MM_PER_M) / MM_PER_M,
    fill: fillForMode(d.operational_mode),
    label: d.code,
    badge: data.devices.some((c) => c.parent_id === d.id),
  });
  const boxes = sortBoxes(devices.map(mToBox));
  const floor: FloorGeometry = {
    widthU: station.size_x_m,
    depthU: station.size_y_m,
    // A tenth of the footprint is a sensible device grid; keep it from hitting 0.
    gridU: Math.max(station.size_x_m / 10, 0.05),
  };
  const byCode = new Map(devices.map((d) => [d.code, d]));

  return {
    level: "station",
    childLabel: "device",
    childKind: "Device",
    removeVerb: "Hide",
    isLeaf: true,
    model: { ...floor, boxes },
    floor,
    ready: true,
    geometryOf: (code) => {
      const d = byCode.get(code);
      return d ? { pos: mToBox(d).pos, size: mToBox(d).size, height: mToBox(d).height } : null;
    },
    setGeometry: (code, g) => {
      const d = byCode.get(code)!;
      return placeDeviceInStation(d, parentCodeOf(d), {
        pose_x_mm: g.pos.x * MM_PER_M,
        pose_y_mm: g.pos.y * MM_PER_M,
        size_x_mm: g.size.x * MM_PER_M,
        size_y_mm: g.size.y * MM_PER_M,
        size_z_mm: g.height * MM_PER_M,
      });
    },
    create: async () => {
      const code = nextCode("DEV", new Set(data.devices.map((d) => d.code)));
      await createDevice({
        code,
        name: `New device ${code}`,
        node_kind: "device",
        capability_class: null,
        station: station.code,
        operational_mode: "read_write",
      });
      return code;
    },
    remove: (code) => {
      const d = byCode.get(code)!;
      return setDeviceVirtual(d, parentCodeOf(d), true);
    },
    // A station's floor is its own footprint (edited at the lab level / geometry
    // form), so there's no separate "resize floor" here — reshape the station box.
    resizeFloor: () => Promise.resolve(),
    drillInto: () => null, // devices are the leaf level
  };
}
