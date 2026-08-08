/**
 * The layout's location path — where you are in the hierarchy and a way to jump:
 * `› SITE-MPIFKF [0] › LAB-3 › SPINBOT`. (This is the pattern usually called a
 * "breadcrumb"; renamed here to the plainer "location path".)
 *
 * Each `›` opens the list of that level's options (sites / labs / stations); the
 * name after it is the chosen one, and clicking a name jumps back to that level.
 * The `[N]` chip is the site *floor* (ADR 0013) — a view control, not a level —
 * shown only when the site has more than one floor. The leading sites `›` shows
 * only when more than one site is reachable.
 *
 * Styling (see `.path` in LayoutScreen.css): it reads as one small button —
 * white, thin grey border, no shadow, not bold — and the only thing that turns
 * green is the *writing* of whatever is clickable, on hover, so it's obvious what
 * you can click. In the option list, the currently-selected entry is the green one.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Lab, Site, Station } from "../../api/types";
import type { Level } from "./levels";

interface LocationPathProps {
  sites: Site[];
  labs: Lab[];
  stations: Station[];
  site: Site | null;
  lab: Lab | null;
  station: Station | null;
  floor: number;
  level: Level;
  /** Edit mode: level changes are blocked; every step/switch calls `onLocked`. */
  locked?: boolean;
  onLocked?: () => void;
  onPickSite: (code: string) => void;
  onPickFloor: (floor: number) => void;
  onEnterLab: (code: string) => void;
  onEnterStation: (code: string) => void;
  onGoToSite: () => void;
  onGoToLab: () => void;
}

export function LocationPath({
  sites,
  labs,
  stations,
  site,
  lab,
  station,
  floor,
  level,
  locked = false,
  onLocked,
  onPickSite,
  onPickFloor,
  onEnterLab,
  onEnterStation,
  onGoToSite,
  onGoToLab,
}: LocationPathProps) {
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
    <nav className={`path${locked ? " path--locked" : ""}`} aria-label="Location">
      {/* Sites — only when there's more than one to switch between. */}
      {sites.length > 1 && (
        <Switch
          label="›"
          title="Switch site"
          locked={locked}
          onLocked={onLocked}
          options={sites.map((s) => ({ code: s.code, label: s.code, active: s.code === site.code }))}
          onPick={onPickSite}
        />
      )}
      <Step current={level === "site"} locked={locked} onLocked={onLocked} onClick={onGoToSite}>
        {site.code}
      </Step>
      {/* Floor chip — a view control, only when the building has floors to pick. */}
      {site.floors > 1 && (
        <Switch
          label={`[${floor}]`}
          title="Switch floor"
          className="path__floor"
          locked={locked}
          onLocked={onLocked}
          options={floorOptions}
          onPick={(code) => onPickFloor(Number(code))}
        />
      )}

      {/* Labs — the switch is always available (enter/switch a lab); the name only
          once a lab is selected. */}
      <Switch
        label="›"
        title="Enter a lab"
        locked={locked}
        onLocked={onLocked}
        options={labOptions}
        onPick={onEnterLab}
      />
      {lab && (
        <Step current={level === "lab"} locked={locked} onLocked={onLocked} onClick={onGoToLab}>
          {lab.code}
        </Step>
      )}

      {/* Stations — only once inside a lab. */}
      {lab && (
        <Switch
          label="›"
          title="Enter a station"
          locked={locked}
          onLocked={onLocked}
          options={stationOptions}
          onPick={onEnterStation}
        />
      )}
      {station && (
        <Step current locked={locked} onLocked={onLocked}>
          {station.code}
        </Step>
      )}
    </nav>
  );
}

function Step({
  current,
  locked,
  onLocked,
  onClick,
  children,
}: {
  current: boolean;
  locked?: boolean;
  onLocked?: () => void;
  onClick?: () => void;
  children: ReactNode;
}) {
  // Locked (edit mode): the step still reacts, but only to explain that level
  // changes need inspect mode.
  const handler = locked ? onLocked : current ? undefined : onClick;
  if (!handler) {
    return <span className={`path__step${current ? " path__step--current" : ""}`}>{children}</span>;
  }
  return (
    <button type="button" className={`path__step${current ? " path__step--current" : ""}`} onClick={handler}>
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
 * A `›` (or `[N]`) that opens the list of a level's options — closes on pick and
 * on a click outside. With nothing to pick it renders inert, so the `›` still
 * spaces the path without inviting a dead click.
 */
function Switch({
  label,
  title,
  options,
  onPick,
  className,
  locked,
  onLocked,
}: {
  label: ReactNode;
  title: string;
  options: Option[];
  onPick: (code: string) => void;
  className?: string;
  locked?: boolean;
  onLocked?: () => void;
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

  const switchClass = `path__switch${className ? ` ${className}` : ""}`;

  // Locked (edit mode): the switch doesn't open — it explains the block instead.
  if (locked) {
    return (
      <button type="button" className={switchClass} title="Level changes need inspect mode" onClick={onLocked}>
        {label}
      </button>
    );
  }

  if (options.length === 0) {
    return (
      <span className={`${switchClass} path__switch--empty`} aria-hidden="true">
        {label}
      </span>
    );
  }

  return (
    <div className="path__dd" ref={ref}>
      <button
        type="button"
        className={switchClass}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <ul className="path__menu" role="menu">
          {options.map((o) => (
            <li key={o.code} role="none">
              <button
                type="button"
                role="menuitem"
                className={`path__menu-item${o.active ? " path__menu-item--active" : ""}`}
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
