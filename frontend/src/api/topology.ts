/** Topology endpoints (`backend/epichem/api/routers/topology.py`). */

import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import { listDevices } from "./devices";
import type { Device, Lab, Revision, Site, Station, Zone } from "./types";

/** The five hierarchy kinds, and the URL segment each writes/reads through. */
export type HierarchyKind = "Site" | "Lab" | "Zone" | "Station" | "Device";

const PLURAL: Record<HierarchyKind, string> = {
  Site: "sites",
  Lab: "labs",
  Zone: "zones",
  Station: "stations",
  Device: "devices",
};

export const listSites = () => apiGet<Site[]>("/sites");
export const listLabs = () => apiGet<Lab[]>("/labs");
export const listZones = () => apiGet<Zone[]>("/zones");
export const listStations = () => apiGet<Station[]>("/stations");

/** The whole containment hierarchy in one shot — what the tree view needs. */
export interface TopologySnapshot {
  sites: Site[];
  labs: Lab[];
  zones: Zone[];
  stations: Station[];
  /** Devices/modules, so the Hierarchy nests them under their station (ADR 0009). */
  devices: Device[];
}

/**
 * A handful of parallel list calls rather than one nested endpoint. The
 * registry has no "give me the whole tree" endpoint, and adding one to serve a
 * single screen would be the tail wagging the dog — a lab's topology is small
 * (tens of rows), so flat GETs are cheap and keep the API honest.
 */
export async function fetchTopology(): Promise<TopologySnapshot> {
  const [sites, labs, zones, stations, devices] = await Promise.all([
    listSites(),
    listLabs(),
    listZones(),
    listStations(),
    // High limit rather than paging: the tree needs every device, and a lab
    // has tens.
    listDevices({ limit: 1000 }).then((page) => page.items),
  ]);
  return { sites, labs, zones, stations, devices };
}

/**
 * Move a station's box to a new metric position on its lab canvas (ADR 0010:
 * pos is metres from the lab origin; the footprint and height come along
 * unchanged).
 *
 * `PUT` takes the same `apiVersion/kind/metadata/spec` descriptor envelope the
 * YAML uses (ADR 0004 §3) and is a **full replace** — so every field has to be
 * sent, or the rest reset to their defaults. `labCode`/`zoneCode` can't be read
 * off the station (it carries ids, not the codes the descriptor wants), so the
 * caller passes them; the box size, height and execution binding are read off
 * the station itself and preserved.
 */
// ---- creation (ADR 0009) ---------------------------------------------------
//
// POST takes the same `apiVersion/kind/metadata/spec` descriptor envelope the
// YAML import and the write API share (ADR 0004 §3). Only the fields the create
// forms collect are typed here; everything else the backend spec models default
// (schemas/descriptor.py) — a new lab's canvas geometry, a station's box, a
// device's transport. Placement is the Lab Layout editor's job, not creation's.

/** Wrap a spec in the descriptor envelope the write endpoints expect. */
function descriptor(kind: string, code: string, name: string, spec: object) {
  return { apiVersion: "epichem.dev/v1", kind, metadata: { code, name }, spec };
}

export interface SiteSpecBody {
  address: string | null;
  timezone: string | null;
}

export interface LabSpecBody {
  site: string;
  room_number: string | null;
  environment_class: string;
}

export interface ZoneSpecBody {
  lab: string;
  atmosphere: string;
  occupancy: string;
}

export interface StationSpecBody {
  lab: string;
  zone: string | null;
  kind: string;
  capacity: number;
  state: string;
  owning_group: string | null;
  // Optional placement, in metres (ADR 0010). The hierarchy create form omits
  // these (the backend defaults them); the Lab Layout editor sets them when a
  // station is drawn on the floor.
  pos_x?: number;
  pos_y?: number;
  size_x_m?: number;
  size_y_m?: number;
  height_m?: number;
}

export const createSite = (code: string, name: string, spec: SiteSpecBody) =>
  apiPost<Site>("/sites", descriptor("Site", code, name, spec));

export const createLab = (code: string, name: string, spec: LabSpecBody) =>
  apiPost<Lab>("/labs", descriptor("Lab", code, name, spec));

export const createZone = (code: string, name: string, spec: ZoneSpecBody) =>
  apiPost<Zone>("/zones", descriptor("Zone", code, name, spec));

export const createStation = (code: string, name: string, spec: StationSpecBody) =>
  apiPost<Station>("/stations", descriptor("Station", code, name, spec));

// ---- editing (full-replace PUT) --------------------------------------------
//
// PUT is a *full replace* (ADR 0004 §3): every spec field has to be sent or the
// backend resets it to its default. The edit forms only collect a handful of
// fields, so the spec builders below fold the edited fields over the rest read
// straight off the current row — canvas geometry (edited on the Lab Layout
// screen), a station's box, a zone's hazard flags. They're pure and exported so
// the preservation can be unit-tested without a network round-trip: a dropped
// field here is silent data loss on save.

export interface SiteEdit {
  name: string;
  address: string | null;
  timezone: string | null;
}

