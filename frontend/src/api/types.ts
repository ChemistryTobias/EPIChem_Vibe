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
  object_geometry: GeometryDescriptor | null;
}

/** `parent_type` is derived server-side from `parent_uuid`; it is read-only. */
export interface Zone extends ObjectBase {
  tag: string | null;
  parent_uuid: string;
  parent_type: string;
  object_geometry: GeometryDescriptor | null;
}

/** Module and Device are the same shape today — the backend has no
 * descriptor fields (ophyd/transport/network/safety) yet. */
export interface Module extends ObjectBase {
  station_uuid: string;
  object_geometry: GeometryDescriptor | null;
}

export type Device = Module;

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
