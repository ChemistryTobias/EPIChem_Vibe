/**
 * The one alert schema for the whole app: transient info / success / warning /
 * error messages that pop out at the **bottom-left**, one flat card each — the
 * same look the Lab-layout overlay used, promoted to a shared component so every
 * screen raises alerts the same way instead of each rolling its own box.
 *
 * A screen calls `useNotify()` and gets `notify({ kind, message })`. Not for
 * form-field validation (that stays inline next to the field) or a whole-screen
 * load/error state (`AsyncBoundary`) — those are contextual; this is for events.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import "./Notifications.css";

export type NoticeKind = "info" | "success" | "warning" | "error";

export interface NotifyInput {
  kind: NoticeKind;
  message: ReactNode;
  /** Auto-dismiss after this many ms; `null` keeps it until dismissed. Defaults
   * per kind (errors stick, the rest fade). */
  ttl?: number | null;
  /** A stable key dedupes a repeated event (e.g. a hint fired on every attempt):
   * a new notify with the same key replaces the old card instead of stacking. */
  key?: string;
}

interface Notice {
  id: string;
  kind: NoticeKind;
  message: ReactNode;
}

interface NotificationsApi {
  notify: (input: NotifyInput) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_TTL: Record<NoticeKind, number | null> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: null, // errors stay until dismissed — they're the ones worth reading
};

const NotificationsContext = createContext<NotificationsApi | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, number>());
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (input: NotifyInput) => {
      const id = input.key ?? `n${(seq.current += 1)}`;
      const ttl = input.ttl === undefined ? DEFAULT_TTL[input.kind] : input.ttl;
      setItems((xs) => [
        ...xs.filter((x) => x.id !== id),
        { id, kind: input.kind, message: input.message },
      ]);
      const prev = timers.current.get(id);
      if (prev) clearTimeout(prev);
      if (ttl != null) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), ttl));
      } else {
        timers.current.delete(id);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationsContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((n) => (
          <div
            key={n.id}
            className={`notice notice--${n.kind}`}
            role={n.kind === "error" ? "alert" : "status"}
          >
            <button
              type="button"
              className="notice__dismiss"
              aria-label="Dismiss"
              onClick={() => dismiss(n.id)}
            >
              ×
            </button>
            {n.message}
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

/** Full API (notify + dismiss). Most callers want {@link useNotify}. */
export function useNotifications(): NotificationsApi {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within <NotificationsProvider>");
  return ctx;
}

/** The common case: `notify({ kind, message })`. */
export function useNotify(): NotificationsApi["notify"] {
  return useNotifications().notify;
}
