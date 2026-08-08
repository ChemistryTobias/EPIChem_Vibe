/**
 * Buttons, per DESIGN.md §5: flat fill, sharp corners (2px), uppercase
 * Roboto Bold label with wide tracking, no gradients or elevation shadows.
 *
 * Variants: `primary` (filled MPG green), `secondary` (outlined), `danger` (the
 * sanctioned one-off red — DESIGN.md notes the MPG palette has none, so this is
 * deliberate), and `text` (low-emphasis, sentence-case — §5 exempts these from
 * the all-caps rule). Two sizes: `md` (default) and `sm` — a compact button for
 * toolbars/overlays sitting next to a primary one. This is the one place button
 * styling is defined; reuse it everywhere rather than restyling `<button>`.
 */

import type { ButtonHTMLAttributes } from "react";

import "./Button.css";

type Variant = "primary" | "secondary" | "danger" | "text";
type Size = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={["btn", `btn--${variant}`, size === "sm" && "btn--sm", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
