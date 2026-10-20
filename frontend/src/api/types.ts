/**
 * TypeScript mirrors of `backend/app/**\/schema.py`.
 *
 * Hand-written rather than generated: there are a handful of them and a
 * human can read this file. Keep field-for-field in sync with the backend —
 * nothing checks it for you. The primary key is `uuid` everywhere, never `id`.
 */

export interface ObjectBase {
  uuid: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeometryDescriptor {
  detail: string;
  shape: "rectangle" | "sphere" | "cylinder";
  box_position_xyz: [number, number, number];
  box_dimension_xyz: [number, number, number];
  /** Named points inside the object — a port, a mount, a pick position. Each
   * entry sets its own length. Mirrored so the types stay honest; nothing
   * renders it yet. */
  internal_positions: Record<string, number[]>;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Site is the only entity whose geometry is a LIST (one entry per floor). */
export interface Site extends ObjectBase {
  organisation: string | null;
  address: string | null;
  coordinates: Coordinates | null;
  timezone: string | null;
  object_geometry: GeometryDescriptor[];
}

export interface Lab extends ObjectBase {
  room_number: string | null;
  site_uuid: string;
  zone_uuid: string | null;
  object_geometry: GeometryDescriptor | null;
}

export interface Station extends ObjectBase {
  lab_uuid: string;
  zone_uuid: string | null;
  /** The station pod's bluesky-httpserver; null means not executable. */
  queueserver_url: string | null;
  object_geometry: GeometryDescriptor | null;
}

/** `parent_type` is derived server-side from `parent_uuid`; it is read-only. */
export interface Zone extends ObjectBase {
  tag: string | null;
  parent_uuid: string;
  parent_type: string;
  object_geometry: GeometryDescriptor | null;
}

export interface Module extends ObjectBase {
  station_uuid: string;
  object_geometry: GeometryDescriptor | null;
}

/** A device's first descriptor field is its name in the station pod — the
 * link to the ophyd object plans take as an argument. */
export interface Device extends Module {
  ophyd_name: string | null;
}

export interface Revision {
  uuid: string;
  entity_type: string;
  entity_uuid: string;
  action: string;
  snapshot: Record<string, unknown>;
  actor_uuid: string | null;
  created_at: string;
}

/** The device-management entities, as a kind name and as a row union. */
export type EntityKind = "Site" | "Lab" | "Zone" | "Station" | "Module" | "Device";
export type EntityRow = Site | Lab | Zone | Station | Module | Device;

// ---------------------------------------------------------------- workflows

/** One plan parameter, as bluesky-queueserver represents it (plan §9.2). */
export interface PlanParameter {
  name: string;
  kind: { name: string; value?: number };
  description?: string;
  annotation?: {
    type?: string;
    devices?: Record<string, string[]>;
    plans?: Record<string, string[]>;
    enums?: Record<string, string[]>;
  };
  /** Python literals as strings ("True", "5", "'a'"); absent = required. */
  default?: string;
  min?: string;
  max?: string;
  step?: string;
}

export interface PlanRepr {
  name: string;
  module?: string;
  description?: string;
  parameters: PlanParameter[];
}

export interface Palette {
  plans: Record<string, PlanRepr>;
  devices: Record<string, { classname?: string; module?: string }>;
  /** Pod devices that have a registry Device on this station. */
  registered: string[];
}

export interface ExecutionStatus {
  configured: boolean;
  reachable: boolean;
  url: string | null;
  error: string | null;
  status: {
    manager_state: string;
    re_state: string | null;
    worker_environment_exists: boolean;
    worker_environment_state: string;
    items_in_queue: number;
    items_in_history: number;
    running_item_uid: string | null;
    queue_stop_pending: boolean;
  } | null;
}

export interface QueueItem {
  item_uid: string;
  name: string;
  kwargs?: Record<string, unknown>;
  meta?: { epichem?: Record<string, unknown> };
  result?: { exit_status: string; msg?: string; run_uids?: string[]; time_start?: number; time_stop?: number };
}

export interface StationQueue {
  items: QueueItem[];
  running_item: QueueItem | null;
  history: QueueItem[];
}

export interface ProcedureStep {
  id: string;
  plan: string;
  kwargs: Record<string, unknown>;
  label?: string | null;
  position?: [number, number] | null;
}

export interface Procedure extends ObjectBase {
  station_uuid: string | null;
  steps: ProcedureStep[];
  version: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  step_id: string | null;
  parameter: string | null;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export type RunState = "queued" | "running" | "completed" | "failed" | "stopped" | "unknown";

export interface RunItem {
  step_id: string;
  plan: string;
  kwargs: Record<string, unknown>;
  item_uid: string | null;
  /** pending | running | removed | missing, or the queueserver's exit status. */
  status: string;
  run_uids: string[];
  message: string | null;
  time_start: number | null;
  time_stop: number | null;
}

export interface Run {
  uuid: string;
  code: string;
  procedure_uuid: string;
  procedure_name: string;
  procedure_version: number;
  station_uuid: string;
  state: RunState;
  items: RunItem[];
  error: string | null;
  sync_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  sample_uuids: string[];
}

// ------------------------------------------------------------------ samples

export type SampleState =
  | "registered"
  | "staged"
  | "reserved"
  | "in_process"
  | "processed"
  | "characterized"
  | "archived"
  | "consumed"
  | "disposed"
  | "quarantined";

export interface Sample {
  uuid: string;
  code: string;
  name: string;
  description: string | null;
  state: SampleState;
  substance: string | null;
  amount_value: number | null;
  amount_unit: string | null;
  notes: string | null;
  station_uuid: string | null;
  owner_uuid: string | null;
  run_uuid: string | null;
  parameters: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SampleEvent {
  uuid: string;
  from_state: SampleState | null;
  to_state: SampleState;
  at: string;
  actor_uuid: string | null;
  run_uuid: string | null;
  station_uuid: string | null;
  reason: string | null;
}

export interface SampleDetail extends Sample {
  events: SampleEvent[];
}
