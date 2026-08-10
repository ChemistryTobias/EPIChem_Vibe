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
  createZoneArea,
  deleteNode,
  placeLabOnSite,
  placeZoneArea,
  reshapeStation,
  resizeLabCanvas,
  resizeSiteCanvas,
  setStationVirtual,
} from "../../api/topology";
import type { ZoneRect } from "../../api/topology";
import { createDevice, placeDeviceInStation, setDeviceVirtual } from "../../api/devices";
import type { HierarchyKind } from "../../api/topology";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import type { Box, BoxFill, CanvasModel, FloorPos, Outline, ZoneShape } from "./isometric";
import { rectContainsBox, sortBoxes } from "./isometric";

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
  /** Which site floor the site level is showing (ADR 0013); 0 for single-floor. */
  floor: number;
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
  /** The footprint a newly-added child gets, in the level's canvas units. */
  standardSize: { x: number; y: number };
  /** The height a newly-added child gets (0 at the site level — labs have none). */
  nominalHeight: number;
  /** Floor + boxes for the current context. */
  model: CanvasModel;
  /** The floor's own size, for the floor-resize form. */
  floor: FloorGeometry;
  /** Whether this level can be entered at all (needs its parent context). */
  ready: boolean;
  /** Move+reshape a box (drag, handles, or numeric form), in canvas units. */
  setGeometry: (code: string, geom: BoxGeometry) => Promise<unknown>;
  /**
   * Persist a new child. With no args it lands at the origin at the standard
   * size (the hierarchy-style create); the layout editor passes the code it
   * pre-assigned and the geometry it was dropped at, so a staged create commits
   * in one call. Resolves to the new code.
   */
  create: (opts?: { code?: string; geom?: BoxGeometry }) => Promise<string>;
  /** Next free child code, avoiding both persisted rows and `alreadyStaged` ones
   * — so the editor can pre-assign a real code to a staged create. */
  nextChildCode: (alreadyStaged: string[]) => string;
  /** Remove a box — hard delete (labs) or soft-hide (stations/devices). */
  remove: (code: string) => Promise<unknown>;
  /** Resize the floor/grid itself. */
  resizeFloor: (floor: FloorGeometry) => Promise<unknown>;
  /** Drill into a box → the context patch to descend, or null if it's the leaf. */
  drillInto: (code: string) => Partial<LevelContext> | null;
  /** The current box's geometry, for prefilling the numeric form. */
  geometryOf: (code: string) => BoxGeometry | null;
  /** Weak footprints one level down (stations in labs / devices in stations),
   * projected into this level's canvas — context only, never interactive. */
  outlines: Outline[];
  /** The full registry row for a child box, so the layout inspector can show the
   * *same* record the Hierarchy inspector does (null for a not-yet-saved box). */
  rowOf: (code: string) => Site | Lab | Zone | Station | Device | null;
  /** Codes of a child's own children, for the inspector's "contains" summary. */
  childCodesOf: (code: string) => string[];
  // ---- zones (ADR 0015): flat 2D areas scoped to this level ----------------
  /** Zones on this floor, with geometric membership; empty where zones don't
   * apply (the station level). */
  zones: ZoneShape[];
  /** Whether this level supports zones at all (site + lab, not station). */
  zonesEnabled: boolean;
  /** The zone registry row, for the zone inspector. */
  zoneRowOf: (code: string) => Zone | null;
  /** Next free zone code, avoiding existing rows. */
  nextZoneCode: () => string;
  /** Create a zone at `rect`, scoped to this level. Resolves to the new code. */
  createZone: (code: string, rect: ZoneRect) => Promise<unknown>;
  /** Move/resize a zone's rectangle. */
  placeZone: (code: string, rect: ZoneRect) => Promise<unknown>;
}

/**
 * Build the zone shapes for a level: the level's zones plus, per zone, the codes
 * of the boxes whose footprint is fully inside it (geometric membership, ADR
 * 0015). Shared by the site and lab levels (the station level has no zones).
 */
function zoneShapes(rows: Zone[], boxes: Box[]): ZoneShape[] {
  return rows
    // 0×0 zones are classification-only (ADR 0015) — not drawn on the canvas.
    .filter((z) => z.width_m > 0 && z.depth_m > 0)
    .map((z) => {
      const pos = { x: z.pos_x, y: z.pos_y };
      const size = { x: z.width_m, y: z.depth_m };
      const members = boxes
        .filter((b) => rectContainsBox(pos, size, b.pos, b.size))
        .map((b) => b.code);
      return { code: z.code, label: z.code, purpose: z.purpose, pos, size, members };
    });
}

// ---- fills (DESIGN.md brand palette) ---------------------------------------

const GREY: BoxFill = { top: "#A7A7A8", left: "#8E8E8F", right: "#767677" };
// Labs are drawn *flat and translucent, like a zone* (req: "I like the labs as
// transparent as the zones") — a faint blue wash with a dashed blue border, so
// the floor grid and the station hints on top read straight through it.
const LAB_FILL: BoxFill = {
  top: "rgba(0, 177, 234, 0.14)",
  left: "rgba(0, 144, 190, 0.14)",
  right: "rgba(0, 112, 143, 0.14)",
  stroke: "rgba(0, 144, 190, 0.9)",
  dash: "6,4",
};

