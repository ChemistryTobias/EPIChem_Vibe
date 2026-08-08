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

export type TopologyKind = "Site" | "Lab" | "Zone" | "Station" | "Device";

export type TopologyRow = Site | Lab | Zone | Station | Device;

export interface TreeNode {
  id: string;
  kind: TopologyKind;
  code: string;
  name: string;
  /** The raw API row, handed to the inspector. */
  row: TopologyRow;
  children: TreeNode[];
  /** A live, not-yet-saved preview row (ADR 0009): rendered distinctly and not
   * selectable. Absent on real rows. */
  draft?: boolean;
}

export interface TopologyTree {
  roots: TreeNode[];
  /** Rows whose declared parent wasn't in the snapshot. */
  orphans: { kind: TopologyKind; code: string; parentId: string }[];
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

export function buildTopologyTree(snapshot: TopologySnapshot): TopologyTree {
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

  const node = (kind: TopologyKind, row: TopologyRow, children: TreeNode[] = []): TreeNode => ({
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

  const orphans: TopologyTree["orphans"] = [
    ...labs.filter((l) => !known.Site.has(l.site_id)).map((l) => orphan("Lab", l.code, l.site_id)),
    // Only lab-scoped zones belong in the lab hierarchy; site-scoped zones
    // (lab_id null, ADR 0015) are a layout concept and simply aren't in the tree.
    ...zones
      .filter((z) => z.lab_id !== null && !known.Lab.has(z.lab_id))
      .map((z) => orphan("Zone", z.code, z.lab_id as string)),
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

function orphan(kind: TopologyKind, code: string, parentId: string) {
  return { kind, code, parentId };
}

/** Every node id in the tree — used to expand everything by default. */
export function collectNodeIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectNodeIds(n.children)]);
}

/** Depth-first search for the node with a given id, or null. Used to re-derive
 * the selected node from a freshly rebuilt tree after a write. */
export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

// ---- live draft preview (ADR 0009) -----------------------------------------

/** The synthetic id the in-progress row carries; there is only ever one. */
export const DRAFT_ID = "__draft__";

/** A not-yet-saved row the Create inspector previews in the tree as you type. */
export interface DraftNode {
  kind: TopologyKind;
  code: string;
  name: string;
  /** The real row it will hang under; null only for a Site (a new root). */
  parentId: string | null;
}

function draftTreeNode(draft: DraftNode): TreeNode {
  return {
    id: DRAFT_ID,
    kind: draft.kind,
    code: draft.code,
    name: draft.name,
    // Draft rows are never selected/inspected, so a minimal row stands in for
    // the full API object the real rows carry.
    row: { id: DRAFT_ID, code: draft.code, name: draft.name } as unknown as TopologyRow,
    children: [],
    draft: true,
  };
}

/**
 * Insert the draft as a child of the node whose id is `draft.parentId` (or as a
 * new root when it's null, i.e. a Site). Returns a new tree — the input isn't
 * mutated — so it drops back in a `useMemo`. If the parent isn't in the tree the
 * tree is returned unchanged.
 */
export function injectDraft(tree: TopologyTree, draft: DraftNode | null): TopologyTree {
  if (!draft) return tree;
  const node = draftTreeNode(draft);
  // A Site is the only kind that becomes a new root. Any other kind whose parent
  // isn't chosen yet (a device before a station is picked) has nowhere to hang,
  // so it simply doesn't preview rather than floating at the top level.
  if (draft.kind === "Site") {
    return { ...tree, roots: [...tree.roots, node] };
  }
  if (draft.parentId === null) return tree;
  let inserted = false;
  const graft = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => {
      if (n.id === draft.parentId) {
        inserted = true;
        return { ...n, children: [...n.children, node] };
      }
      return n.children.length ? { ...n, children: graft(n.children) } : n;
    });
  const roots = graft(tree.roots);
  return inserted ? { ...tree, roots } : tree;
}

/**
 * id -> its parent's id in the containment tree (null at a Site), for every
 * kind, so an ancestor walk works from any node. A station's parent is its zone
 * when it has one, else its lab; a device's is its module parent, else its
 * station.
 */
export function buildParentIndex(snapshot: TopologySnapshot): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const s of snapshot.sites) index.set(s.id, null);
  for (const l of snapshot.labs) index.set(l.id, l.site_id);
  for (const z of snapshot.zones) index.set(z.id, z.lab_id);
  for (const st of snapshot.stations) index.set(st.id, st.zone_id ?? st.lab_id);
  for (const d of snapshot.devices) index.set(d.id, d.parent_id ?? d.station_id);
  return index;
}

/**
 * `id` and the chain of ancestor ids above it (nearest first). Used to
 * force-expand a draft's whole lineage so the new row stays on screen even if a
 * branch was collapsed.
 */
export function ancestorIds(index: Map<string, string | null>, id: string | null): string[] {
  const chain: string[] = [];
  let cur = id;
  while (cur != null) {
    chain.push(cur);
    cur = index.get(cur) ?? null;
  }
  return chain;
}

/** Count of nodes per kind, for the header subtitle. */
export function countByKind(nodes: TreeNode[]): Record<TopologyKind, number> {
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
