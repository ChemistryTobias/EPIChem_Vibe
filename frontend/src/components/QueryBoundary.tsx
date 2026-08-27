/** Loading / error branches around a TanStack Query, in one place. */

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { Alert } from "./Alert";

interface QueryBoundaryProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}

export function QueryBoundary<T>({ query, children }: QueryBoundaryProps<T>) {
  if (query.isPending) return <p className="muted">Loading…</p>;
  if (query.isError) {
    return <Alert kind="error">{query.error.message}</Alert>;
  }
  return <>{children(query.data)}</>;
}
