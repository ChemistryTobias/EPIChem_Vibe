/**
 * The right-hand detail panel every screen shares. Collapsed to 0 width by
 * default; expands only once something is selected (`open`).
 */

import type { ReactNode } from "react";

import "./Inspector.css";

interface InspectorProps {
  open: boolean;
  kind: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  children?: ReactNode;
}

export function Inspector({ open, kind, title, subtitle, onClose, children }: InspectorProps) {
  return (
    <aside className={open ? "inspector inspector--open" : "inspector"} aria-label={kind} aria-hidden={!open}>
      {open && (
        <>
          <header className="inspector__header">
            <p className="label">{kind}</p>
            <div className="inspector__heading">
              <div>
                <h2 className="inspector__title">{title}</h2>
                {subtitle && <p className="inspector__subtitle mono muted">{subtitle}</p>}
              </div>
              {onClose && (
                <button className="inspector__close" onClick={onClose} aria-label="Close inspector">
                  ×
                </button>
              )}
            </div>
          </header>
          <div className="inspector__body">{children}</div>
        </>
      )}
    </aside>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <p className="label">{label}</p>
      <div className="field__value">
        {children === null || children === undefined || children === "" ? (
          <span className="muted">—</span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** A titled block of fields — the inspector reads as a few short sections
 * rather than one long list. */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="field-group">
      <h3 className="field-group__title label">{title}</h3>
      {children}
    </section>
  );
}
