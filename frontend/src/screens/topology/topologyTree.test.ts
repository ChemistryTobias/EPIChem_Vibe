/**
 * `buildTopologyTree` is the one piece of real logic in this app that isn't a
 * thin wrapper over fetch or JSX — it turns flat lists into a hierarchy
 * (Site → Lab → Zone(optional) → Station → Module/Device) — so it's where
 * tests are worth the most per line.
 */

import { describe, expect, test } from "vitest";

import type { TopologySnapshot } from "../../api/topology";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import {
  DRAFT_ID,
  ancestorIds,
  buildParentIndex,
  buildTopologyTree,
  collectNodeIds,
  countByKind,
  findNode,
  injectDraft,
} from "./topologyTree";

const site = (id: string, code: string): Site => ({
  id,
  code,
  name: `Site ${code}`,
  address: null,
  timezone: null,
  width_m: 40,
  depth_m: 40,
  grid_size_m: 1,
});

const lab = (id: string, code: string, site_id: string): Lab => ({
  id,
  code,
  name: `Lab ${code}`,
  site_id,
  room_number: null,
  environment_class: "ambient",
  access_control_group: null,
  width_m: 6,
  depth_m: 4,
  grid_size_m: 0.5,
  site_pos_x: 0,
  site_pos_y: 0,
  site_size_x_m: 10,
  site_size_y_m: 10,
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
  occupancy: "shared",
});

const station = (
  id: string,
  code: string,
  lab_id: string,
  zone_id: string | null = null,
): Station => ({
  id,
  code,
  name: `Station ${code}`,
  lab_id,
  zone_id,
  kind: "generic",
  pos_x: 0,
  pos_y: 0,
  size_x_m: 1,
  size_y_m: 1,
  height_m: 0.5,
  capacity: 1,
  accepted_labware_types: [],
  queueserver_endpoint: null,
  redis_namespace: null,
  state: "active",
  owning_group: null,
  virtual: false,
});

const device = (
  id: string,
  code: string,
  opts: { station_id?: string | null; parent_id?: string | null; node_kind?: string } = {},
): Device => ({
  id,
  code,
  name: `Device ${code}`,
  node_kind: opts.node_kind ?? "device",
  labels: {},
  station_id: opts.station_id ?? null,
  parent_id: opts.parent_id ?? null,
  capability_class_ref: null,
  capability_class_id: null,
  capabilities: [],
  ophyd_import: null,
  ophyd_args: {},
  transport_protocol: null,
  transport_uri: null,
  transport_ioc_host: null,
  transport_quality: "nominal",
  network_netbox_device_id: null,
  network_primary_ip: null,
  network_mac: null,
  network_vlan: null,
  pose_x_mm: null,
  pose_y_mm: null,
  pose_z_mm: null,
  pose_yaw_deg: null,
  size_x_mm: null,
  size_y_mm: null,
  size_z_mm: null,
  envelope: {},
  safety_flags: [],
  safety_interlocks: [],
  safety_max_unattended_minutes: null,
  operational_mode: "read_write",
  operational_calibration: null,
  virtual: false,
  station_code: null,
});

const empty: TopologySnapshot = {
  sites: [],
  labs: [],
  zones: [],
  stations: [],
  devices: [],
};

/** One full Site -> Lab -> Zone -> Station -> Device chain. */
const fullChain: TopologySnapshot = {
  sites: [site("s1", "SITE-1")],
  labs: [lab("l1", "LAB-1", "s1")],
  zones: [zone("z1", "ZONE-1", "l1")],
  stations: [station("st1", "ST-1", "l1", "z1")],
  devices: [device("d1", "DEV-1", { station_id: "st1" })],
};

