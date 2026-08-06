/** Device and capability-class endpoints (`api/routers/devices.py`). */

import { apiGet, apiGetPage, query } from "./client";
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
