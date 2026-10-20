/**
 * The console's pictograms: station kinds, device kinds, flow-control steps.
 *
 * Drawn here as small geometric stroke icons on a 24-unit grid — squares,
 * circles and straight lines, DESIGN.md's square/circle motif — so they follow
 * the text colour (`currentColor`) and need no asset pipeline. A station
 * stores its pick as a key (`Station.icon`); `stationGlyph` falls back to a
 * guess from its name, then to the generic station.
 */

import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  station: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 9.5h16M4 14.5h16M7 7h2M7 12h2M7 17h2" />
    </>
  ),
  robot: (
    <>
      <path d="M4 20h8M8 20v-7l6-6" />
      <circle cx="8" cy="13" r="1.6" />
      <circle cx="14" cy="7" r="1.6" />
      <path d="M15.5 8.2 19 11M15.4 5.6 18 3" />
    </>
  ),
  heat: (
    <>
      <rect x="3.5" y="15" width="17" height="5" />
      <path d="M8 12c-1.2-1.4 1.2-2.6 0-4.4M12 12c-1.2-1.4 1.2-2.6 0-4.4M16 12c-1.2-1.4 1.2-2.6 0-4.4" />
    </>
  ),
  spin: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5M19.5 12l1.8-2M19.5 12l-2-1.6" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5.2 9.3A1.5 1.5 0 0 0 6.1 20.5h11.8a1.5 1.5 0 0 0 1.3-2.2L14 9V3" />
      <path d="M7.4 14.5h9.2" />
    </>
  ),
  liquid: <path d="M12 3.5c3 4 6 7.2 6 10.8a6 6 0 0 1-12 0c0-3.6 3-6.8 6-10.8z" />,
  spectrum: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M5.5 15.5 9 10.5l3 3.5 3-6 3.5 5" />
    </>
  ),
  storage: (
    <>
      <rect x="3.5" y="6" width="17" height="12" />
      <circle cx="8" cy="10" r="1.4" />
      <circle cx="12" cy="10" r="1.4" />
      <circle cx="16" cy="10" r="1.4" />
      <circle cx="8" cy="14" r="1.4" />
      <circle cx="12" cy="14" r="1.4" />
      <circle cx="16" cy="14" r="1.4" />
    </>
  ),
  motion: (
    <path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
  ),
  sensor: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14" />
    </>
  ),
  microscope: (
    <>
      <path d="M6 20h12M9 20a6 6 0 0 1 6-10" />
      <rect x="10" y="3" width="4" height="8" transform="rotate(-30 12 7)" />
      <path d="M12 20v-3" />
    </>
  ),
  // flow control
  wait: <path d="M7 3h10M7 21h10M8 3v3l4 6-4 6v3M16 3v3l-4 6 4 6v3" />,
  input: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20.5c0-4 3.1-6.5 7-6.5s7 2.5 7 6.5" />
    </>
  ),
  http: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c-3 3-3 14 0 17M12 3.5c3 3 3 14 0 17" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  trash: <path d="M4 6h16M9 6V3.5h6V6M6.5 6l1 14.5h9l1-14.5M10 10v7M14 10v7" />,
  pin: <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />,
  rerun: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 3.5v4h-4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  play: <path d="M8 5v14l11-7z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
};

/** Station pictograms a person can pick from, with their labels. */
export const STATION_ICONS: { key: string; label: string }[] = [
  { key: "station", label: "Station" },
  { key: "robot", label: "Robot" },
  { key: "heat", label: "Heating" },
  { key: "spin", label: "Spin coating" },
  { key: "flask", label: "Synthesis" },
  { key: "liquid", label: "Liquid handling" },
  { key: "spectrum", label: "Analysis" },
  { key: "microscope", label: "Microscopy" },
  { key: "storage", label: "Storage" },
  { key: "motion", label: "Motion" },
  { key: "sensor", label: "Sensing" },
];

export function Glyph({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
    >
      {P[name] ?? P.station}
    </svg>
  );
}

const guess = (text: string, rules: [RegExp, string][], fallback: string) =>
  rules.find(([re]) => re.test(text))?.[1] ?? fallback;

const STATION_RULES: [RegExp, string][] = [
  [/spin/i, "spin"],
  [/synth|chem|react/i, "flask"],
  [/robot|arm|bot/i, "robot"],
  [/heat|oven|furnace|anneal/i, "heat"],
  [/liquid|pipett|dispens/i, "liquid"],
  [/spectr|analy|charact|xrd|uv/i, "spectrum"],
  [/micro|sem|afm/i, "microscope"],
  [/store|storage|rack|shelf/i, "storage"],
];

/** A station's pictogram: its own pick, else a guess from its name. */
export function stationGlyph(station: { name: string; icon?: string | null } | undefined | null): string {
  if (!station) return "station";
  return station.icon && P[station.icon] ? station.icon : guess(station.name, STATION_RULES, "station");
}

const DEVICE_RULES: [RegExp, string][] = [
  [/arm|robot|scara|gripper/i, "robot"],
  [/pipett|pump|syringe|liquid|dispens/i, "liquid"],
  [/hotplate|heat|stir|oven|furnace|thermo/i, "heat"],
  [/spin/i, "spin"],
  [/spectro|detector|^det|camera|uv|absorb/i, "spectrum"],
  [/motor|stage|axis/i, "motion"],
];

/** A device's pictogram, from its name and class. */
export function deviceGlyph(name: string, classname?: string | null): string {
  return guess(`${name} ${classname ?? ""}`, DEVICE_RULES, "sensor");
}

/** Flow-control step pictograms. */
export const STEP_GLYPH = { wait: "wait", input: "input", http: "http" } as const;
