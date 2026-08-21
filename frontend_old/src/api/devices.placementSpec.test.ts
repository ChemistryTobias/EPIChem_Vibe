/**
 * A device placement/soft-hide write is a full-replace PUT (ADR 0004 §3), so
 * `deviceSpec` has to resend the *whole* spec off the row — transport, ophyd,
 * network, parent, capabilities, safety — while overriding only the geometry and
 * `virtual`. The bug this guards is silent data loss: a move that forgot to
 * resend the transport block would wipe a device's driver config on save.
 */

import { describe, expect, test } from "vitest";

import { deviceSpec } from "./devices";
import type { Device } from "./types";

const device: Device = {
  id: "d1",
  code: "DEV-1",
  name: "Hotplate",
  node_kind: "device",
  labels: { vendor: "acme" },
  station_id: "s1",
  parent_id: "p1",
  capability_class_ref: "epichem.classes.HeaterStirrer",
  capability_class_id: "cc1",
  capabilities: ["heat", "stir"],
  ophyd_import: "epichem.ophyd.Hotplate",
  ophyd_args: { addr: 3 },
  transport_protocol: "epics-ca",
  transport_uri: "ca://hp1",
  transport_ioc_host: "ioc-1",
  transport_quality: "degraded",
  network_netbox_device_id: 42,
  network_primary_ip: "10.0.0.9",
  network_mac: "aa:bb",
  network_vlan: "vlan-3",
  pose_x_mm: 10,
  pose_y_mm: 20,
  pose_z_mm: 5,
  pose_yaw_deg: 90,
  size_x_mm: 100,
  size_y_mm: 100,
  size_z_mm: 100,
  envelope: { temperature: { min: 0, max: 300 } },
  safety_flags: ["hot-surface"],
  safety_interlocks: ["lid"],
  safety_max_unattended_minutes: 30,
  operational_mode: "read_write",
  operational_calibration: { last: "2026-01-01" },
  virtual: false,
  station_code: "STA-A",
};

describe("deviceSpec", () => {
  test("overrides geometry + virtual, preserves everything else", () => {
    const spec = deviceSpec(
      device,
      "MOD-1",
      { pose_x_mm: 200, pose_y_mm: 250, size_x_mm: 150, size_y_mm: 120, size_z_mm: 80 },
      true,
    );

    expect(spec).toMatchObject({
      node_kind: "device",
      class: "epichem.classes.HeaterStirrer",
      parent: "MOD-1",
      capabilities: ["heat", "stir"],
      ophyd: { import: "epichem.ophyd.Hotplate", args: { addr: 3 } },
      transport: { protocol: "epics-ca", uri: "ca://hp1", ioc_host: "ioc-1", quality: "degraded" },
      network: { netbox_device_id: 42, primary_ip: "10.0.0.9", mac: "aa:bb", vlan: "vlan-3" },
      safety: { flags: ["hot-surface"], interlocks: ["lid"], max_unattended_minutes: 30 },
      operational: { mode: "read_write", calibration: { last: "2026-01-01" } },
      virtual: true,
      location: {
        station: "STA-A",
        pose: { x_mm: 200, y_mm: 250, z_mm: 5, yaw_deg: 90 },
        footprint: { size_x_mm: 150, size_y_mm: 120, size_z_mm: 80 },
      },
    });
  });

  test("omits class/parent/ophyd/transport for a bare passive module", () => {
    const mod: Device = {
      ...device,
      node_kind: "module",
      capability_class_ref: null,
      ophyd_import: null,
      transport_protocol: null,
    };
    const spec = deviceSpec(mod, null, { pose_x_mm: 0, pose_y_mm: 0, size_x_mm: null, size_y_mm: null, size_z_mm: null }, false);

    expect(spec.class).toBeUndefined();
    expect(spec.parent).toBeUndefined();
    expect(spec.ophyd).toBeUndefined();
    expect(spec.transport).toBeUndefined();
    expect(spec.node_kind).toBe("module");
  });
});
