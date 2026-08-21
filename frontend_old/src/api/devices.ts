/** Device and capability-class endpoints (`api/routers/devices.py`). */

import { apiDelete, apiGet, apiGetPage, apiPost, apiPut, query } from "./client";
import type { CapabilityClass, Device } from "./types";

export interface DeviceFilters {
  lab?: string;
  capability_class?: string;
  capability?: string;
  mode?: string;
  limit?: number;
  offset?: number;
}

export const listDevices = (filters: DeviceFilters = {}) =>
  apiGetPage<Device>(`/devices${query(filters)}`);

export const getDevice = (ident: string) => apiGet<Device>(`/devices/${encodeURIComponent(ident)}`);

export const listCapabilityClasses = () => apiGet<CapabilityClass[]>("/device-classes");

/**
 * Register a device (ADR 0009). Only the fields the creation form collects are
 * sent; the backend's `DeviceSpec` defaults the rest (transport, network,
 * envelope, safety — schemas/descriptor.py). `class` is the capability class
 * name (omitted for a passive module); `station` is where it lives.
 */
export interface DeviceCreate {
  code: string;
  name: string;
  node_kind: string;
  /** CapabilityClass name, or null for a passive module. */
  capability_class: string | null;
  /** Station.code this device lives in, or null if not yet placed. */
  station: string | null;
  operational_mode: string;
  // Optional placement within the station canvas (ADR 0012), in mm. The Lab
  // Layout editor sets these so a created device lands where it was dropped; the
  // hierarchy create form omits them (the backend defaults pose to 0 and leaves
  // the footprint null → a standard 0.1 m box).
  pose_x_mm?: number;
  pose_y_mm?: number;
  size_x_mm?: number;
  size_y_mm?: number;
  size_z_mm?: number;
}

export const createDevice = (body: DeviceCreate) => {
  const location: Record<string, unknown> = { station: body.station };
  if (body.pose_x_mm != null || body.pose_y_mm != null) {
    location.pose = { x_mm: body.pose_x_mm ?? 0, y_mm: body.pose_y_mm ?? 0 };
  }
  if (body.size_x_mm != null || body.size_y_mm != null || body.size_z_mm != null) {
    location.footprint = {
      size_x_mm: body.size_x_mm,
      size_y_mm: body.size_y_mm,
      size_z_mm: body.size_z_mm,
    };
  }
  const spec: Record<string, unknown> = {
    node_kind: body.node_kind,
    location,
    operational: { mode: body.operational_mode },
  };
  // Only send `class` when set — an empty string would fail reference resolution.
  if (body.capability_class) spec.class = body.capability_class;
  return apiPost<Device>("/devices", {
    apiVersion: "epichem.dev/v1",
    kind: "Device",
    metadata: { code: body.code, name: body.name },
    spec,
  });
};

/**
 * Hard-delete a device by code. Its pre-delete snapshot survives in the device's
 * Revision history (ADR 0004). Device *editing* isn't here yet — a device's
 * full-replace spec carries transport/ophyd/network/module-parent config whose
 * faithful reconstruction belongs with the Device Status screen (M2).
 */
export const deleteDevice = (code: string) => apiDelete(`/devices/${encodeURIComponent(code)}`);

// ---- placement + soft-hide on the Station canvas (ADRs 0011, 0012) ----------
//
// A device/module has a position (pose_x_mm/y_mm) and a footprint (size_*_mm)
// within its station's canvas. Moving/resizing/soft-hiding one is a full-replace
// PUT (ADR 0004 §3), which means every DeviceSpec field has to be sent or the
// backend resets it. `deviceSpec` reconstructs the whole spec off the row so a
// placement write never silently drops transport/ophyd/network/parent config —
// the exact risk that kept plain device editing out of the Device Status screen.
// `parentCode` is resolved by the caller from the loaded snapshot, because the
// row carries `parent_id`, not the parent's code.

/** A device's box within its station canvas, in mm (ADR 0012). */
export interface DeviceGeometry {
  pose_x_mm: number | null;
  pose_y_mm: number | null;
  size_x_mm: number | null;
  size_y_mm: number | null;
  size_z_mm: number | null;
}

const deviceGeometry = (d: Device): DeviceGeometry => ({
  pose_x_mm: d.pose_x_mm,
  pose_y_mm: d.pose_y_mm,
  size_x_mm: d.size_x_mm,
  size_y_mm: d.size_y_mm,
  size_z_mm: d.size_z_mm,
});

/**
 * The full DeviceSpec reconstructed off a row, with geometry + `virtual`
 * overridden. Exported and pure so the preservation can be unit-tested without a
 * network round-trip — a dropped field here is silent data loss on a placement
 * PUT (the reason plain device editing was deferred).
 */
export function deviceSpec(
  device: Device,
  parentCode: string | null,
  geom: DeviceGeometry,
  virtual: boolean,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    node_kind: device.node_kind,
    capabilities: device.capabilities,
    envelope: device.envelope,
    network: {
      netbox_device_id: device.network_netbox_device_id,
      primary_ip: device.network_primary_ip,
      mac: device.network_mac,
      vlan: device.network_vlan,
    },
    safety: {
      flags: device.safety_flags,
      interlocks: device.safety_interlocks,
      max_unattended_minutes: device.safety_max_unattended_minutes,
    },
    operational: {
      mode: device.operational_mode,
      calibration: device.operational_calibration,
    },
    location: {
      station: device.station_code,
      pose: {
        x_mm: geom.pose_x_mm,
        y_mm: geom.pose_y_mm,
        z_mm: device.pose_z_mm,
        yaw_deg: device.pose_yaw_deg,
      },
      footprint: {
        size_x_mm: geom.size_x_mm,
        size_y_mm: geom.size_y_mm,
        size_z_mm: geom.size_z_mm,
      },
    },
    virtual,
  };
  // Omit when unset — an empty `class` fails reference resolution (matches createDevice).
  if (device.capability_class_ref) spec.class = device.capability_class_ref;
  if (parentCode) spec.parent = parentCode;
  if (device.ophyd_import) spec.ophyd = { import: device.ophyd_import, args: device.ophyd_args };
  if (device.transport_protocol) {
    spec.transport = {
      protocol: device.transport_protocol,
      uri: device.transport_uri,
      ioc_host: device.transport_ioc_host,
      quality: device.transport_quality,
    };
  }
  return spec;
}

const putDevice = (device: Device, spec: Record<string, unknown>) =>
  apiPut<Device>(`/devices/${encodeURIComponent(device.code)}`, {
    apiVersion: "epichem.dev/v1",
    kind: "Device",
    // Labels live in metadata; resend them or a full replace clears them.
    metadata: { code: device.code, name: device.name, labels: device.labels },
    spec,
  });

/** Move/resize a device's box on its station canvas (position + footprint). */
export const placeDeviceInStation = (
  device: Device,
  parentCode: string | null,
  geom: DeviceGeometry,
) => putDevice(device, deviceSpec(device, parentCode, geom, device.virtual));

/** Soft-hide (or un-hide) a device/module from the canvas (ADR 0011). */
export const setDeviceVirtual = (device: Device, parentCode: string | null, virtual: boolean) =>
  putDevice(device, deviceSpec(device, parentCode, deviceGeometry(device), virtual));
