/** Shared cell formatting for the registry tables. */

import type { ReactNode } from "react";

/** Nullable values render as an em dash rather than an empty cell. */
export function orDash(value: string | number | null | undefined): ReactNode {
  return value === null || value === undefined || value === "" ? (
    <span className="muted">—</span>
  ) : (
    value
  );
}

/**
 * The backend stamps times as naive UTC ("2026-10-20T08:36:17"), which a bare
 * `new Date()` would read as local time. Treat anything without an offset as
 * UTC.
 */
export function parseUtc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export function formatDate(iso: string): string {
  return parseUtc(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? parseUtc(iso).toLocaleString() : "—";
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? parseUtc(iso).toLocaleTimeString() : "—";
}

/** 75 -> "1 min 15 s"; for run and step durations. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Seconds between two stamps, the second defaulting to now. */
export function secondsBetween(from: string | null, to: string | null): number | null {
  if (!from) return null;
  return ((to ? parseUtc(to) : new Date()).getTime() - parseUtc(from).getTime()) / 1000;
}

/** uuid -> name, for resolving a parent reference to something readable. */
export function nameMap(rows: { uuid: string; name: string }[] | undefined) {
  return new Map((rows ?? []).map((row) => [row.uuid, row.name]));
}

/** True when any of the given fields contains `query` (blank query matches). */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
