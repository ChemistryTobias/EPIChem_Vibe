/**
 * One collapsible level of a list. The header is the control: click it to
 * open that level, which closes whichever one was open before.
 */

import type { ReactNode } from "react";

import "./CollapsibleSection.css";

interface CollapsibleSectionProps {
  title: string;
  /** Row count, shown next to the title so a closed level still tells you
   * whether it holds anything. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <section className={open ? "collapsible collapsible--open" : "collapsible"}>
      <button type="button" className="collapsible__header" onClick={onToggle} aria-expanded={open}>
        <span className="collapsible__caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="collapsible__title">{title}</span>
        {count !== undefined && <span className="collapsible__count">{count}</span>}
      </button>

      {open && <div className="collapsible__body">{children}</div>}
    </section>
  );
}
