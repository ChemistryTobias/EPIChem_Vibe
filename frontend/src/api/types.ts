/**
 * TypeScript mirrors of the backend's response schemas
 * (`backend/epichem/api/schemas.py`).
 *
 * These are hand-written rather than generated from the OpenAPI document, on
 * purpose: there are ~10 of them, they change when the registry schema
 * changes (rarely), and a hand-written file is something a human can read
 * and diff. If this ever grows past "a page you can hold in your head",
 * switch to codegen — but not before.
 *
 * Keep field-for-field in sync with `api/schemas.py`. Anything the backend
 * types as `X | None` is `X | null` here (FastAPI serialises None to null,
 * and the key is always present).
 */

export interface Site {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string | null;
}

export interface Lab {
  id: string;
  code: string;
  name: string;
  site_id: string;
  room_number: string | null;
  environment_class: string;
  access_control_group: string | null;
  /** The lab is a metric canvas (ADR 0010): floor size and grid spacing in
   * metres. The guide-cell count is derived (width_m / grid_size_m). */
  width_m: number;
  depth_m: number;
  grid_size_m: number;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  lab_id: string;
  atmosphere: string;
  pressure: string | null;
  temperature_class: string | null;
  hazard_class: string | null;
  /** §12.2 safety classification: human | robot | shared. */
  occupancy: string;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  /** A station always belongs to a lab; a zone is optional (ADR 0007). */
  lab_id: string;
  zone_id: string | null;
  kind: string;
  /** The station's box on the lab canvas, in metres (ADR 0010): position from
   * the lab origin (snap-but-not-bound), footprint, and isometric box height. */
  pos_x: number;
  pos_y: number;
  size_x_m: number;
  size_y_m: number;
  height_m: number;
  capacity: number;
  accepted_labware_types: string[];
  /** Execution binding, moved off the removed Workcell (ADR 0007). */
  queueserver_endpoint: string | null;
  redis_namespace: string | null;
  state: string;
  owning_group: string | null;
}

export interface Device {
  id: string;
  code: string;
  name: string;
  /** "device" (controllable leaf) or "module" (grouping/passive), ADR 0007. */
  node_kind: string;
  labels: Record<string, string>;
  /** The station this node belongs to (ADR 0007: a direct FK, not a binding). */
  station_id: string | null;
  parent_id: string | null;
  capability_class_ref: string | null;
  capability_class_id: string | null;
  capabilities: string[];
  ophyd_import: string | null;
  ophyd_args: Record<string, unknown>;
  transport_protocol: string | null;
  transport_uri: string | null;
  transport_ioc_host: string | null;
  /** §6.2 nominal|degraded — flags a degraded vendor-bridge onboarding path. */
  transport_quality: string;
  network_netbox_device_id: number | null;
  network_primary_ip: string | null;
  network_mac: string | null;
  network_vlan: string | null;
  pose_x_mm: number | null;
  pose_y_mm: number | null;
  pose_z_mm: number | null;
  pose_yaw_deg: number | null;
  envelope: Record<string, Record<string, unknown>>;
  safety_flags: string[];
  safety_interlocks: string[];
  safety_max_unattended_minutes: number | null;
  operational_mode: string;
  operational_calibration: Record<string, unknown> | null;
  /** Derived from the station FK (Device.station_code property), not a column. */
  station_code: string | null;
}

export interface CapabilityClass {
  id: string;
  name: string;
  iri: string | null;
  extends: string[];
  actions: Record<string, unknown>;
}

export interface Sample {
  id: string;
  code: string;
  name: string;
  state: string;
  substance: string | null;
  amount_value: number | null;
  amount_unit: string | null;
  location: string | null;
  owner: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Body for POST/PUT /api/v1/samples — mirrors `schemas/sample.py::SampleWrite`. */
export interface SampleWrite {
  code: string;
  name: string;
  state: SampleState;
  substance: string | null;
  amount_value: number | null;
  amount_unit: string | null;
  location: string | null;
  owner: string | null;
  notes: string | null;
}

/** §7.3 lifecycle states — keep in sync with `schemas/sample.py::SAMPLE_STATES`. */
export const SAMPLE_STATES = [
  "registered",
  "staged",
  "reserved",
  "in_process",
  "processed",
  "characterized",
  "archived",
  "consumed",
  "disposed",
  "quarantined",
] as const;

export type SampleState = (typeof SAMPLE_STATES)[number];
