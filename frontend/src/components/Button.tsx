/**
 * Buttons, per DESIGN.md §5: flat fill, sharp corners (2px), uppercase
 * Roboto Bold label with wide tracking, no gradients or elevation shadows.
 *
 * Three variants: `primary` (filled MPG green), `secondary` (outlined),
 * `danger` (the sanctioned one-off red — DESIGN.md notes the MPG palette
 * has none, so this is deliberate rather than an invented brand color).
 */

import type { ButtonHTMLAttributes } from "react";

import "./Button.css";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "secondary", className, ...rest }: ButtonProps) {
  return <button className={["btn", `btn--${variant}`, className].filter(Boolean).join(" ")} {...rest} />;
}
