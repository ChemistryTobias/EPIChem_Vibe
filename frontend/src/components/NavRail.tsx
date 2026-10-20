/** Fixed left navigation: wordmark, the app's sections, and at the foot you (your account) and the settings cog. */

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { lastDeviceRoute, rememberDeviceRoute } from "../router";
import { Glyph } from "./glyphs";

import "./NavRail.css";

const DEVICE_MGMT_SUBS = [
  { path: "/devices/hierarchy", label: "Hierarchy" },
  { path: "/devices/layout", label: "Layout" },
  { path: "/devices/monitoring", label: "Device Monitoring" },
];

const WORKFLOW_SUBS = [
  { path: "/workflows/procedures", label: "Procedures" },
  { path: "/workflows/designer", label: "Designer" },
  { path: "/workflows/runs", label: "Runs" },
];

const LEAVES = [{ path: "/samples", label: "Samples" }];

export function NavRail({ user }: { user: string }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const deviceMgmtActive = pathname.startsWith("/devices");
  const workflowsActive = pathname.startsWith("/workflows");

  // Remember the current subpage so re-entering the section returns to it —
  // including when it was reached by URL rather than by clicking the nav.
  useEffect(() => {
    if (deviceMgmtActive && pathname !== "/devices") rememberDeviceRoute(pathname);
  }, [deviceMgmtActive, pathname]);

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

        <li>
          <button
            className={workflowsActive ? "nav-rail__item nav-rail__item--active" : "nav-rail__item"}
            onClick={() => navigate({ to: "/workflows/procedures" })}
          >
            Workflows
          </button>
          {workflowsActive && (
            <ul className="nav-rail__subnav">
              {WORKFLOW_SUBS.map((sub) => (
                <li key={sub.path}>
                  <button
                    className={
                      pathname === sub.path || pathname.startsWith(`${sub.path}/`)
                        ? "nav-rail__subitem nav-rail__subitem--active"
                        : "nav-rail__subitem"
                    }
                    onClick={() => navigate({ to: sub.path })}
                  >
                    {sub.label}
                  </button>
                </li>
              ))}
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
        <button
          className={pathname === "/account" ? "nav-rail__me nav-rail__me--active" : "nav-rail__me"}
          onClick={() => navigate({ to: "/account" })}
          title="Your account"
        >
          <span className="nav-rail__avatar">
            <Glyph name="user" size={16} />
          </span>
          <span className="nav-rail__me-name">{user}</span>
        </button>
        <button
          className={pathname === "/settings" ? "nav-rail__cog nav-rail__cog--active" : "nav-rail__cog"}
          onClick={() => navigate({ to: "/settings" })}
          title="Settings"
          aria-label="Settings"
        >
          <Glyph name="cog" size={20} />
        </button>
      </div>
    </nav>
  );
}
