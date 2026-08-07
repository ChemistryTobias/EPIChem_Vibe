/**
 * The New-Device-first creation flow (ADR 0009), reduced to pure functions so
 * the "walk the prerequisites" logic can be reasoned about (and tested) without
 * React or the network.
 *
 * The guiding principle: adding a device is the frequent action; the
 * scaffolding around it (site → lab → station) is set up rarely and should get
 * out of the way. A device can't exist until a station does, a station until a
 * lab, a lab until a site (ADR 0007). So a "New Device" on a blank slate is a
 * short guided chain; once the scaffolding exists it collapses to a single step
 * (pick the station). A Zone is optional and never a prerequisite.
 */

export type CreateKind = "Site" | "Lab" | "Zone" | "Station" | "Device";

/** How many of each scaffolding kind already exist, from the topology snapshot. */
export interface EntityCounts {
  Site: number;
  Lab: number;
  Station: number;
}

/**
 * The ordered prerequisite chain for a kind — what must exist before it can.
 * Zone is deliberately absent everywhere: it's an optional grouping, never
 * required to reach a device (ADR 0007/0009).
 */
const PREREQUISITES: Record<CreateKind, Exclude<CreateKind, "Zone" | "Device">[]> = {
  Site: [],
  Lab: ["Site"],
  Zone: ["Site", "Lab"],
  Station: ["Site", "Lab"],
  Device: ["Site", "Lab", "Station"],
};

/**
 * The steps to walk to create `target`, given what already exists: each missing
 * prerequisite in dependency order, then the target itself. A prerequisite that
 * already has ≥1 row is skipped — its form becomes a picker of the existing rows
 * rather than a create step.
 */
export function buildCreateFlow(target: CreateKind, counts: EntityCounts): CreateKind[] {
  const missing = PREREQUISITES[target].filter((k) => counts[k] === 0);
  return [...missing, target];
}

export const KIND_LABEL: Record<CreateKind, string> = {
  Site: "Site",
  Lab: "Lab",
  Zone: "Zone",
  Station: "Station",
  Device: "Device",
};

/** Descriptor-spec enums, mirrored from `schemas/descriptor.py` for the selects. */
export const ENVIRONMENT_CLASSES = ["ambient", "glovebox", "fume_hood", "cleanroom"] as const;
export const ATMOSPHERES = ["air", "n2", "ar"] as const;
export const OCCUPANCIES = ["human", "robot", "shared"] as const;
export const STATION_STATES = ["active", "maintenance", "offline"] as const;
export const DEVICE_MODES = ["read_write", "read_only", "maintenance", "disabled"] as const;
export const NODE_KINDS = ["device", "module"] as const;
