/**
 * `buildCreateFlow` is the one real decision in the creation flow — how many
 * scaffolding steps a "New X" has to walk given what already exists — so it's
 * where a test earns its keep.
 */

import { describe, expect, test } from "vitest";

import { buildCreateFlow } from "./nodeCreate";

const empty = { Site: 0, Lab: 0, Station: 0 };
const full = { Site: 1, Lab: 1, Station: 1 };

describe("buildCreateFlow", () => {
  test("a device on a blank slate walks site → lab → station → device", () => {
    expect(buildCreateFlow("Device", empty)).toEqual(["Site", "Lab", "Station", "Device"]);
  });

  test("a device collapses to one step once the scaffolding exists", () => {
    expect(buildCreateFlow("Device", full)).toEqual(["Device"]);
  });

  test("only the missing prerequisites are prepended, in dependency order", () => {
    // A site exists but no lab/station: skip the site step, keep the rest.
    expect(buildCreateFlow("Device", { Site: 1, Lab: 0, Station: 0 })).toEqual([
      "Lab",
      "Station",
      "Device",
    ]);
    // Site and lab exist, no station: only the station step remains before the device.
    expect(buildCreateFlow("Device", { Site: 1, Lab: 1, Station: 0 })).toEqual([
      "Station",
      "Device",
    ]);
  });

  test("a station needs a lab (and a site) but never a zone", () => {
    expect(buildCreateFlow("Station", empty)).toEqual(["Site", "Lab", "Station"]);
    expect(buildCreateFlow("Station", full)).toEqual(["Station"]);
  });

  test("a zone is optional and only needs a lab", () => {
    expect(buildCreateFlow("Zone", empty)).toEqual(["Site", "Lab", "Zone"]);
    expect(buildCreateFlow("Zone", { Site: 1, Lab: 1, Station: 0 })).toEqual(["Zone"]);
  });

  test("a site has no prerequisites", () => {
    expect(buildCreateFlow("Site", empty)).toEqual(["Site"]);
  });
});
