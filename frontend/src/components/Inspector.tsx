/**
 * The right-hand detail panel every screen shares. Collapsed to 0 width by
 * default; expands only once something is selected (`open`).
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import "./Inspector.css";

interface InspectorProps {
  open: boolean;
  kind: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  /** Whether clicking away closes it. Off while a screen is mid-edit, where
   * losing the panel would lose the context you're editing in. */
  dismissable?: boolean;
  children?: ReactNode;
}

export function Inspector({
  open,
  kind,
  title,
  subtitle,
  onClose,
  dismissable = true,
  children,
}: InspectorProps) {
  // Click away to close. Anything that *chooses* what the inspector shows —
  // a name in a table, the canvas — marks itself `data-inspects` so its click
  // isn't read as a click away.
  useEffect(() => {
    if (!open || !onClose || !dismissable) return;
    const away = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".inspector, [data-inspects], dialog")) return;
      onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onClose, dismissable]);

  return (
    <aside className={open ? "inspector inspector--open" : "inspector"} aria-label={kind} aria-hidden={!open}>
      {open && (
        <>
          <header className="inspector__header">
            <div className="inspector__top">
              <p className="label">{kind}</p>
              {onClose && (
                <button className="inspector__close" onClick={onClose} aria-label="Close inspector">
                  ×
                </button>
              )}
            </div>
            <h2 className="inspector__title">{title}</h2>
            {subtitle && <p className="inspector__subtitle mono muted">{subtitle}</p>}
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
