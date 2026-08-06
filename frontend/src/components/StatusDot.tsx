/**
 * A small colored dot plus its label — the status idiom the whole console
 * uses (device modes, workcell states, sample lifecycle states).
 *
 * `tone` is intentionally domain-free: each screen maps its own vocabulary
 * onto these five tones (see e.g. `screens/devices/deviceTone.ts`), so this
 * component never has to know what "read_write" or "quarantined" mean.
 *
 * The tone colors are the MPG accent palette, which DESIGN.md §2 restricts
 * to exactly this kind of small-scale use.
 */

import "./StatusDot.css";

export type Tone = "ok" | "info" | "warn" | "danger" | "muted";

interface StatusDotProps {
  tone: Tone;
  label: string;
  /** Render the dot on its own, for dense table cells. */
  hideLabel?: boolean;
}

export function StatusDot({ tone, label, hideLabel = false }: StatusDotProps) {
  return (
    <span className="status" title={hideLabel ? label : undefined}>
      <span className={`status__dot status__dot--${tone}`} aria-hidden="true" />
      {hideLabel ? <span className="status__sr">{label}</span> : <span>{label}</span>}
    </span>
  );
}
