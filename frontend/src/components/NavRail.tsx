/** Fixed left navigation: wordmark + the app's sections. */

import type { Route } from "../hooks/useHashRoute";
import { navigate } from "../hooks/useHashRoute";

import "./NavRail.css";

const DEVICE_MGMT_ROUTES: readonly Route[] = ["hierarchy", "layout", "devices"];

const DEVICE_MGMT_SUBS: { route: Route; label: string }[] = [
  { route: "hierarchy", label: "Hierarchy" },
  { route: "layout", label: "Layout" },
  { route: "devices", label: "Devices" },
];

const LEAVES: { route: Route; label: string }[] = [
  { route: "samples", label: "Samples" },
  { route: "workflow", label: "Workflow Designer" },
];

export function NavRail({ current }: { current: Route }) {
  const deviceMgmtActive = DEVICE_MGMT_ROUTES.includes(current);

  return (
    <nav className="nav-rail" aria-label="Main">
      <div className="nav-rail__brand">
        <p className="nav-rail__wordmark">EPICHEM</p>
      </div>

      <ul className="nav-rail__nav">
        <li>
          <button
            className={deviceMgmtActive ? "nav-rail__item nav-rail__item--active" : "nav-rail__item"}
            onClick={() => navigate("hierarchy")}
          >
            Device Management
          </button>
          {deviceMgmtActive && (
            <ul className="nav-rail__subnav">
              {DEVICE_MGMT_SUBS.map((sub) => (
                <li key={sub.route}>
                  <button
                    className={
                      sub.route === current
                        ? "nav-rail__subitem nav-rail__subitem--active"
                        : "nav-rail__subitem"
                    }
                    onClick={() => navigate(sub.route)}
                  >
                    {sub.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>

        {LEAVES.map((leaf) => (
          <li key={leaf.route}>
            <button
              className={
                current === leaf.route ? "nav-rail__item nav-rail__item--active" : "nav-rail__item"
              }
              onClick={() => navigate(leaf.route)}
            >
              {leaf.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
