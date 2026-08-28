/**
 * The layout's location path — where you are in the hierarchy and a way to
 * jump: `› Example Site [0] › Lab 1 › Station 1`. Carried over from the old
 * editor, which had this exactly right.
 *
 * Each `›` opens the list of that level's options (sites / labs / stations);
 * the name after it is the chosen one, and clicking a name jumps back to that
 * level. The `[N]` chip is the site *floor* — a view control, not a level —
 * shown only when the site has more than one. The leading sites `›` shows only
 * when there's more than one site to switch between.
 *
 * It reads as one small button — white, thin grey rule, not bold — and the
 * only thing that turns green is the writing of whatever is clickable, so
 * what you can click is obvious.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Lab, Site, Station } from "../../../api/types";
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
  /** A draft is open: level changes are blocked and every step explains why. */
  locked?: boolean;
  onLocked?: () => void;
  onPickSite: (uuid: string) => void;
  onPickFloor: (floor: number) => void;
  onEnterLab: (uuid: string) => void;
  onEnterStation: (uuid: string) => void;
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
    .filter((l) => l.site_uuid === site.uuid)
    .map((l) => ({ id: l.uuid, label: l.name, active: l.uuid === lab?.uuid }));
  const stationOptions = lab
    ? stations
        .filter((s) => s.lab_uuid === lab.uuid)
        .map((s) => ({ id: s.uuid, label: s.name, active: s.uuid === station?.uuid }))
    : [];
  const floors = Math.max(site.object_geometry.length, 1);
  const floorOptions = Array.from({ length: floors }, (_, i) => ({
    id: String(i),
    label: `Floor ${i}`,
    active: i === floor,
  }));

  return (
    <nav className="path" aria-label="Location">
      {sites.length > 1 && (
        <Switch
          label="›"
          title="Switch site"
          locked={locked}
          onLocked={onLocked}
          options={sites.map((s) => ({ id: s.uuid, label: s.name, active: s.uuid === site.uuid }))}
          onPick={onPickSite}
        />
      )}
      <Step current={level === "site"} locked={locked} onLocked={onLocked} onClick={onGoToSite}>
        {site.name}
      </Step>

      {floors > 1 && (
        <Switch
          label={`[${floor}]`}
          title="Switch floor"
          locked={locked}
          onLocked={onLocked}
          options={floorOptions}
          onPick={(id) => onPickFloor(Number(id))}
        />
      )}

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
          {lab.name}
        </Step>
      )}

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
          {station.name}
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
  // Locked: the step still reacts, but only to say why it can't move.
  const handler = locked ? onLocked : current ? undefined : onClick;
  if (!handler) {
    return <span className={`path__step${current ? " path__step--current" : ""}`}>{children}</span>;
  }
  return (
    <button className={`path__step${current ? " path__step--current" : ""}`} onClick={handler}>
      {children}
    </button>
  );
}

interface Option {
  id: string;
  label: string;
  active?: boolean;
}

/**
 * A `›` (or `[N]`) that opens a level's option list — closes on pick and on a
 * click outside. With nothing to pick it renders inert, so the `›` still
 * spaces the path without inviting a dead click.
 */
function Switch({
  label,
  title,
  options,
  onPick,
  locked,
  onLocked,
}: {
  label: ReactNode;
  title: string;
  options: Option[];
  onPick: (id: string) => void;
  locked?: boolean;
  onLocked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (options.length === 0) {
    return <span className="path__switch path__switch--empty">{label}</span>;
  }

  return (
    <div className="path__dd" ref={ref}>
      <button
        className="path__switch"
        title={title}
        onClick={() => (locked ? onLocked?.() : setOpen((v) => !v))}
      >
        {label}
      </button>
      {open && (
        <ul className="path__menu">
          {options.map((option) => (
            <li key={option.id}>
              <button
                className={`path__menu-item${option.active ? " path__menu-item--active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onPick(option.id);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