describe("buildTopologyTree", () => {
  test("nests Site -> Lab -> Zone -> Station -> Device", () => {
    const { roots } = buildTopologyTree(fullChain);

    expect(roots).toHaveLength(1);
    const path: string[] = [];
    let node = roots[0];
    while (node) {
      path.push(node.kind);
      node = node.children[0];
    }
    expect(path).toEqual(["Site", "Lab", "Zone", "Station", "Device"]);
  });

  test("puts a zone-less station directly under its lab", () => {
    const { roots } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-1")],
      labs: [lab("l1", "LAB-1", "s1")],
      stations: [station("st1", "ST-1", "l1")],
    });

    const labNode = roots[0].children[0];
    expect(labNode.children.map((n) => n.kind)).toEqual(["Station"]);
    expect(labNode.children[0].code).toBe("ST-1");
  });

  test("nests a module and its devices under a station", () => {
    const { roots } = buildTopologyTree({
      ...empty,
      sites: [site("s1", "SITE-1")],
      labs: [lab("l1", "LAB-1", "s1")],
      stations: [station("st1", "ST-1", "l1")],
      devices: [
        device("m1", "MOD-1", { station_id: "st1", node_kind: "module" }),
        device("d1", "DEV-1", { station_id: "st1", parent_id: "m1" }),
      ],
    });

    const stationNode = roots[0].children[0].children[0];
    expect(stationNode.children.map((n) => n.code)).toEqual(["MOD-1"]);
    expect(stationNode.children[0].children.map((n) => n.code)).toEqual(["DEV-1"]);
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

  test("reports a row whose parent is missing instead of dropping it", () => {
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

  test("reports an unplaced device as an orphan, not silently hidden", () => {
    const { orphans } = buildTopologyTree({
      ...empty,
      devices: [device("d1", "DEV-LOST")],
    });

    expect(orphans).toEqual([{ kind: "Device", code: "DEV-LOST", parentId: "(unplaced)" }]);
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

    expect(collectNodeIds(roots)).toEqual(["s1", "l1", "z1", "st1", "d1"]);
  });

  test("is empty for an empty tree", () => {
    expect(collectNodeIds([])).toEqual([]);
  });
});

describe("findNode", () => {
  test("finds a deeply nested node by id", () => {
    const { roots } = buildTopologyTree(fullChain);
    expect(findNode(roots, "st1")?.code).toBe("ST-1");
    expect(findNode(roots, "d1")?.kind).toBe("Device");
  });

  test("returns null when the id isn't in the tree", () => {
    const { roots } = buildTopologyTree(fullChain);
    expect(findNode(roots, "ghost")).toBeNull();
  });
});

describe("injectDraft", () => {
  test("returns the tree unchanged when there is no draft", () => {
    const tree = buildTopologyTree(fullChain);
    expect(injectDraft(tree, null)).toBe(tree);
  });

  test("adds a new Site draft as a root", () => {
    const tree = buildTopologyTree(fullChain);
    const next = injectDraft(tree, { kind: "Site", code: "SITE-2", name: "New", parentId: null });

    expect(next.roots.map((n) => n.id)).toEqual(["s1", DRAFT_ID]);
    expect(next.roots[1].draft).toBe(true);
  });

  test("hangs a Device draft under its station, marked as a draft", () => {
    const tree = buildTopologyTree(fullChain);
    const next = injectDraft(tree, { kind: "Device", code: "", name: "", parentId: "st1" });

    const stationNode = next.roots[0].children[0].children[0].children[0];
    expect(stationNode.id).toBe("st1");
    const draftNode = stationNode.children.find((n) => n.id === DRAFT_ID);
    expect(draftNode?.draft).toBe(true);
    expect(draftNode?.kind).toBe("Device");
  });

  test("does not mutate the input tree", () => {
    const tree = buildTopologyTree(fullChain);
    const stationChildrenBefore = tree.roots[0].children[0].children[0].children[0].children.length;
    injectDraft(tree, { kind: "Device", code: "x", name: "x", parentId: "st1" });

    expect(tree.roots[0].children[0].children[0].children[0].children.length).toBe(
      stationChildrenBefore,
    );
  });

  test("leaves the tree unchanged if the parent isn't present", () => {
    const tree = buildTopologyTree(fullChain);
    expect(injectDraft(tree, { kind: "Device", code: "x", name: "x", parentId: "ghost" })).toBe(
      tree,
    );
  });

  test("does not float a non-Site draft with no parent as a root", () => {
    const tree = buildTopologyTree(fullChain);
    // A device before a station is picked has parentId null — it must not become
    // a root the way a Site does.
    expect(injectDraft(tree, { kind: "Device", code: "", name: "", parentId: null })).toBe(tree);
  });
});

describe("buildParentIndex / ancestorIds", () => {
  test("walks a node's whole lineage nearest-first", () => {
    const index = buildParentIndex(fullChain);
    // From the station up: itself, its zone, its lab, its site.
    expect(ancestorIds(index, "st1")).toEqual(["st1", "z1", "l1", "s1"]);
  });

  test("a zone-less station's parent is its lab", () => {
    const snapshot = {
      ...empty,
      sites: [site("s1", "SITE-1")],
      labs: [lab("l1", "LAB-1", "s1")],
      stations: [station("st1", "ST-1", "l1")],
    };
    expect(ancestorIds(buildParentIndex(snapshot), "st1")).toEqual(["st1", "l1", "s1"]);
  });

  test("is empty for a null id", () => {
    expect(ancestorIds(buildParentIndex(fullChain), null)).toEqual([]);
  });
});

describe("countByKind", () => {
  test("counts every level, not just the roots", () => {
    const { roots } = buildTopologyTree({
      ...fullChain,
      stations: [station("st1", "ST-1", "l1", "z1"), station("st2", "ST-2", "l1", "z1")],
    });

    expect(countByKind(roots)).toEqual({
      Site: 1,
      Lab: 1,
      Zone: 1,
      Station: 2,
      Device: 1,
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
