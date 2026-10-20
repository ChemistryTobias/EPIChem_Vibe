/**
 * Adding a step: the stations (each with its pictogram — drill in for its
 * plans, grouped by library), the flow-control steps, and one search across
 * all of it. Station plans come from each pod's `plans_allowed` (plan §9.2);
 * nothing here lists plans by hand.
 */

import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import type { Palette, PlanRepr, Station } from "../../api/types";
import { Glyph, STEP_GLYPH, stationGlyph } from "../../components/glyphs";
import { SearchBox } from "../../components/SearchBox";
import { CONTROL_STEPS, groupPlans, humanize } from "./plans";

interface NodePickerProps {
  stations: Station[];
  palettes: Map<string, UseQueryResult<Palette>>;
  onPlan: (plan: PlanRepr, station: Station) => void;
  onControl: (type: "wait" | "input" | "http") => void;
}

export function NodePicker({ stations, palettes, onPlan, onControl }: NodePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const executable = stations.filter((s) => s.queueserver_url);
  const station = executable.find((s) => s.uuid === open);

  const planRow = (plan: PlanRepr, s: Station, showStation = false) => (
    <button key={`${s.uuid}:${plan.name}`} className="picker__item" onClick={() => onPlan(plan, s)}>
      <span className="picker__glyph">
        <Glyph name={stationGlyph(s)} size={18} />
      </span>
      <span className="picker__text">
        <span className="picker__name">{humanize(plan.name)}</span>
        <span className="picker__desc">
          {showStation ? `${s.name} · ` : ""}
          {plan.description ?? plan.name}
        </span>
      </span>
    </button>
  );

  const controls = CONTROL_STEPS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));

  return (
    <div className="picker">
      <SearchBox value={query} onChange={setQuery} placeholder="Search stations, plans, steps" className="picker__search" />

      {q ? (
        <>
          {executable.flatMap((s) =>
            Object.values(palettes.get(s.uuid)?.data?.plans ?? {})
              .filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
              .map((p) => planRow(p, s, true)),
          )}
          {controls.map((c) => (
            <ControlRow key={c.type} {...c} onClick={() => onControl(c.type)} />
          ))}
        </>
      ) : station ? (
        <>
          <button className="picker__back" onClick={() => setOpen(null)}>
            <Glyph name="back" size={14} /> All stations
          </button>
          <div className="picker__station-head">
            <span className="picker__glyph picker__glyph--large">
              <Glyph name={stationGlyph(station)} size={26} />
            </span>
            <span className="picker__name">{station.name}</span>
          </div>
          <PaletteGroups query={palettes.get(station.uuid)} render={(p) => planRow(p, station)} />
        </>
      ) : (
        <>
          <p className="picker__heading label">Stations</p>
          {executable.length === 0 && (
            <p className="muted picker__note">No executable station — give one a queueserver URL, or link a pod under New device.</p>
          )}
          {executable.map((s) => {
            const palette = palettes.get(s.uuid);
            const count = palette?.data ? Object.keys(palette.data.plans).length : null;
            return (
              <button key={s.uuid} className="picker__item" onClick={() => setOpen(s.uuid)}>
                <span className="picker__glyph">
                  <Glyph name={stationGlyph(s)} size={18} />
                </span>
                <span className="picker__text">
                  <span className="picker__name">{s.name}</span>
                  <span className="picker__desc">
                    {palette?.isError ? "unreachable" : count === null ? "…" : `${count} plan${count === 1 ? "" : "s"}`}
                  </span>
                </span>
                <Glyph name="chevron" size={14} className="picker__chevron" />
              </button>
            );
          })}
          <p className="picker__heading label">Flow control</p>
          {controls.map((c) => (
            <ControlRow key={c.type} {...c} onClick={() => onControl(c.type)} />
          ))}
        </>
      )}
    </div>
  );
}

function ControlRow({ type, label, description, onClick }: { type: "wait" | "input" | "http"; label: string; description: string; onClick: () => void }) {
  return (
    <button className="picker__item" onClick={onClick}>
      <span className="picker__glyph picker__glyph--control">
        <Glyph name={STEP_GLYPH[type]} size={18} />
      </span>
      <span className="picker__text">
        <span className="picker__name">{label}</span>
        <span className="picker__desc">{description}</span>
      </span>
    </button>
  );
}

function PaletteGroups({ query, render }: { query: UseQueryResult<Palette> | undefined; render: (p: PlanRepr) => React.ReactNode }) {
  if (!query || query.isPending) return <p className="muted picker__note">Reading the station&apos;s plans…</p>;
  if (query.isError) return <p className="create__error picker__note">{(query.error as Error).message}</p>;
  return (
    <>
      {groupPlans(query.data.plans).map((group) => (
        <div key={group.key}>
          <p className="picker__heading label">{group.label}</p>
          {group.plans.map(render)}
        </div>
      ))}
    </>
  );
}