export interface LabEdit {
  name: string;
  site: string; // Site.code — allows re-parenting
  room_number: string | null;
  environment_class: string;
}

export interface ZoneEdit {
  name: string;
  lab: string; // Lab.code
  atmosphere: string;
  occupancy: string;
}

export interface StationEdit {
  name: string;
  lab: string; // Lab.code
  zone: string | null; // Zone.code, or null for none
  kind: string;
  capacity: number;
  state: string;
  owning_group: string | null;
}

export const siteEditSpec = (e: SiteEdit) => ({
  address: e.address,
  timezone: e.timezone,
});

export const labEditSpec = (row: Lab, e: LabEdit) => ({
  site: e.site,
  room_number: e.room_number,
  environment_class: e.environment_class,
  // Preserved off the row — not in the edit form:
  access_control_group: row.access_control_group,
  width_m: row.width_m,
  depth_m: row.depth_m,
  grid_size_m: row.grid_size_m,
  // The lab's box on the site canvas (ADR 0012) — the Site-level layout editor's
  // job, preserved here so a hierarchy rename doesn't reset it.
  site_pos_x: row.site_pos_x,
  site_pos_y: row.site_pos_y,
  site_size_x_m: row.site_size_x_m,
  site_size_y_m: row.site_size_y_m,
});

export const zoneEditSpec = (row: Zone, e: ZoneEdit) => ({
  lab: e.lab,
  atmosphere: e.atmosphere,
  occupancy: e.occupancy,
  // Preserved:
  pressure: row.pressure,
  temperature_class: row.temperature_class,
  hazard_class: row.hazard_class,
});

export const stationEditSpec = (row: Station, e: StationEdit) => ({
  lab: e.lab,
  zone: e.zone,
  kind: e.kind,
  capacity: e.capacity,
  state: e.state,
  owning_group: e.owning_group,
  // Preserved — the station's placement is the Lab Layout editor's job (ADR 0010):
  pos_x: row.pos_x,
  pos_y: row.pos_y,
  size_x_m: row.size_x_m,
  size_y_m: row.size_y_m,
  height_m: row.height_m,
  accepted_labware_types: row.accepted_labware_types,
  queueserver_endpoint: row.queueserver_endpoint,
  redis_namespace: row.redis_namespace,
  // Preserved — soft-hide is the canvas's affordance (ADR 0011), not this form's.
  virtual: row.virtual,
});

const put = <T>(kind: HierarchyKind, code: string, name: string, spec: object) =>
  apiPut<T>(`/${PLURAL[kind]}/${encodeURIComponent(code)}`, descriptor(kind, code, name, spec));

// The code is the stable identity and isn't editable here; a rename changes the
// human-readable name only.
export const updateSite = (row: Site, e: SiteEdit) =>
  put<Site>("Site", row.code, e.name, siteEditSpec(e));
export const updateLab = (row: Lab, e: LabEdit) =>
  put<Lab>("Lab", row.code, e.name, labEditSpec(row, e));

/** The lab's metric canvas (ADR 0010). */
export interface LabCanvas {
  width_m: number;
  depth_m: number;
  grid_size_m: number;
}

/**
 * Resize the lab's canvas/grid from the Lab Layout editor. This is the mirror of
 * `labEditSpec`, which *preserves* geometry: here the geometry is what changes
 * and the descriptive fields are preserved off the row. The lab carries
 * `site_id`, not the site code the descriptor wants, so the caller passes it.
 */
export const resizeLabCanvas = (row: Lab, siteCode: string, canvas: LabCanvas) =>
  put<Lab>("Lab", row.code, row.name, {
    site: siteCode,
    room_number: row.room_number,
    environment_class: row.environment_class,
    access_control_group: row.access_control_group,
    width_m: canvas.width_m,
    depth_m: canvas.depth_m,
    grid_size_m: canvas.grid_size_m,
    // Preserved — the lab's box on the site canvas is a different level (ADR 0012).
    site_pos_x: row.site_pos_x,
    site_pos_y: row.site_pos_y,
    site_size_x_m: row.site_size_x_m,
    site_size_y_m: row.site_size_y_m,
  });

/** The site's own metric canvas (ADR 0012), the level above the lab. */
export interface SiteCanvas {
  width_m: number;
  depth_m: number;
  grid_size_m: number;
}

/** Resize the *site* canvas from the Site-level layout editor. Full replace,
 * preserving the site's descriptive fields off the row (mirror of resizeLabCanvas). */
export const resizeSiteCanvas = (row: Site, canvas: SiteCanvas) =>
  put<Site>("Site", row.code, row.name, {
    address: row.address,
    timezone: row.timezone,
    width_m: canvas.width_m,
    depth_m: canvas.depth_m,
    grid_size_m: canvas.grid_size_m,
  });

/** A lab's box on the site canvas, in metres (ADR 0012). */
export interface LabSiteGeometry {
  site_pos_x: number;
  site_pos_y: number;
  site_size_x_m: number;
  site_size_y_m: number;
}

