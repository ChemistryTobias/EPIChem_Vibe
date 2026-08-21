/**
 * Shared constants for the creation flow (ADR 0009).
 *
 * Creation happens in the right-hand inspector (`CreateInspector.tsx`): a
 * single-kind form with a parent picker, and a live draft row that appears in
 * the tree as you type and is only written when you press Create. A kind whose
 * required parent doesn't exist yet points you at creating that parent first
 * (`REQUIRED_PARENT`), rather than walking a multi-step wizard.
 */

export type CreateKind = "Site" | "Lab" | "Zone" | "Station" | "Device";

export const KIND_LABEL: Record<CreateKind, string> = {
  Site: "Site",
  Lab: "Lab",
  Zone: "Zone",
  Station: "Station",
  Device: "Device",
};

/**
 * The one parent a kind can't be created without, or null for Site (a Zone's
 * lab and a Station's lab are required; a Station's zone is optional and so
 * isn't here). Used to prompt "create a Lab first" when the picker is empty.
 */
export const REQUIRED_PARENT: Record<CreateKind, CreateKind | null> = {
  Site: null,
  Lab: "Site",
  Zone: "Lab",
  Station: "Lab",
  Device: "Station",
};

/** Descriptor-spec enums, mirrored from `schemas/descriptor.py` for the selects. */
export const ENVIRONMENT_CLASSES = ["ambient", "glovebox", "fume_hood", "cleanroom"] as const;
export const ATMOSPHERES = ["air", "n2", "ar"] as const;
export const OCCUPANCIES = ["human", "robot", "shared"] as const;
export const STATION_STATES = ["active", "maintenance", "offline"] as const;
export const DEVICE_MODES = ["read_write", "read_only", "maintenance", "disabled"] as const;
export const NODE_KINDS = ["device", "module"] as const;
