/**
 * The 72px bar at the top of every screen: title + one-line subtitle on the
 * left, screen-specific actions on the right. Straight from the prototype's
 * layout language.
 */

import type { ReactNode } from "react";

import "./ScreenHeader.css";

interface ScreenHeaderProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}

export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps) {
  return (
    <header className="screen-header">
      <div>
        <h1 className="screen-header__title">{title}</h1>
        <p className="screen-header__subtitle">{subtitle}</p>
      </div>
      {actions && <div className="screen-header__actions">{actions}</div>}
    </header>
  );
}
