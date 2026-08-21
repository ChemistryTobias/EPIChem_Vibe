/**
 * Fixed left navigation: text wordmark, the registry sections, and a footer
 * noting what this build is.
 *
 * The nav is two top-level entries (ADR 0009): **Device Management** — a group
 * that, when it's the active section, expands to its three subsections
 * (Hierarchy / Device Status / Lab Layout) rendered smaller, with the current
 * one bold — and **Samples**, a standalone leaf. Collapsed, the rail looks like
 * the flat M1 nav; the subsections only appear once you're inside the section.
 *
 * The wordmark is text, not a mark — DESIGN.md §1 is explicit that the
 * Minerva bildmarke is MPG IP and must not be reproduced or redrawn in an
 * app, and that no standalone MPI-FKF logo should be invented. DESIGN.md §4
 * puts identity top-left on web, which is where it is.
 */

import type { Route } from "../hooks/useHashRoute";
import { DEVICE_MGMT_ROUTES, navigate } from "../hooks/useHashRoute";
import { TokenField } from "./TokenField";

import "./Sidebar.css";

/** The three subsections of Device Management, in nav order. */
const DEVICE_MGMT_SUBS: { route: Route; label: string; hint: string }[] = [
  { route: "hierarchy", label: "Hierarchy", hint: "Site → Lab → Zone → Station → Module → Device" },
  { route: "device-status", label: "Device Status", hint: "Operational state of every device" },
  { route: "lab-layout", label: "Lab Layout", hint: "Metric floor plan of a lab" },
];

const DEVICE_MGMT_SET: readonly Route[] = DEVICE_MGMT_ROUTES;

export function Sidebar({ current }: { current: Route }) {
  const deviceMgmtActive = DEVICE_MGMT_SET.includes(current);

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar__brand">
        <p className="sidebar__wordmark">EPICHEM</p>
        <p className="sidebar__institute">Max Planck Institute for Solid State Research</p>
      </div>

      <p className="sidebar__section label">Registry</p>
      <ul className="sidebar__nav">
        <li>
          <button
            className={
              deviceMgmtActive ? "sidebar__item sidebar__item--active" : "sidebar__item"
            }
            // Entering the section lands on its primary subsection, Hierarchy.
            onClick={() => navigate("hierarchy")}
            aria-current={deviceMgmtActive ? "page" : undefined}
            title="Site, lab and station hierarchy, device status and the lab layout"
          >
            Device Management
          </button>

          {deviceMgmtActive && (
            <ul className="sidebar__subnav">
              {DEVICE_MGMT_SUBS.map((sub) => (
                <li key={sub.route}>
                  <button
                    className={
                      sub.route === current
                        ? "sidebar__subitem sidebar__subitem--active"
                        : "sidebar__subitem"
                    }
                    onClick={() => navigate(sub.route)}
                    aria-current={sub.route === current ? "page" : undefined}
                    title={sub.hint}
                  >
                    {sub.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>

        <li>
          <button
            className={
              current === "samples" ? "sidebar__item sidebar__item--active" : "sidebar__item"
            }
            onClick={() => navigate("samples")}
            aria-current={current === "samples" ? "page" : undefined}
            title="Registered samples"
          >
            Samples
          </button>
        </li>
      </ul>

      <div className="sidebar__footer">
        <TokenField />

        <p className="label sidebar__build-label">Build</p>
        {/* Honest about scope: the plan's remaining screens (procedure
            designer, scheduler) are real milestones, not missing links. */}
        <p className="sidebar__note">
          M2 registry — Device Management shell. Live device state, the procedure designer and the
          scheduler are later milestones — see PROJECT_MILESTONES.md.
        </p>
      </div>
    </nav>
  );
}
