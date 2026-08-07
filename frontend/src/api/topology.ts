/** Topology endpoints (`backend/epichem/api/routers/topology.py`). */

import { apiGet, apiPost, apiPut } from "./client";
import { listDevices } from "./devices";
import type { Device, Lab, Site, Station, Zone } from "./types";

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
}

export const createSite = (code: string, name: string, spec: SiteSpecBody) =>
  apiPost<Site>("/sites", descriptor("Site", code, name, spec));

export const createLab = (code: string, name: string, spec: LabSpecBody) =>
  apiPost<Lab>("/labs", descriptor("Lab", code, name, spec));

export const createZone = (code: string, name: string, spec: ZoneSpecBody) =>
  apiPost<Zone>("/zones", descriptor("Zone", code, name, spec));

export const createStation = (code: string, name: string, spec: StationSpecBody) =>
  apiPost<Station>("/stations", descriptor("Station", code, name, spec));

export function moveStation(
  station: Station,
  labCode: string,
  zoneCode: string | null,
  pos: { x: number; y: number },
) {
  return apiPut<Station>(`/stations/${encodeURIComponent(station.code)}`, {
    apiVersion: "epichem.dev/v1",
    kind: "Station",
    metadata: { code: station.code, name: station.name },
    spec: {
      lab: labCode,
      zone: zoneCode,
      kind: station.kind,
      pos_x: pos.x,
      pos_y: pos.y,
      size_x_m: station.size_x_m,
      size_y_m: station.size_y_m,
      height_m: station.height_m,
      capacity: station.capacity,
      accepted_labware_types: station.accepted_labware_types,
      queueserver_endpoint: station.queueserver_endpoint,
      redis_namespace: station.redis_namespace,
      state: station.state,
      owning_group: station.owning_group,
    },
  });
}
