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
}

export interface Workcell {
  id: string;
  code: string;
  name: string;
  zone_id: string;
  queueserver_endpoint: string | null;
  redis_namespace: string | null;
  state: string;
  owning_group: string | null;
}

export interface Bench {
  id: string;
  code: string;
  name: string;
  workcell_id: string;
  grid_cols: number;
  grid_rows: number;
  height_mm: number | null;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  bench_id: string;
  kind: string;
  grid_col: number;
  grid_row: number;
  stack_height: number;
  capacity: number;
  accepted_labware_types: string[];
}

export interface Device {
  id: string;
  code: string;
  name: string;
  labels: Record<string, string>;
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
  /** Derived from the station_device_bindings join, not a Device column. */
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
