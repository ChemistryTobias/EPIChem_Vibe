/**
 * Device vocabulary → the domain-free tones `StatusDot` understands.
 *
 * `operational_mode` values come from `OperationalSpec.mode` in
 * `backend/epichem/schemas/descriptor.py`. Keep this in sync with that
 * Literal; an unknown mode falls back to "muted" rather than throwing.
 */

import type { Tone } from "../../components/StatusDot";

const TONE_BY_MODE: Record<string, Tone> = {
  read_write: "ok",
  read_only: "info",
  maintenance: "warn",
  disabled: "muted",
};

export function deviceTone(mode: string): Tone {
  return TONE_BY_MODE[mode] ?? "muted";
}