/** Box fill for a device/station by the bound device's operational mode. */
export function fillForMode(mode: string | null): BoxFill {
  if (mode === null) return GREY;
  if (mode === "maintenance") return { top: "#EF7C00", left: "#C66700", right: "#A35400" };
  if (mode === "disabled") return { top: "#777777", left: "#5F5F5F", right: "#4D4D4D" };
  if (mode === "read_only") return { top: "#29485D", left: "#1F3747", right: "#182B37" };
  return { top: "#006C66", left: "#005553", right: "#00413F" };
}

// ---- unit helpers ----------------------------------------------------------

// Labs are drawn *flat* like zones — only stations (and devices) get a 3D box, so
// a lab box never obscures the station hints on top of it (req). Labs have no
// height column anyway; 0 renders the footprint flat on the site floor.
const NOMINAL_LAB_HEIGHT_M = 0;
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
  return siteLevel(ctx.site, data, ctx.floor);
}

function siteLevel(site: Site | null, data: LayoutData, viewFloor: number): LevelConfig {
  // Only the current floor's labs are boxes on the plan (ADR 0013): a single-floor
  // site has every lab on floor 0, so this is a no-op there.
  const labs = site ? data.labs.filter((l) => l.site_id === site.id && l.floor === viewFloor) : [];
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
  // Site-scoped zones (ADR 0015) live on the site plan.
  const zoneRows = site ? data.zones.filter((z) => z.site_id === site.id) : [];

  // One level down: each lab's stations, scaled from the lab's own floor into the
  // box the lab occupies on the site (site footprint can differ from lab floor).
  const outlines: Outline[] = [];
  for (const lab of labs) {
    const fw = lab.width_m || 1;
    const fd = lab.depth_m || 1;
    for (const s of data.stations) {
      if (s.lab_id !== lab.id || s.virtual) continue;
      outlines.push({
        code: s.code,
        parentCode: lab.code,
        // Labs are flat, so the station hints sit on the lab's flat top (height 0).
        height: NOMINAL_LAB_HEIGHT_M,
        pos: {
          x: lab.site_pos_x + (s.pos_x / fw) * lab.site_size_x_m,
          y: lab.site_pos_y + (s.pos_y / fd) * lab.site_size_y_m,
        },
        size: { x: (s.size_x_m / fw) * lab.site_size_x_m, y: (s.size_y_m / fd) * lab.site_size_y_m },
      });
    }
  }

  return {
    level: "site",
    childLabel: "lab",
    childKind: "Lab",
    // Labs have no `virtual` flag (ADR 0011 is stations/devices), so the site
    // level hard-deletes rather than soft-hides.
    removeVerb: "Delete",
    isLeaf: false,
    standardSize: { x: 10, y: 10 },
    nominalHeight: NOMINAL_LAB_HEIGHT_M,
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
    create: async (opts) => {
      const code = opts?.code ?? nextCode("LAB", new Set(data.labs.map((l) => l.code)));
      const g = opts?.geom;
      await createLab(code, `New lab ${code}`, {
        site: site!.code,
        room_number: null,
        environment_class: "ambient",
        // Land on the floor being viewed (ADR 0013), not always floor 0 — else a
        // lab created on floor 2 would vanish from the current plan.
        floor: viewFloor,
        ...(g && {
          // Floor tracks the footprint (see placeLabOnSite) — a new lab's own
          // floor equals the box it occupies on the site.
          width_m: g.size.x,
          depth_m: g.size.y,
          site_pos_x: g.pos.x,
          site_pos_y: g.pos.y,
          site_size_x_m: g.size.x,
          site_size_y_m: g.size.y,
        }),
      });
      return code;
    },
    nextChildCode: (staged) => nextCode("LAB", new Set([...data.labs.map((l) => l.code), ...staged])),
    remove: (code) => deleteNode("Lab", code),
    resizeFloor: (f) => resizeSiteCanvas(site!, { width_m: f.widthU, depth_m: f.depthU, grid_size_m: f.gridU }),
    drillInto: (code) => {
      const l = byCode.get(code);
      return l ? { lab: l } : null;
    },
    outlines,
    rowOf: (code) => byCode.get(code) ?? null,
    childCodesOf: (code) => {
      const l = byCode.get(code);
      return l ? data.stations.filter((s) => s.lab_id === l.id && !s.virtual).map((s) => s.code) : [];
    },
    zones: zoneShapes(zoneRows, boxes),
    zonesEnabled: site !== null,
    zoneRowOf: (code) => zoneRows.find((z) => z.code === code) ?? null,
    nextZoneCode: () => nextCode("ZONE", new Set(data.zones.map((z) => z.code))),
    createZone: (code, rect) =>
      createZoneArea("site", site!.code, code, `Zone ${code}`, rect, "area"),
    placeZone: (code, rect) => {
      const z = zoneRows.find((zz) => zz.code === code)!;
      return placeZoneArea(z, "site", site!.code, rect);
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
  // Lab-scoped zones (ADR 0015) live on the lab plan.
  const zoneRows = data.zones.filter((z) => z.lab_id === lab.id);

  // One level down: each station's devices, placed by their mm pose within the
  // station's own footprint (station canvas units are metres, so mm ÷ 1000
  // offsets straight onto the lab floor at the station's position).
  const outlines: Outline[] = [];
  for (const s of stations) {
    for (const d of data.devices) {
      if (d.station_code !== s.code || d.virtual) continue;
      outlines.push({
        code: d.code,
        parentCode: s.code,
        // Stations are 3D, so device hints ride on the station's top face.
        height: s.height_m,
        pos: { x: s.pos_x + (d.pose_x_mm ?? 0) / MM_PER_M, y: s.pos_y + (d.pose_y_mm ?? 0) / MM_PER_M },
        size: {
          x: (d.size_x_mm ?? DEFAULT_DEVICE_SIZE_M * MM_PER_M) / MM_PER_M,
          y: (d.size_y_mm ?? DEFAULT_DEVICE_SIZE_M * MM_PER_M) / MM_PER_M,
        },
      });
    }
  }
  const zoneCodeOf = (s: Station) =>
    s.zone_id ? (data.zones.find((z) => z.id === s.zone_id)?.code ?? null) : null;

  return {
    level: "lab",
    childLabel: "station",
    childKind: "Station",
    removeVerb: "Hide",
    isLeaf: false,
    standardSize: { x: 1, y: 1 },
    nominalHeight: 0.5,
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
    create: async (opts) => {
      const code = opts?.code ?? nextCode("ST", new Set(data.stations.map((s) => s.code)));
      const g = opts?.geom;
      await createStation(code, `New station ${code}`, {
        lab: lab.code,
        zone: null,
        kind: "generic",
        capacity: 1,
        state: "active",
        owning_group: null,
        ...(g && {
          pos_x: g.pos.x,
          pos_y: g.pos.y,
          size_x_m: g.size.x,
          size_y_m: g.size.y,
          height_m: g.height,
        }),
      });
      return code;
    },
    nextChildCode: (staged) =>
      nextCode("ST", new Set([...data.stations.map((s) => s.code), ...staged])),
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
    outlines,
    rowOf: (code) => byCode.get(code) ?? null,
    childCodesOf: (code) => {
      const s = byCode.get(code);
      return s ? data.devices.filter((d) => d.station_code === s.code && !d.virtual).map((d) => d.code) : [];
    },
    zones: zoneShapes(zoneRows, boxes),
    zonesEnabled: true,
    zoneRowOf: (code) => zoneRows.find((z) => z.code === code) ?? null,
    nextZoneCode: () => nextCode("ZONE", new Set(data.zones.map((z) => z.code))),
    createZone: (code, rect) => createZoneArea("lab", lab.code, code, `Zone ${code}`, rect, "area"),
    placeZone: (code, rect) => {
      const z = zoneRows.find((zz) => zz.code === code)!;
      return placeZoneArea(z, "lab", lab.code, rect);
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
    standardSize: { x: DEFAULT_DEVICE_SIZE_M, y: DEFAULT_DEVICE_SIZE_M },
    nominalHeight: DEFAULT_DEVICE_SIZE_M,
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
    create: async (opts) => {
      const code = opts?.code ?? nextCode("DEV", new Set(data.devices.map((d) => d.code)));
      const g = opts?.geom;
      await createDevice({
        code,
        name: `New device ${code}`,
        node_kind: "device",
        capability_class: null,
        station: station.code,
        operational_mode: "read_write",
        ...(g && {
          pose_x_mm: g.pos.x * MM_PER_M,
          pose_y_mm: g.pos.y * MM_PER_M,
          size_x_mm: g.size.x * MM_PER_M,
          size_y_mm: g.size.y * MM_PER_M,
          size_z_mm: g.height * MM_PER_M,
        }),
      });
      return code;
    },
    nextChildCode: (staged) =>
      nextCode("DEV", new Set([...data.devices.map((d) => d.code), ...staged])),
    remove: (code) => {
      const d = byCode.get(code)!;
      return setDeviceVirtual(d, parentCodeOf(d), true);
    },
    // A station's floor is its own footprint (edited at the lab level / geometry
    // form), so there's no separate "resize floor" here — reshape the station box.
    resizeFloor: () => Promise.resolve(),
    drillInto: () => null, // devices are the leaf level
    outlines: [], // nothing below a device is drawn (only one level down)
    rowOf: (code) => byCode.get(code) ?? null,
    childCodesOf: (code) => {
      const d = byCode.get(code);
      return d ? data.devices.filter((c) => c.parent_id === d.id && !c.virtual).map((c) => c.code) : [];
    },
    // Zones are a site/lab concept (ADR 0015); the station level has none.
    zones: [],
    zonesEnabled: false,
    zoneRowOf: () => null,
    nextZoneCode: () => nextCode("ZONE", new Set(data.zones.map((z) => z.code))),
    createZone: () => Promise.resolve(),
    placeZone: () => Promise.resolve(),
  };
}