/**
 * Place/resize a lab's box on the site canvas: the site box is set, everything
 * else (own floor, room, environment, access) is preserved off the row. Shared by
 * the Site level's drag-move and handle-resize. `siteCode` can't be read off the
 * lab (it carries site_id, not the code the descriptor wants), so the caller passes it.
 */
export const placeLabOnSite = (row: Lab, siteCode: string, geom: LabSiteGeometry) =>
  put<Lab>("Lab", row.code, row.name, {
    site: siteCode,
    room_number: row.room_number,
    environment_class: row.environment_class,
    access_control_group: row.access_control_group,
    width_m: row.width_m,
    depth_m: row.depth_m,
    grid_size_m: row.grid_size_m,
    site_pos_x: geom.site_pos_x,
    site_pos_y: geom.site_pos_y,
    site_size_x_m: geom.site_size_x_m,
    site_size_y_m: geom.site_size_y_m,
  });
export const updateZone = (row: Zone, e: ZoneEdit) =>
  put<Zone>("Zone", row.code, e.name, zoneEditSpec(row, e));
export const updateStation = (row: Station, e: StationEdit) =>
  put<Station>("Station", row.code, e.name, stationEditSpec(row, e));

// ---- delete + revision history (ADR 0004) ----------------------------------

/** Hard-delete a node by code. The pre-delete snapshot is kept in its Revision
 * history regardless (ADR 0004). A 409 comes back if other rows still reference it. */
export const deleteNode = (kind: HierarchyKind, code: string) =>
  apiDelete(`/${PLURAL[kind]}/${encodeURIComponent(code)}`);

/** The write history of one node, in write order (oldest first, per the API) —
 * the "version control" surface. The history view reverses it for display. */
export const fetchRevisions = (kind: HierarchyKind, code: string) =>
  apiGet<Revision[]>(`/${PLURAL[kind]}/${encodeURIComponent(code)}/revisions`);

/** A station's box on the lab canvas, in metres (ADR 0010). */
export interface StationGeometry {
  pos_x: number;
  pos_y: number;
  size_x_m: number;
  size_y_m: number;
  height_m: number;
}

/**
 * Full-replace spec for a station's *placement*: the geometry is set, everything
 * else (kind, capacity, labware, execution binding, state) is preserved off the
 * row. Shared by `moveStation` (drag: new position, same box) and
 * `reshapeStation` (inspector: new footprint/height). `labCode`/`zoneCode` can't
 * be read off the station — it carries ids, not codes — so the caller passes them.
 */
function stationPlacementSpec(
  station: Station,
  labCode: string,
  zoneCode: string | null,
  geom: StationGeometry,
  virtual: boolean = station.virtual,
) {
  return descriptor("Station", station.code, station.name, {
    lab: labCode,
    zone: zoneCode,
    kind: station.kind,
    pos_x: geom.pos_x,
    pos_y: geom.pos_y,
    size_x_m: geom.size_x_m,
    size_y_m: geom.size_y_m,
    height_m: geom.height_m,
    capacity: station.capacity,
    accepted_labware_types: station.accepted_labware_types,
    queueserver_endpoint: station.queueserver_endpoint,
    redis_namespace: station.redis_namespace,
    state: station.state,
    owning_group: station.owning_group,
    virtual,
  });
}

/** The station's current box, unchanged — for writes that touch only a flag. */
const stationGeometry = (s: Station): StationGeometry => ({
  pos_x: s.pos_x,
  pos_y: s.pos_y,
  size_x_m: s.size_x_m,
  size_y_m: s.size_y_m,
  height_m: s.height_m,
});

/**
 * Soft-hide (or un-hide) a station from the canvas (ADR 0011): a full replace
 * that flips `virtual` and preserves the box. This is the Lab-layout editor's
 * "delete" — reversible from the revision history, unlike `deleteNode`.
 */
export function setStationVirtual(
  station: Station,
  labCode: string,
  zoneCode: string | null,
  virtual: boolean,
) {
  return apiPut<Station>(
    `/stations/${encodeURIComponent(station.code)}`,
    stationPlacementSpec(station, labCode, zoneCode, stationGeometry(station), virtual),
  );
}

/** Move a station's box to a new metric position, keeping its footprint/height. */
export function moveStation(
  station: Station,
  labCode: string,
  zoneCode: string | null,
  pos: { x: number; y: number },
) {
  return apiPut<Station>(
    `/stations/${encodeURIComponent(station.code)}`,
    stationPlacementSpec(station, labCode, zoneCode, {
      pos_x: pos.x,
      pos_y: pos.y,
      size_x_m: station.size_x_m,
      size_y_m: station.size_y_m,
      height_m: station.height_m,
    }),
  );
}

/** Resize/re-place a station's box: new position, footprint and height at once. */
export function reshapeStation(
  station: Station,
  labCode: string,
  zoneCode: string | null,
  geom: StationGeometry,
) {
  return apiPut<Station>(
    `/stations/${encodeURIComponent(station.code)}`,
    stationPlacementSpec(station, labCode, zoneCode, geom),
  );
}
