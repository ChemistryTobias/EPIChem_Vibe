/** Topology endpoints (`backend/epichem/api/routers/topology.py`). */

import { apiGet } from "./client";
import type { Bench, Lab, Site, Station, Workcell, Zone } from "./types";

export const listSites = () => apiGet<Site[]>("/sites");
export const listLabs = () => apiGet<Lab[]>("/labs");
export const listZones = () => apiGet<Zone[]>("/zones");
export const listWorkcells = () => apiGet<Workcell[]>("/workcells");
export const listBenches = () => apiGet<Bench[]>("/benches");
export const listStations = () => apiGet<Station[]>("/stations");

/** Every topology level in one shot — what the tree view needs. */
export interface TopologySnapshot {
  sites: Site[];
  labs: Lab[];
  zones: Zone[];
  workcells: Workcell[];
  benches: Bench[];
  stations: Station[];
}

/**
 * Six parallel list calls rather than one nested endpoint. The registry has
 * no "give me the whole tree" endpoint, and adding one to serve a single
 * screen would be the tail wagging the dog — a lab's topology is small
 * (tens of rows), so six flat GETs are cheap and keep the API honest.
 */
export async function fetchTopology(): Promise<TopologySnapshot> {
  const [sites, labs, zones, workcells, benches, stations] = await Promise.all([
    listSites(),
    listLabs(),
    listZones(),
    listWorkcells(),
    listBenches(),
    listStations(),
  ]);
  return { sites, labs, zones, workcells, benches, stations };
}
