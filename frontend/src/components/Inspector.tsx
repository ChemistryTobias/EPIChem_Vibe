/**
 * The right-hand detail panel every screen shares. Collapsed to 0 width by
 * default; expands only once something is selected (`open`).
 *
 * It has two modes. Reading is the default; the pencil switches it to its
 * editor, where the name and the record's own fields become inputs and the
 * header carries Save and Cancel. The screen owns the draft (see
 * `inspectors/edit.ts`) — on the layout canvas a drag and a typed coordinate
 * are the same edit, so they have to share one.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { EyeIcon, PencilIcon } from "./icons";

import "./Inspector.css";

/** What the screen has to provide for the panel to be editable at all. */
export interface InspectorEdit {
  editing: boolean;
  /** The editor is filling in a record that doesn't exist yet. */
  creating?: boolean;
  /** Whether anything has been altered — Save is dead until it has. */
  dirty: boolean;
  saving?: boolean;
  /** Pencil / eye: into the editor, and back out of it. */
  onToggle: () => void;
  onSave: () => void;
  onCancel: () => void;
  onRename: (name: string) => void;
}

interface InspectorProps {
  open: boolean;
  /** The entity kind — the panel says "<kind> inspector" or "<kind> editor". */
  kind: string;
  /** Replaces "<kind> inspector" where the panel isn't inspecting a record
   * (the designer's "Add a step", "Step settings"). */
  heading?: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  edit?: InspectorEdit;
  children?: ReactNode;
}

export function Inspector({ open, kind, heading, title, subtitle, onClose, edit, children }: InspectorProps) {
  const editing = edit?.editing ?? false;

  // Click away to close. Anything that *chooses* what the inspector shows —
  // a name in a table, the canvas — marks itself `data-inspects` so its click
  // isn't read as a click away. The editor never closes this way: a stray
  // click shouldn't cost you a draft.
  useEffect(() => {
    if (!open || !onClose || editing) return;
    const away = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".inspector, [data-inspects], dialog")) return;
      onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onClose, editing]);

  return (
    <aside className={open ? "inspector inspector--open" : "inspector"} aria-label={kind} aria-hidden={!open}>
      {open && (
        <>
          <header className="inspector__header">
            <div className="inspector__top">
              <p className="label">
                {heading ?? `${kind} ${editing ? (edit?.creating ? "creator" : "editor") : "inspector"}`}
              </p>
              <div className="inspector__tools">
                {/* Nothing to read yet while creating, so no way back to it. */}
                {edit && !edit.creating && (
                  <button
                    className="inspector__tool"
                    onClick={edit.onToggle}
                    title={editing ? "Back to reading" : "Edit this record"}
                    aria-label={editing ? "Back to reading" : "Edit this record"}
                  >
                    {editing ? <EyeIcon /> : <PencilIcon />}
                  </button>
                )}
                {onClose && (
                  <button className="inspector__close" onClick={onClose} aria-label="Close inspector">
                    ×
                  </button>
                )}
              </div>
            </div>

            {editing && edit ? (
              <input
                className="inspector__rename"
                value={title ?? ""}
                onChange={(e) => edit.onRename(e.target.value)}
                aria-label="Name"
              />
            ) : (
              <h2 className="inspector__title">{title}</h2>
            )}
            {subtitle && <p className="inspector__subtitle mono muted">{subtitle}</p>}

            {editing && edit && (
              <div className="inspector__actions">
                <Button size="sm" variant="primary" onClick={edit.onSave} disabled={!edit.dirty || edit.saving}>
                  {edit.saving ? "Saving…" : edit.creating ? "Create" : "Save"}
                </Button>
                <Button size="sm" onClick={edit.onCancel}>
                  Cancel
                </Button>
              </div>
            )}
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
