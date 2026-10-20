/**
 * A small status chip — DESIGN.md's accent set at small scale: green light =
 * done/ok, blue light = in progress, orange = needs attention, and the one
 * sanctioned red for a genuine fault. Grey for everything at rest.
 */

import "./StatusPill.css";

export type Tone = "ok" | "active" | "warning" | "error" | "neutral";

const TONES: Record<string, Tone> = {
  // runs and queue items
  queued: "neutral",
  pending: "neutral",
  running: "active",
  waiting: "warning",
  completed: "ok",
  failed: "error",
  aborted: "error",
  halted: "error",
  stopped: "warning",
  removed: "warning",
  missing: "warning",
  unknown: "neutral",
  // samples
  registered: "neutral",
  staged: "neutral",
  reserved: "active",
  in_process: "active",
  processed: "ok",
  characterized: "ok",
  archived: "neutral",
  consumed: "neutral",
  disposed: "neutral",
  quarantined: "error",
  // station managers
  idle: "ok",
  executing_queue: "active",
  closed: "neutral",
  unreachable: "error",
  // accounts, services
  active: "ok",
  inactive: "neutral",
  online: "ok",
  offline: "error",
};

export function toneOf(status: string): Tone {
  return TONES[status] ?? "neutral";
}

export function StatusPill({ status, tone, title }: { status: string; tone?: Tone; title?: string }) {
  return (
    <span className={`pill pill--${tone ?? toneOf(status)}`} title={title}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
