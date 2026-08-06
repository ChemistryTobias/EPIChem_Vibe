/**
 * Fixed left navigation: text wordmark, the three screens, and a footer
 * noting what this build is.
 *
 * The wordmark is text, not a mark — DESIGN.md §1 is explicit that the
 * Minerva bildmarke is MPG IP and must not be reproduced or redrawn in an
 * app, and that no standalone MPI-FKF logo should be invented. DESIGN.md §4
 * puts identity top-left on web, which is where it is.
 */

import type { Route } from "../hooks/useHashRoute";
import { navigate } from "../hooks/useHashRoute";
import { TokenField } from "./TokenField";

import "./Sidebar.css";

interface NavItem {
  route: Route;
  label: string;
  /** One-line reminder of what the screen reads. */
  hint: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: "topology", label: "Topology", hint: "Site → Lab → Zone → Workcell → Bench → Station" },
  { route: "devices", label: "Devices", hint: "Registered device descriptors" },
  { route: "samples", label: "Samples", hint: "Registered samples" },
];

export function Sidebar({ current }: { current: Route }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar__brand">
        <p className="sidebar__wordmark">EPICHEM</p>
        <p className="sidebar__institute">Max Planck Institute for Solid State Research</p>
      </div>

      <p className="sidebar__section label">Registry</p>
      <ul className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.route}>
            <button
              className={
                item.route === current ? "sidebar__item sidebar__item--active" : "sidebar__item"
              }
              onClick={() => navigate(item.route)}
              aria-current={item.route === current ? "page" : undefined}
              title={item.hint}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar__footer">
        <TokenField />

        <p className="label sidebar__build-label">Build</p>
        {/* Honest about scope: the plan's other screens (lab layout, procedure
            designer, scheduler) are real milestones, not missing links. */}
        <p className="sidebar__note">
          M1 registry only. The isometric lab layout and the procedure designer are later
          milestones — see PROJECT_MILESTONES.md.
        </p>
      </div>
    </nav>
  );
}
