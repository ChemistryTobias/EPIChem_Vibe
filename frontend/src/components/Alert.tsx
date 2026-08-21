/**
 * DESIGN.md §5: one alert look for the whole app — a flat card with a
 * coloured left edge carrying the meaning. Used inline (mockup disclosures,
 * form errors); a toast/notification stack can wrap this later if needed.
 */

import type { ReactNode } from "react";

import "./Alert.css";

export type AlertKind = "info" | "success" | "warning" | "error";

interface AlertProps {
  kind: AlertKind;
  children: ReactNode;
}

export function Alert({ kind, children }: AlertProps) {
  return (
    <div className={`notice notice--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
