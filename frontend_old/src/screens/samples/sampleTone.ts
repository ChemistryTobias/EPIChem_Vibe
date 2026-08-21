/**
 * Sample lifecycle vocabulary → `StatusDot` tones.
 *
 * The states are §7.3's; keep in sync with `SAMPLE_STATES` in
 * `backend/epichem/schemas/sample.py`. Grouping: in-flight states read as
 * "info", the terminal ones as "muted", quarantine as "danger".
 */

import type { Tone } from "../../components/StatusDot";

const TONE_BY_STATE: Record<string, Tone> = {
  registered: "ok",
  staged: "info",
  reserved: "info",
  in_process: "info",
  processed: "ok",
  characterized: "ok",
  archived: "muted",
  consumed: "muted",
  disposed: "muted",
  quarantined: "danger",
};

export function sampleTone(state: string): Tone {
  return TONE_BY_STATE[state] ?? "muted";
}

/** "in_process" → "in process", for display only. */
export function humanState(state: string): string {
  return state.replace(/_/g, " ");
}

/** "1.5 mL", or null when there's no amount to show. */
export function formatAmount(value: number | null, unit: string | null): string | null {
  if (value === null) return unit ?? null;
  return unit ? `${value} ${unit}` : `${value}`;
}
