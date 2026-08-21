/**
 * The loading / error / empty triad, in one place.
 *
 * Every screen fetches, so every screen would otherwise hand-roll the same
 * three branches — and the "error" one is the one that gets skipped, leaving
 * a blank page when the backend is down. Screens pass their `useAsync`
 * result straight in and only write the success case.
 */

import type { ReactNode } from "react";

import { ApiError } from "../api/client";
import type { AsyncState } from "../hooks/useAsync";
import { Button } from "./Button";

import "./AsyncBoundary.css";

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /** Shown instead of children when the fetch succeeded but returned nothing. */
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

export function AsyncBoundary<T>({ state, empty, isEmpty, children }: AsyncBoundaryProps<T>) {
  const { data, error, loading, reload } = state;

  if (error) {
    return (
      <div className="async async--error" role="alert">
        <p className="label">{error instanceof ApiError ? `Error ${error.status || ""}`.trim() : "Error"}</p>
        <p className="async__title">{error instanceof ApiError ? error.message : error.message}</p>
        <Button variant="secondary" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  // Keep showing the previous data while a reload is in flight — swapping to
  // a spinner on every filter keystroke makes the table flicker.
  if (loading && data === null) {
    return <div className="async async--loading label">Loading…</div>;
  }

  if (data === null) return null;
  if (empty && isEmpty?.(data)) return <div className="async async--empty">{empty}</div>;

  return <>{children(data)}</>;
}
