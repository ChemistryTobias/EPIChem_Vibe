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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
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
