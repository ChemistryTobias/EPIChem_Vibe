/** Device and capability-class endpoints (`api/routers/devices.py`). */

import { apiGet, query } from "./client";
import type { CapabilityClass, Device } from "./types";

export interface DeviceFilters {
  lab?: string;
  capability_class?: string;
  capability?: string;
  mode?: string;
}

export const listDevices = (filters: DeviceFilters = {}) =>
  apiGet<Device[]>(`/devices${query(filters)}`);

export const getDevice = (ident: string) => apiGet<Device>(`/devices/${encodeURIComponent(ident)}`);

export const listCapabilityClasses = () => apiGet<CapabilityClass[]>("/device-classes");
