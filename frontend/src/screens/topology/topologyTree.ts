/**
 * Turns the six flat topology lists into the Site → Lab → Zone → Workcell →
 * Bench → Station tree the screen renders.
 *
 * Pure — no React, no fetching — so the hierarchy logic can be reasoned
 * about (and eventually tested) on its own.
 *
 * Rows whose parent isn't in the snapshot are *not* dropped. They come back
 * in `orphans` so the screen can say so out loud: a lab with a dangling
 * `site_id` is a registry problem worth seeing, not something a UI should
 * quietly hide.
 */

import type { Bench, Lab, Site, Station, Workcell, Zone } from "../../api/types";
import type { TopologySnapshot } from "../../api/topology";

export type TopologyKind = "Site" | "Lab" | "Zone" | "Workcell" | "Bench" | "Station";

export type TopologyRow = Site | Lab | Zone | Workcell | Bench | Station;

export interface TreeNode {
  id: string;
  kind: TopologyKind;
  code: string;
  name: string;
  /** The raw API row, handed to the inspector. */
  row: TopologyRow;
  children: TreeNode[];
}

export interface TopologyTree {
  roots: TreeNode[];
  /** Rows whose declared parent wasn't in the snapshot. */
  orphans: { kind: TopologyKind; code: string; parentId: string }[];
}

/** Group rows by the foreign key naming their parent. */
function groupByParent<T>(rows: T[], parentIdOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = parentIdOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

export function buildTopologyTree(snapshot: TopologySnapshot): TopologyTree {
  const { sites, labs, zones, workcells, benches, stations } = snapshot;

  const labsBySite = groupByParent(labs, (l) => l.site_id);
  const zonesByLab = groupByParent(zones, (z) => z.lab_id);
  const workcellsByZone = groupByParent(workcells, (w) => w.zone_id);
  const benchesByWorkcell = groupByParent(benches, (b) => b.workcell_id);
  const stationsByBench = groupByParent(stations, (s) => s.bench_id);

  const node = (kind: TopologyKind, row: TopologyRow, children: TreeNode[] = []): TreeNode => ({
    id: row.id,
    kind,
    code: row.code,
    name: row.name,
    row,
    children,
  });

  const roots = [...sites].sort(byCode).map((site) =>
    node(
      "Site",
      site,
      (labsBySite.get(site.id) ?? []).sort(byCode).map((lab) =>
        node(
          "Lab",
          lab,
          (zonesByLab.get(lab.id) ?? []).sort(byCode).map((zone) =>
            node(
              "Zone",
              zone,
              (workcellsByZone.get(zone.id) ?? []).sort(byCode).map((workcell) =>
                node(
                  "Workcell",
                  workcell,
                  (benchesByWorkcell.get(workcell.id) ?? []).sort(byCode).map((bench) =>
                    node(
                      "Bench",
                      bench,
                      (stationsByBench.get(bench.id) ?? [])
                        .sort(byCode)
                        .map((station) => node("Station", station)),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  const known = {
    Site: new Set(sites.map((s) => s.id)),
    Lab: new Set(labs.map((l) => l.id)),
    Zone: new Set(zones.map((z) => z.id)),
    Workcell: new Set(workcells.map((w) => w.id)),
    Bench: new Set(benches.map((b) => b.id)),
  };

  const orphans: TopologyTree["orphans"] = [
    ...labs.filter((l) => !known.Site.has(l.site_id)).map((l) => orphan("Lab", l.code, l.site_id)),
    ...zones.filter((z) => !known.Lab.has(z.lab_id)).map((z) => orphan("Zone", z.code, z.lab_id)),
    ...workcells
      .filter((w) => !known.Zone.has(w.zone_id))
      .map((w) => orphan("Workcell", w.code, w.zone_id)),
    ...benches
      .filter((b) => !known.Workcell.has(b.workcell_id))
      .map((b) => orphan("Bench", b.code, b.workcell_id)),
    ...stations
      .filter((s) => !known.Bench.has(s.bench_id))
      .map((s) => orphan("Station", s.code, s.bench_id)),
  ];

  return { roots, orphans };
}

function orphan(kind: TopologyKind, code: string, parentId: string) {
  return { kind, code, parentId };
}

/** Every node id in the tree — used to expand everything by default. */
export function collectNodeIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectNodeIds(n.children)]);
}

/** Count of nodes per kind, for the header subtitle. */
export function countByKind(nodes: TreeNode[]): Record<TopologyKind, number> {
  const counts = { Site: 0, Lab: 0, Zone: 0, Workcell: 0, Bench: 0, Station: 0 };
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      counts[n.kind] += 1;
      walk(n.children);
    }
  };
  walk(nodes);
  return counts;
}
