/**
 * DESIGN.md §5: flat fill, sharp corners, uppercase Roboto Bold label.
 * Two sizes (md default, sm compact) and four variants — the one button
 * primitive, reused everywhere instead of a restyled <button>.
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
