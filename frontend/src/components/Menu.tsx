/**
 * A button that opens a short list of choices. Used where one control stands
 * for several actions — Add, which can create any kind of record.
 *
 * Closes on a pick and on a click outside, the same way the layout's location
 * path switches behave.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "./Button";

import "./Menu.css";

interface MenuProps {
  label: string;
  items: { id: string; label: string }[];
  onPick: (id: string) => void;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
}

export function Menu({ label, items, onPick, variant = "secondary", size = "md" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <Button variant={variant} size={size} onClick={() => setOpen((v) => !v)}>
        {label}
      </Button>
      {open && (
        <ul className="menu__list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                className="menu__item"
                onClick={() => {
                  setOpen(false);
                  onPick(item.id);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
