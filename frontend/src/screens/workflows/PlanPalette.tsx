/**
 * The node palette: the plans the chosen station's pod offers, grouped by plan
 * library and searchable. Click a plan to add it after the selected step, or
 * drag it onto the canvas. Everything here comes from the pod's
 * `plans_allowed` (plan §9.2) — there is no plan list in this codebase.
 */

import { useState } from "react";

import type { Palette, PlanRepr } from "../../api/types";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { SearchBox } from "../../components/SearchBox";
import { groupPlans } from "./plans";

export const PLAN_MIME = "application/x-epichem-plan";

interface PlanPaletteProps {
  palette: Palette | undefined;
  loading: boolean;
  error: Error | null;
  onAdd: (plan: PlanRepr) => void;
  onRegister: () => void;
  registering: boolean;
}

export function PlanPalette({ palette, loading, error, onAdd, onRegister, registering }: PlanPaletteProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (loading) return <p className="muted palette__note">Reading the station&apos;s plans…</p>;
  if (error) return <div className="palette__note"><Alert kind="error">{error.message}</Alert></div>;
  if (!palette) return <p className="muted palette__note">Choose an executable station to see what it can do.</p>;

  const missing = Object.keys(palette.devices).filter((d) => !palette.registered.includes(d));
  const groups = groupPlans(palette.plans, query);

  return (
    <div className="palette">
      {missing.length > 0 && (
        <div className="palette__register">
          <p>
            {missing.length} device{missing.length === 1 ? " in this pod isn't" : "s in this pod aren't"} registered in
            EPIChem yet: <span className="mono">{missing.join(", ")}</span>.
          </p>
          <Button size="sm" onClick={onRegister} disabled={registering}>
            {registering ? "Registering…" : "Register devices"}
          </Button>
        </div>
      )}

      <SearchBox className="palette__search" value={query} onChange={setQuery} placeholder="Search plans" />

      {groups.length === 0 && <p className="muted palette__note">No plan matches.</p>}
      {groups.map((group) => (
        <section key={group.key} className="palette__group">
          <button
            className="palette__group-title label"
            onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
            aria-expanded={!collapsed[group.key]}
          >
            {collapsed[group.key] ? "▸" : "▾"} {group.label} <span className="palette__count">{group.plans.length}</span>
          </button>
          {!collapsed[group.key] &&
            group.plans.map((plan) => (
              <button
                key={plan.name}
                className="palette__plan"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PLAN_MIME, plan.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(plan)}
                title={plan.description ?? plan.name}
              >
                <span className="palette__plan-name">{plan.name}</span>
                {plan.description && <span className="palette__plan-desc">{plan.description}</span>}
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
