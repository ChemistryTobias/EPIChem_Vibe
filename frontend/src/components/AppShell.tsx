/** NavRail + main column. Screens render their own header/body/inspector. */

import type { ReactNode } from "react";

import type { Route } from "../hooks/useHashRoute";
import { NavRail } from "./NavRail";

import "./AppShell.css";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="shell">
      <NavRail current={route} />
      <main className="shell__main">{children}</main>
    </div>
  );
}
