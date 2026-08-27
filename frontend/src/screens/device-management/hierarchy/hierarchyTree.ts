/**
 * Turns the flat entity lists into the
 * Site → Lab → Zone(optional) → Station → Module containment tree.
 *
 * Pure — no React, no fetching — so the shape of the hierarchy can be
 * reasoned about on its own. Devices are deliberately absent: they live on
 * the Device Monitoring screen, not in the containment tree.
 */

import type { Lab, Module, Site, Station, Zone } from "../../../api/types";

export type Kind = "Site" | "Lab" | "Zone" | "Station" | "Module";

/** The levels, outermost first — also their indentation order in the tree. */
export const LEVELS: Kind[] = ["Site", "Lab", "Zone", "Station", "Module"];

export interface TreeNode {
  uuid: string;
  kind: Kind;
  name: string;
  children: TreeNode[];
}

export interface Snapshot {
  sites: Site[];
  labs: Lab[];
  zones: Zone[];
  stations: Station[];
  modules: Module[];
}

/** Group rows by the key naming their parent, skipping null keys. */
function groupBy<T>(rows: T[], parentOf: (row: T) => string | null): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = parentOf(row);
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function buildTree({ sites, labs, zones, stations, modules }: Snapshot): TreeNode[] {
  const modulesByStation = groupBy(modules, (m) => m.station_uuid);
  // A station's parent is its zone when it has one, otherwise its lab.
  const stationsByZone = groupBy(stations, (s) => s.zone_uuid);
  const stationsByLab = groupBy(stations, (s) => (s.zone_uuid === null ? s.lab_uuid : null));
  // A zone hangs off either a site or a lab — one `parent_uuid` covers both.
  const zonesByParent = groupBy(zones, (z) => z.parent_uuid);
  const labsBySite = groupBy(labs, (l) => l.site_uuid);

  const node = (kind: Kind, row: { uuid: string; name: string }, children: TreeNode[] = []): TreeNode => ({
    uuid: row.uuid,
    kind,
    name: row.name,
    children,
  });

  const stationNode = (s: Station): TreeNode =>
    node("Station", s, (modulesByStation.get(s.uuid) ?? []).sort(byName).map((m) => node("Module", m)));

  const zoneNode = (z: Zone): TreeNode =>
    node("Zone", z, (stationsByZone.get(z.uuid) ?? []).sort(byName).map(stationNode));

  const labNode = (l: Lab): TreeNode =>
    node("Lab", l, [
      ...(zonesByParent.get(l.uuid) ?? []).sort(byName).map(zoneNode),
      ...(stationsByLab.get(l.uuid) ?? []).sort(byName).map(stationNode),
    ]);

  return [...sites].sort(byName).map((site) =>
    node("Site", site, [
      ...(zonesByParent.get(site.uuid) ?? []).sort(byName).map(zoneNode),
      ...(labsBySite.get(site.uuid) ?? []).sort(byName).map(labNode),
    ]),
  );
}

/** Every uuid in the tree — used to expand everything by default. */
export function collectUuids(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.uuid, ...collectUuids(n.children)]);
}
