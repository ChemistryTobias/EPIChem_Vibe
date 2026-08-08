/**
 * The layout's drill-down breadcrumb: `› SITE-MPIFKF [0] › LAB-3 › SPINBOT`.
 *
 * Each `›` is a dropdown of that level's options (sites / labs / stations); the
 * name after it is the chosen value, and clicking a name navigates back up to
 * that level. The `[N]` chip is the site *floor* (ADR 0013) — a view control,
 * not a hierarchy level — shown only when the site has more than one floor. The
 * leading sites `›` appears only when the user can reach more than one site.
 *
 * It's the same typeface as the main menu (`--font-display`, uppercase), just
 * greyed: the current level is the quietest, the clickable ancestors a shade
 * darker, matching the sidebar's "you are here vs. you can go there" language.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Lab, Site, Station } from "../../api/types";
import type { Level } from "./levels";

interface BreadcrumbProps {
  sites: Site[];
  labs: Lab[];
  stations: Station[];
  site: Site | null;
  lab: Lab | null;
  station: Station | null;
  floor: number;
  level: Level;
  onPickSite: (code: string) => void;
  onPickFloor: (floor: number) => void;
  onEnterLab: (code: string) => void;
  onEnterStation: (code: string) => void;
  onGoToSite: () => void;
  onGoToLab: () => void;
}

export function Breadcrumb({
  sites,
  labs,
  stations,
  site,
  lab,
  station,
  floor,
  level,
  onPickSite,
  onPickFloor,
  onEnterLab,
  onEnterStation,
  onGoToSite,
  onGoToLab,
}: BreadcrumbProps) {
  if (!site) return null;

  const labOptions = labs
    .filter((l) => l.site_id === site.id && l.floor === floor)
    .map((l) => ({ code: l.code, label: l.code, active: l.code === lab?.code }));
  const stationOptions = lab
    ? stations
        .filter((s) => s.lab_id === lab.id && !s.virtual)
        .map((s) => ({ code: s.code, label: s.code, active: s.code === station?.code }))
    : [];
  const floorOptions = Array.from({ length: Math.max(site.floors, 1) }, (_, i) => ({
    code: String(i),
    label: `Floor ${i}`,
    active: i === floor,
  }));

  return (
    <nav className="crumbs" aria-label="Layout location">
      {/* Sites — only when there's more than one to switch between. */}
      {sites.length > 1 && (
        <Dropdown
          label="›"
          title="Switch site"
          options={sites.map((s) => ({ code: s.code, label: s.code, active: s.code === site.code }))}
          onPick={onPickSite}
        />
      )}
      <Crumb current={level === "site"} onClick={onGoToSite}>
        {site.code}
      </Crumb>
      {/* Floor chip — a view control, only when the building has floors to pick. */}
      {site.floors > 1 && (
        <Dropdown
          label={`[${floor}]`}
          title="Switch floor"
          className="crumbs__floor"
          options={floorOptions}
          onPick={(code) => onPickFloor(Number(code))}
        />
      )}

      {/* Labs — the arrow is always available (enter/switch a lab); the name only
          once a lab is selected. */}
      <Dropdown label="›" title="Enter a lab" options={labOptions} onPick={onEnterLab} />
      {lab && (
        <Crumb current={level === "lab"} onClick={onGoToLab}>
          {lab.code}
        </Crumb>
      )}

      {/* Stations — only once inside a lab. */}
      {lab && (
        <Dropdown label="›" title="Enter a station" options={stationOptions} onPick={onEnterStation} />
      )}
      {station && <Crumb current>{station.code}</Crumb>}
    </nav>
  );
}

function Crumb({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (current || !onClick) {
    return <span className="crumb crumb--current">{children}</span>;
  }
  return (
    <button type="button" className="crumb" onClick={onClick}>
      {children}
    </button>
  );
}

interface Option {
  code: string;
  label: string;
  active?: boolean;
}

/**
 * The `›` (or `[N]`) trigger and its popover menu. Closes on pick and on a click
 * outside. When there's nothing to pick, the trigger renders inert so the arrow
 * still spaces the crumb but doesn't invite a click that does nothing.
 */
function Dropdown({
  label,
  title,
  options,
  onPick,
  className,
}: {
  label: ReactNode;
  title: string;
  options: Option[];
  onPick: (code: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const arrowClass = `crumb__arrow${className ? ` ${className}` : ""}`;

  if (options.length === 0) {
    return (
      <span className={`${arrowClass} crumb__arrow--empty`} aria-hidden="true">
        {label}
      </span>
    );
  }

  return (
    <div className="crumb__dd" ref={ref}>
      <button
        type="button"
        className={arrowClass}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <ul className="crumb__menu" role="menu">
          {options.map((o) => (
            <li key={o.code} role="none">
              <button
                type="button"
                role="menuitem"
                className={`crumb__menu-item${o.active ? " crumb__menu-item--active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onPick(o.code);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
