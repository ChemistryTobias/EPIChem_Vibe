/**
 * The `*EditSpec` builders fold a handful of edited fields over the rest of the
 * row, because a PUT is a full replace (ADR 0004 §3). The bug they exist to
 * prevent is silent data loss: an edit that forgets to resend the lab's canvas
 * geometry or a station's box would reset those to backend defaults on save.
 * These tests pin the preserved fields.
 */

import { describe, expect, test } from "vitest";

import { labEditSpec, siteEditSpec, stationEditSpec, zoneEditSpec } from "./topology";
import type { Lab, Station, Zone } from "./types";

const lab: Lab = {
  id: "l1",
  code: "LAB-1",
  name: "Lab 1",
  site_id: "s1",
  room_number: "1.02",
  environment_class: "ambient",
  access_control_group: "acg-chem",
  width_m: 8,
  depth_m: 5,
  grid_size_m: 0.25,
  site_pos_x: 3,
  site_pos_y: 4,
  site_size_x_m: 12,
  site_size_y_m: 9,
  floor: 2,
};

const zone: Zone = {
  id: "z1",
  code: "ZONE-1",
  name: "Zone 1",
  lab_id: "l1",
  atmosphere: "n2",
  pressure: "1.1 bar",
  temperature_class: "T3",
  hazard_class: "ATEX-2",
  occupancy: "robot",
};

const station: Station = {
  id: "st1",
  code: "ST-1",
  name: "Station 1",
  lab_id: "l1",
  zone_id: "z1",
  kind: "spincoater",
  pos_x: 2.5,
  pos_y: 1.5,
  size_x_m: 1.2,
  size_y_m: 0.8,
  height_m: 0.9,
  capacity: 4,
  accepted_labware_types: ["wafer"],
  queueserver_endpoint: "tcp://qs:60615",
  redis_namespace: "st1",
  state: "active",
  owning_group: "team-pv",
  virtual: false,
};

describe("siteEditSpec", () => {
  test("passes address/timezone through, nulls included", () => {
    expect(siteEditSpec({ name: "x", address: null, timezone: "Europe/Berlin" })).toEqual({
      address: null,
      timezone: "Europe/Berlin",
    });
  });
});

describe("labEditSpec", () => {
  test("preserves the canvas geometry and access group the form doesn't show", () => {
    const spec = labEditSpec(lab, {
      name: "renamed",
      site: "SITE-2",
      room_number: "9.99",
      environment_class: "glovebox",
    });
    expect(spec).toEqual({
      site: "SITE-2",
      room_number: "9.99",
      environment_class: "glovebox",
      access_control_group: "acg-chem",
      width_m: 8,
      depth_m: 5,
      grid_size_m: 0.25,
      site_pos_x: 3,
      site_pos_y: 4,
      site_size_x_m: 12,
      site_size_y_m: 9,
      floor: 2,
    });
  });
});

describe("zoneEditSpec", () => {
  test("preserves pressure/temperature/hazard", () => {
    const spec = zoneEditSpec(zone, { name: "x", lab: "LAB-1", atmosphere: "ar", occupancy: "shared" });
    expect(spec).toMatchObject({
      atmosphere: "ar",
      occupancy: "shared",
      pressure: "1.1 bar",
      temperature_class: "T3",
      hazard_class: "ATEX-2",
    });
  });
});

describe("stationEditSpec", () => {
  test("preserves the box (pos/size/height), labware and execution binding", () => {
    const spec = stationEditSpec(station, {
      name: "x",
      lab: "LAB-1",
      zone: null,
      kind: "generic",
      capacity: 1,
      state: "maintenance",
      owning_group: null,
    });
    expect(spec).toMatchObject({
      zone: null,
      capacity: 1,
      state: "maintenance",
      owning_group: null,
      pos_x: 2.5,
      pos_y: 1.5,
      size_x_m: 1.2,
      size_y_m: 0.8,
      height_m: 0.9,
      accepted_labware_types: ["wafer"],
      queueserver_endpoint: "tcp://qs:60615",
      redis_namespace: "st1",
      virtual: false,
    });
  });
});
