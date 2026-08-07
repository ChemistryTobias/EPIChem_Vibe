/** Device and capability-class endpoints (`api/routers/devices.py`). */

import { apiDelete, apiGet, apiGetPage, apiPost, query } from "./client";
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
}

export const createDevice = (body: DeviceCreate) => {
  const spec: Record<string, unknown> = {
    node_kind: body.node_kind,
    location: { station: body.station },
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
