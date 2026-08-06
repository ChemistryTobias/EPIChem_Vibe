/**
 * `buildTopologyTree` is the one piece of real logic in this app that isn't
 * a thin wrapper over fetch or JSX — it turns six flat lists into a
 * hierarchy — so it's where tests are worth the most per line.
 */

import { describe, expect, test } from "vitest";

import type { TopologySnapshot } from "../../api/topology";
import type { Bench, Lab, Site, Station, Workcell, Zone } from "../../api/types";
import { buildTopologyTree, collectNodeIds, countByKind } from "./topologyTree";

const site = (id: string, code: string): Site => ({
  id,
  code,
  name: `Site ${code}`,
  address: null,
  timezone: null,
});

const lab = (id: string, code: string, site_id: string): Lab => ({
  id,
  code,
  name: `Lab ${code}`,
  site_id,
  room_number: null,
  environment_class: "ambient",
  access_control_group: null,
});

const zone = (id: string, code: string, lab_id: string): Zone => ({
  id,
  code,
  name: `Zone ${code}`,
  lab_id,
  atmosphere: "air",
  pressure: null,
  temperature_class: null,
  hazard_class: null,
});

const workcell = (id: string, code: string, zone_id: string): Workcell => ({
  id,
  code,
  name: `Cell ${code}`,
  zone_id,
  queueserver_endpoint: null,
  redis_namespace: null,
  state: "active",
  owning_group: null,
});

const bench = (id: string, code: string, workcell_id: string): Bench => ({
  id,
  code,
  name: `Bench ${code}`,
  workcell_id,
  grid_cols: 1,
  grid_rows: 1,
  height_mm: null,
});

const station = (id: string, code: string, bench_id: string): Station => ({
  id,
  code,
  name: `Station ${code}`,
  bench_id,
  kind: "generic",
  grid_col: 0,
  grid_row: 0,
  stack_height: 1,
  capacity: 1,
  accepted_labware_types: [],
});

const empty: TopologySnapshot = {
  sites: [],
  labs: [],
  zones: [],
  workcells: [],
  benches: [],
  stations: [],
};

/** One full Site -> ... -> Station chain. */
const fullChain: TopologySnapshot = {
  sites: [site("s1", "SITE-1")],
  labs: [lab("l1", "LAB-1", "s1")],
  zones: [zone("z1", "ZONE-1", "l1")],
  workcells: [workcell("w1", "CELL-1", "z1")],
  benches: [bench("b1", "BENCH-1", "w1")],
  stations: [station("st1", "ST-1", "b1")],
};

describe("buildTopologyTree", () => {
  test("nests all six levels under the site", () => {
    const { roots } = buildTopologyTree(fullChain);

    expect(roots).toHaveLength(1);
    const path: string[] = [];
    let node = roots[0];
    while (node) {
      path.push(node.kind);
      node = node.children[0];
    }
    expect(path).toEqual(["Site", "Lab", "Zone", "Workcell", "Bench", "Station"]);
  });

  test("handles an empty registry without throwing", () => {
    expect(buildTopologyTree(empty)).toEqual({ roots: [], orphans: [] });
  });

  test("sorts siblings by code, not by API order", () => {
    const { roots } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-B"), site("s2", "SITE-A")],
    });

    expect(roots.map((n) => n.code)).toEqual(["SITE-A", "SITE-B"]);
  });

  test("puts every child under its own parent when there are several", () => {
    const { roots } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-1"), site("s2", "SITE-2")],
      labs: [lab("l1", "LAB-1", "s1"), lab("l2", "LAB-2", "s2"), lab("l3", "LAB-3", "s1")],
    });

    expect(roots.map((s) => s.children.map((l) => l.code))).toEqual([
      ["LAB-1", "LAB-3"],
      ["LAB-2"],
    ]);
  });

  test("reports a row whose parent is missing instead of dropping it", () => {
    // The whole point: a dangling FK is a registry problem the operator
    // should see, not something the UI quietly hides.
    const { roots, orphans } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-1")],
      labs: [lab("l1", "LAB-ORPHAN", "nonexistent-site")],
    });

    expect(roots[0].children).toEqual([]);
    expect(orphans).toEqual([
      { kind: "Lab", code: "LAB-ORPHAN", parentId: "nonexistent-site" },
    ]);
  });

  test("reports orphans at every level", () => {
    const { orphans } = buildTopologyTree({
      sites: [],
      labs: [lab("l1", "L", "missing")],
      zones: [zone("z1", "Z", "missing")],
      workcells: [workcell("w1", "W", "missing")],
      benches: [bench("b1", "B", "missing")],
      stations: [station("st1", "S", "missing")],
    });

    expect(orphans.map((o) => o.kind)).toEqual([
      "Lab",
      "Zone",
      "Workcell",
      "Bench",
      "Station",
    ]);
  });

  test("keeps the raw row on each node for the inspector", () => {
    const { roots } = buildTopologyTree(fullChain);

    expect(roots[0].row).toBe(fullChain.sites[0]);
    expect(roots[0].children[0].row).toBe(fullChain.labs[0]);
  });
});

describe("collectNodeIds", () => {
  test("returns every id in the tree, depth-first", () => {
    const { roots } = buildTopologyTree(fullChain);

    expect(collectNodeIds(roots)).toEqual(["s1", "l1", "z1", "w1", "b1", "st1"]);
  });

  test("is empty for an empty tree", () => {
    expect(collectNodeIds([])).toEqual([]);
  });
});

describe("countByKind", () => {
  test("counts every level, not just the roots", () => {
    const { roots } = buildTopologyTree({
      ...fullChain,
      stations: [station("st1", "ST-1", "b1"), station("st2", "ST-2", "b1")],
    });

    expect(countByKind(roots)).toEqual({
      Site: 1,
      Lab: 1,
      Zone: 1,
      Workcell: 1,
      Bench: 1,
      Station: 2,
    });
  });

  test("does not count orphans, which aren't in the tree", () => {
    const { roots } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-1")],
      labs: [lab("l1", "LAB-ORPHAN", "missing")],
    });

    expect(countByKind(roots).Lab).toBe(0);
  });
});
