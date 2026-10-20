/**
 * Adding a step: the stations (each with its pictogram) and the flow-control
 * steps; inside a station, its **station actions** and its **devices**, and
 * inside a device, that device's actions — the same grouping Device
 * Monitoring uses (`catalog`), so nothing is listed all at once. One search
 * cuts across all of it. Click an entry to add it at the marked spot, or drag
 * it onto the canvas. Everything comes from each pod's `plans_allowed` (plan
 * §9.2); nothing here lists plans by hand.
 */

import { useState, type DragEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import type { Palette, Station } from "../../api/types";
import { Glyph, STEP_GLYPH, deviceGlyph, stationGlyph } from "../../components/glyphs";
import { SearchBox } from "../../components/SearchBox";
import { CONTROL_STEPS, actionLabel, catalog, humanize, type Action } from "./plans";

/** What a picker entry stands for — clicked, or carried by a drag. */
export type StepTemplate =
  | { kind: "plan"; station: string; plan: string; preset: Record<string, unknown> }
  | { kind: "control"; type: "wait" | "input" | "http" };

export const DRAG_TYPE = "application/x-epichem-step";

interface NodePickerProps {
  stations: Station[];
  palettes: Map<string, UseQueryResult<Palette>>;
  onPick: (template: StepTemplate) => void;
}

type Level = { station: string; device?: string } | null;

export function NodePicker({ stations, palettes, onPick }: NodePickerProps) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Level>(null);
  const q = query.trim().toLowerCase();
  const executable = stations.filter((s) => s.queueserver_url);
  const station = executable.find((s) => s.uuid === level?.station);
  const palette = station ? palettes.get(station.uuid) : undefined;
  const actions = palette?.data ? catalog(palette.data) : null;
  const device = actions?.devices.find((d) => d.name === level?.device);

  const entry = (template: StepTemplate, glyph: string, name: string, desc: string, control = false) => (
    <button
      key={template.kind === "plan" ? `${template.station}:${JSON.stringify(template.preset)}:${template.plan}` : template.type}
      className="picker__item"
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(template));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(template)}
      title="Click to add, or drag onto the canvas"
    >
      <span className={control ? "picker__glyph picker__glyph--control" : "picker__glyph"}>
        <Glyph name={glyph} size={18} />
      </span>
      <span className="picker__text">
        <span className="picker__name">{name}</span>
        <span className="picker__desc">{desc}</span>
      </span>
      <span className="picker__grip" aria-hidden>
        ⋮⋮
      </span>
    </button>
  );
  const actionEntry = (s: Station, a: Action, where?: string) =>
    entry(
      { kind: "plan", station: s.uuid, plan: a.plan.name, preset: a.preset },
      a.device ? deviceGlyph(a.device, palettes.get(s.uuid)?.data?.devices[a.device]?.classname) : stationGlyph(s),
      where ? humanize(a.plan.name) : actionLabel(a),
      where ? `${where} · ${a.plan.description ?? a.plan.name}` : (a.plan.description ?? a.plan.name),
    );
  const folder = (key: string, glyph: string, name: string, desc: string, onOpen: () => void) => (
    <button key={key} className="picker__item" onClick={onOpen}>
      <span className="picker__glyph">
        <Glyph name={glyph} size={18} />
      </span>
      <span className="picker__text">
        <span className="picker__name">{name}</span>
        <span className="picker__desc">{desc}</span>
      </span>
      <Glyph name="chevron" size={14} className="picker__chevron" />
    </button>
  );
  const controls = CONTROL_STEPS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)).map((c) =>
    entry({ kind: "control", type: c.type }, STEP_GLYPH[c.type], c.label, c.description, true),
  );

  let body;
  if (q) {
    const hits = executable.flatMap((s) => {
      const p = palettes.get(s.uuid)?.data;
      if (!p) return [];
      const c = catalog(p);
      const all = [...c.station, ...c.devices.flatMap((d) => d.actions), ...c.other];
      return all
        .filter((a) => `${a.plan.name} ${a.plan.description ?? ""} ${a.device ?? ""}`.toLowerCase().includes(q))
        .map((a) => actionEntry(s, a, a.device ? `${s.name} · ${a.device}` : s.name));
    });
    body = (
      <>
        {hits}
        {controls}
        {hits.length + controls.length === 0 && <p className="muted picker__note">Nothing matches.</p>}
      </>
    );
  } else if (station && device) {
    body = (
      <>
        <button className="picker__back" onClick={() => setLevel({ station: station.uuid })}>
          <Glyph name="back" size={14} /> {station.name}
        </button>
        <div className="picker__station-head">
          <span className="picker__glyph picker__glyph--large">
            <Glyph name={deviceGlyph(device.name, device.classname)} size={26} />
          </span>
          <span className="picker__text">
            <span className="picker__name">{device.name}</span>
            <span className="picker__desc mono">{device.classname}</span>
          </span>
        </div>
        <p className="picker__heading label">Device actions</p>
        {device.actions.map((a) => actionEntry(station, a))}
      </>
    );
  } else if (station) {
    body = (
      <>
        <button className="picker__back" onClick={() => setLevel(null)}>
          <Glyph name="back" size={14} /> All stations
        </button>
        <div className="picker__station-head">
          <span className="picker__glyph picker__glyph--large">
            <Glyph name={stationGlyph(station)} size={26} />
          </span>
          <span className="picker__name">{station.name}</span>
        </div>
        {!palette || palette.isPending ? (
          <p className="muted picker__note">Reading the station&apos;s plans…</p>
        ) : palette.isError ? (
          <p className="create__error picker__note">{(palette.error as Error).message}</p>
        ) : (
          actions && (
            <>
              {actions.station.length > 0 && <p className="picker__heading label">Station actions</p>}
              {actions.station.map((a) => actionEntry(station, a))}
              {actions.devices.some((d) => d.actions.length) && <p className="picker__heading label">Devices</p>}
              {actions.devices
                .filter((d) => d.actions.length)
                .map((d) =>
                  folder(
                    d.name,
                    deviceGlyph(d.name, d.classname),
                    d.name,
                    `${d.actions.length} action${d.actions.length === 1 ? "" : "s"}`,
                    () => setLevel({ station: station.uuid, device: d.name }),
                  ),
                )}
              {actions.other.length > 0 && (
                <details className="picker__more">
                  <summary className="picker__heading label">More ({actions.other.length})</summary>
                  {actions.other.map((a) => actionEntry(station, a))}
                </details>
              )}
            </>
          )
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="picker__heading label">Stations</p>
        {executable.length === 0 && (
          <p className="muted picker__note">No executable station — give one a queueserver URL, or link a pod under New device.</p>
        )}
        {executable.map((s) => {
          const p = palettes.get(s.uuid);
          const c = p?.data ? catalog(p.data) : null;
          return folder(
            s.uuid,
            stationGlyph(s),
            s.name,
            p?.isError
              ? "unreachable"
              : c
                ? `${c.station.length} station action${c.station.length === 1 ? "" : "s"} · ${c.devices.length} device${c.devices.length === 1 ? "" : "s"}`
                : "…",
            () => setLevel({ station: s.uuid }),
          );
        })}
        <p className="picker__heading label">Flow control</p>
        {controls}
      </>
    );
  }

  return (
    <div className="picker">
      <SearchBox value={query} onChange={setQuery} placeholder="Search stations, actions, steps" className="picker__search" />
      <p className="muted picker__hint">Click to add at the marked spot, or drag onto the canvas.</p>
      {body}
    </div>
  );
}
