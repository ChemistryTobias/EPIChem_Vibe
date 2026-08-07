/**
 * Turns the flat topology + device lists into the
 * Site → Lab → Zone(optional) → Station → Module/Device tree the Hierarchy
 * renders (ADR 0007/0009).
 *
 * Pure — no React, no fetching — so the hierarchy logic can be reasoned about
 * (and tested) on its own.
 *
 * Rows whose parent isn't in the snapshot are *not* dropped. They come back in
 * `orphans` so the screen can say so out loud: a station with a dangling
 * `lab_id`, or a device pointing at no station, is a registry problem worth
 * seeing, not something a UI should quietly hide.
 */

import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import type { TopologySnapshot } from "../../api/topology";

export type HierarchyKind = "Site" | "Lab" | "Zone" | "Station" | "Device";

export type HierarchyRow = Site | Lab | Zone | Station | Device;

export interface TreeNode {
  id: string;
  kind: HierarchyKind;
  code: string;
  name: string;
  /** The raw API row, handed to the inspector. */
  row: HierarchyRow;
  children: TreeNode[];
}

export interface HierarchyTree {
  roots: TreeNode[];
  /** Rows whose declared parent wasn't in the snapshot. */
  orphans: { kind: HierarchyKind; code: string; parentId: string }[];
}

/** Group rows by the foreign key naming their parent (skipping null keys). */
function groupByParent<T>(rows: T[], parentIdOf: (row: T) => string | null): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = parentIdOf(row);
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

export function buildHierarchyTree(snapshot: TopologySnapshot): HierarchyTree {
  const { sites, labs, zones, stations, devices } = snapshot;

  const labsBySite = groupByParent(labs, (l) => l.site_id);
  const zonesByLab = groupByParent(zones, (z) => z.lab_id);
  // A station's parent in the tree is its zone if it has one, otherwise its lab.
  const stationsByZone = groupByParent(stations, (s) => s.zone_id);
  const stationsDirectlyUnderLab = groupByParent(
    stations,
    (s) => (s.zone_id === null ? s.lab_id : null),
  );
  const devicesByStation = groupByParent(
    devices,
    (d) => (d.parent_id === null ? d.station_id : null),
  );
  const devicesByParent = groupByParent(devices, (d) => d.parent_id);

  const node = (kind: HierarchyKind, row: HierarchyRow, children: TreeNode[] = []): TreeNode => ({
    id: row.id,
    kind,
    code: row.code,
    name: row.name,
    row,
    children,
  });

  // A device and its nested modules/devices (recursive on parent_id).
  const deviceNode = (device: Device): TreeNode =>
    node(
      "Device",
      device,
      (devicesByParent.get(device.id) ?? []).sort(byCode).map(deviceNode),
    );

  const stationNode = (s: Station): TreeNode =>
    node("Station", s, (devicesByStation.get(s.id) ?? []).sort(byCode).map(deviceNode));

  const roots = [...sites].sort(byCode).map((site) =>
    node(
      "Site",
      site,
      (labsBySite.get(site.id) ?? []).sort(byCode).map((lab) =>
        node("Lab", lab, [
          // Zones first, then any station sitting directly under the lab.
          ...(zonesByLab.get(lab.id) ?? [])
            .sort(byCode)
            .map((zone) =>
              node("Zone", zone, (stationsByZone.get(zone.id) ?? []).sort(byCode).map(stationNode)),
            ),
          ...(stationsDirectlyUnderLab.get(lab.id) ?? []).sort(byCode).map(stationNode),
        ]),
      ),
    ),
  );

  const known = {
    Site: new Set(sites.map((s) => s.id)),
    Lab: new Set(labs.map((l) => l.id)),
    Zone: new Set(zones.map((z) => z.id)),
    Station: new Set(stations.map((s) => s.id)),
    Device: new Set(devices.map((d) => d.id)),
  };

  const orphans: HierarchyTree["orphans"] = [
    ...labs.filter((l) => !known.Site.has(l.site_id)).map((l) => orphan("Lab", l.code, l.site_id)),
    ...zones.filter((z) => !known.Lab.has(z.lab_id)).map((z) => orphan("Zone", z.code, z.lab_id)),
    // A station is misplaced if its lab is missing, or if it names a zone that
    // isn't in the registry.
    ...stations
      .filter((s) => !known.Lab.has(s.lab_id))
      .map((s) => orphan("Station", s.code, s.lab_id)),
    ...stations
      .filter((s) => s.zone_id !== null && !known.Zone.has(s.zone_id))
      .map((s) => orphan("Station", s.code, s.zone_id as string)),
    // A device with no place in the tree: no parent and no (known) station.
    ...devices
      .filter(
        (d) =>
          d.parent_id === null &&
          (d.station_id === null || !known.Station.has(d.station_id)),
      )
      .map((d) => orphan("Device", d.code, d.station_id ?? "(unplaced)")),
    ...devices
      .filter((d) => d.parent_id !== null && !known.Device.has(d.parent_id))
      .map((d) => orphan("Device", d.code, d.parent_id as string)),
  ];

  return { roots, orphans };
}

function orphan(kind: HierarchyKind, code: string, parentId: string) {
  return { kind, code, parentId };
}

/** Every node id in the tree — used to expand everything by default. */
export function collectNodeIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectNodeIds(n.children)]);
}

/** Count of nodes per kind, for the header subtitle. */
export function countByKind(nodes: TreeNode[]): Record<HierarchyKind, number> {
  const counts = { Site: 0, Lab: 0, Zone: 0, Station: 0, Device: 0 };
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      counts[n.kind] += 1;
      walk(n.children);
    }
  };
  walk(nodes);
  return counts;
}
