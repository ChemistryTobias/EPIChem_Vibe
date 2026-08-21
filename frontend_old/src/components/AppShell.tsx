/**
 * Sidebar + main column. Screens render their own header and body inside it,
 * so the shell knows nothing about what any screen does.
 */

import type { ReactNode } from "react";

import type { Route } from "../hooks/useHashRoute";
import { Sidebar } from "./Sidebar";

import "./AppShell.css";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar current={route} />
      <main className="shell__main">{children}</main>
    </div>
  );
}
