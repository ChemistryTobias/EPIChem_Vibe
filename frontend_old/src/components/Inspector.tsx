/**
 * The fixed right-hand detail panel every screen shares — the list/inspector
 * two-pane pattern taken from the approved HTML prototype.
 *
 * `Inspector` is the frame (title, subtitle, close, empty prompt);
 * `Field` and `FieldGroup` are the label/value primitives its contents are
 * built from, so a screen's inspector body reads as a list of facts rather
 * than as markup.
 */

import type { ReactNode } from "react";

import "./Inspector.css";

interface InspectorProps {
  /** Caption above the title, e.g. "SAMPLE INSPECTOR". */
  kind: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  /** Shown when nothing is selected. */
  placeholder?: string;
  children?: ReactNode;
}

export function Inspector({
  kind,
  title,
  subtitle,
  onClose,
  placeholder = "Select a row to see its details.",
  children,
}: InspectorProps) {
  return (
    <aside className="inspector" aria-label={kind}>
      <header className="inspector__header">
        <p className="label">{kind}</p>
        {title ? (
          <div className="inspector__heading">
            <div>
              <h2 className="inspector__title">{title}</h2>
              {subtitle && <p className="inspector__subtitle mono">{subtitle}</p>}
            </div>
            {onClose && (
              <button className="inspector__close" onClick={onClose} aria-label="Close inspector">
                ×
              </button>
            )}
          </div>
        ) : null}
      </header>

      <div className="inspector__body">
        {title ? children : <p className="inspector__placeholder muted">{placeholder}</p>}
      </div>
    </aside>
  );
}

interface FieldProps {
  label: string;
  /** Render as monospace — for codes, IDs and measured values. */
  mono?: boolean;
  children: ReactNode;
}

export function Field({ label, mono = false, children }: FieldProps) {
  return (
    <div className="field">
      <p className="label">{label}</p>
      <div className={mono ? "field__value mono" : "field__value"}>
        {children === null || children === undefined || children === "" ? (
          <span className="muted">—</span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="field-group">
      <h3 className="field-group__title label">{title}</h3>
      {children}
    </section>
  );
}
