/**
 * The app's entire data-fetching layer: run an async function, expose
 * {data, error, loading, reload}.
 *
 * Deliberately not TanStack Query / SWR. Three screens, each doing one or
 * two GETs, no cross-screen cache to keep coherent — a caching library would
 * be more machinery than the problem has. If background refetching or
 * optimistic updates ever become real requirements, swap this file for one;
 * every screen consumes the same four-field shape, so the blast radius is
 * this file plus its call sites.
 */

import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Re-run the fetch — used by "Retry" and after a write. */
  reload: () => void;
}

/**
 * @param fn    the fetch to run. Wrap it in `useCallback` (or define it
 *              inline with no closed-over state) — this hook re-runs
 *              whenever `fn` changes identity, which is how filters work.
 */
export function useAsync<T>(fn: () => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // Guards against a slow earlier request resolving after a newer one and
    // overwriting it (and against setting state on an unmounted component).
    let cancelled = false;
    setLoading(true);
    fn().then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fn, nonce]);

  return { data, error, loading, reload };
}
