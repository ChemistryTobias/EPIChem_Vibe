/** The 72px bar at the top of every screen: title/subtitle left, actions right. */

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
        <p className="screen-header__subtitle muted">{subtitle}</p>
      </div>
      {actions && <div className="screen-header__actions">{actions}</div>}
    </header>
  );
}
