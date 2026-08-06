/** Topology endpoints (`backend/epichem/api/routers/topology.py`). */

import { apiGet, apiPut } from "./client";
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
/**
 * Move a station to a different cell of its bench.
 *
 * `PUT` takes the same `apiVersion/kind/metadata/spec` descriptor envelope
 * the YAML uses (ADR 0004 §3) and is a **full replace** — so every field has
 * to be sent, not just the two that changed, or the rest reset to their
 * defaults. `benchCode` can't be read off the station (it carries
 * `bench_id`, not the code the descriptor wants), so the caller passes it.
 */
export function moveStation(station: Station, benchCode: string, grid: { col: number; row: number }) {
  return apiPut<Station>(`/stations/${encodeURIComponent(station.code)}`, {
    apiVersion: "epichem.dev/v1",
    kind: "Station",
    metadata: { code: station.code, name: station.name },
    spec: {
      bench: benchCode,
      kind: station.kind,
      grid_col: grid.col,
      grid_row: grid.row,
      stack_height: station.stack_height,
      capacity: station.capacity,
      accepted_labware_types: station.accepted_labware_types,
    },
  });
}

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
