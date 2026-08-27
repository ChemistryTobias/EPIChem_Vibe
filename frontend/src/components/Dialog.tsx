/**
 * A modal, built on the native `<dialog>` element — Escape, the backdrop and
 * the focus trap come with it, so none of that is written here.
 */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import "./Dialog.css";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <header className="dialog__header">
        <h2 className="dialog__title">{title}</h2>
        <button className="dialog__close" onClick={() => ref.current?.close()} aria-label="Close">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}

/** A labelled input row — the shape every field in a dialog form takes. */
export function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="dialog__field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
