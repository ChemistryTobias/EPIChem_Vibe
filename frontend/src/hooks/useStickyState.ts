/**
 * `useState` whose value survives the component *unmounting and remounting*
 * within the same page session — a module-level store keyed by a string.
 *
 * The app has no router (deliberate — see `frontend/README.md`); switching
 * sections unmounts the previous screen, so a screen's local state is normally
 * lost. The Lab-layout editor wants the opposite: leave it and come back and you
 * should land on the same level (site/lab/station) and the same edit session you
 * left, not a fresh reload. Storing that state here (outside React) keeps it
 * across mounts. A full page reload clears it — that's fine, it's session state,
 * not persisted data.
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

const store = new Map<string, unknown>();

export function useStickyState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  useEffect(() => {
    store.set(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** Drop a sticky value (e.g. after it's been consumed/reset). */
export function clearStickyState(key: string): void {
  store.delete(key);
}
