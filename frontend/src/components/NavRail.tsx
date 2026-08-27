/** Fixed left navigation: wordmark, the app's sections, and a build note. */

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { logout } from "../api/auth";
import { lastDeviceRoute, rememberDeviceRoute } from "../router";

import "./NavRail.css";

const DEVICE_MGMT_SUBS = [
  { path: "/devices/hierarchy", label: "Hierarchy" },
  { path: "/devices/layout", label: "Layout" },
  { path: "/devices/monitoring", label: "Device Monitoring" },
];

const LEAVES = [
  { path: "/samples", label: "Samples" },
  { path: "/workflow", label: "Workflow Designer" },
];

export function NavRail({ user }: { user: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const deviceMgmtActive = pathname.startsWith("/devices");

  // Remember the current subpage so re-entering the section returns to it —
  // including when it was reached by URL rather than by clicking the nav.
  useEffect(() => {
    if (deviceMgmtActive && pathname !== "/devices") rememberDeviceRoute(pathname);
  }, [deviceMgmtActive, pathname]);

  async function signOut() {
    await logout();
    queryClient.clear();
  }

  return (
    <nav className="nav-rail" aria-label="Main">
      <div className="nav-rail__header">
        <p className="nav-rail__header-wordmark">EPICHEM</p>
      </div>

      <ul className="nav-rail__menu">
        <li>
          <button
            className={deviceMgmtActive ? "nav-rail__item nav-rail__item--active" : "nav-rail__item"}
            onClick={() => navigate({ to: lastDeviceRoute() })}
          >
            Device Management
          </button>

          {deviceMgmtActive && (
            <ul className="nav-rail__subnav">
              {DEVICE_MGMT_SUBS.map((sub) => {
                // Prefix match so Hierarchy stays lit on its level tables.
                const active = pathname === sub.path || pathname.startsWith(`${sub.path}/`);
                return (
                  <li key={sub.path}>
                    <button
                      className={
                        active
                          ? "nav-rail__subitem nav-rail__subitem--active"
                          : "nav-rail__subitem"
                      }
                      onClick={() => navigate({ to: sub.path })}
                    >
                      {sub.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        {LEAVES.map((leaf) => (
          <li key={leaf.path}>
            <button
              className={
                pathname === leaf.path ? "nav-rail__item nav-rail__item--active" : "nav-rail__item"
              }
              onClick={() => navigate({ to: leaf.path })}
            >
              {leaf.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="nav-rail__footer">
        <p className="nav-rail__footer-section-header">Signed in</p>
        <p>
          {user} — <button className="nav-rail__signout" onClick={signOut}>sign out</button>
        </p>
        <p className="nav-rail__footer-section-header">Build</p>
        <p>This is a very early build of the EPIChem orchestrator, do not use this in production!</p>
      </div>
    </nav>
  );
}
