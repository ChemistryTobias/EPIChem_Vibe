import { describe, expect, test } from "vitest";

import type { Lab, Site } from "../../api/types";
import { buildLevel } from "./levels";
import type { LayoutData } from "./levels";

const site = (over: Partial<Site> = {}): Site => ({
  id: "s1",
  code: "SITE-1",
  name: "Site 1",
  address: null,
  timezone: null,
  width_m: 40,
  depth_m: 40,
  grid_size_m: 1,
  floors: 2,
  ...over,
});

const lab = (code: string, floor: number): Lab => ({
  id: code,
  code,
  name: code,
  site_id: "s1",
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
  floor,
});

const data = (labs: Lab[]): LayoutData => ({
  sites: [site()],
  labs,
  zones: [],
  stations: [],
  devices: [],
});

describe("site level floor filter (ADR 0013)", () => {
  const labs = [lab("LAB-G", 0), lab("LAB-1A", 1), lab("LAB-1B", 1)];

  test("shows only the viewed floor's labs as boxes", () => {
    const ground = buildLevel({ site: site(), lab: null, station: null, floor: 0 }, data(labs));
    expect(ground.model.boxes.map((b) => b.code)).toEqual(["LAB-G"]);

    const first = buildLevel({ site: site(), lab: null, station: null, floor: 1 }, data(labs));
    expect(first.model.boxes.map((b) => b.code).sort()).toEqual(["LAB-1A", "LAB-1B"]);
  });

  test("a lab on another floor can't be entered from this floor's plan", () => {
    const ground = buildLevel({ site: site(), lab: null, station: null, floor: 0 }, data(labs));
    expect(ground.drillInto("LAB-1A")).toBeNull();
    expect(ground.geometryOf("LAB-1A")).toBeNull();
  });
});
