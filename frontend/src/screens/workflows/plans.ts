/**
 * Reading bluesky-queueserver's plan representations (plan §9.2) — the one
 * source the designer's palette and every parameter form are generated from.
 * Nothing here is hand-maintained per plan: a plan added to a station pod
 * shows up, with its form, the next time the palette loads.
 */

import type { PlanParameter, PlanRepr, ProcedureStep } from "../../api/types";

/** Parameters EPIChem fills itself, never shown (mirrors the backend's RESERVED_PARAMETERS). */
const RESERVED = new Set(["md"]);

export function parametersOf(plan: PlanRepr | undefined): PlanParameter[] {
  return (plan?.parameters ?? []).filter(
    (p) => !RESERVED.has(p.name) && !["VAR_POSITIONAL", "VAR_KEYWORD"].includes(p.kind?.name),
  );
}

export const isRequired = (p: PlanParameter) => p.default === undefined;

/** A Python literal from the representation ("True", "2.5", "'abc'", "None") as JS. */
export function parseDefault(literal: string | undefined): unknown {
  if (literal === undefined || literal === "None") return null;
  if (literal === "True") return true;
  if (literal === "False") return false;
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(literal)) return Number(literal);
  const quoted = literal.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2] : literal;
}

/** The names an enum-annotated parameter accepts (devices, plans or plain enums). */
export function enumOptions(p: PlanParameter): string[] | null {
  const groups = [p.annotation?.devices, p.annotation?.plans, p.annotation?.enums].filter(Boolean);
  if (groups.length === 0) return null;
  return [...new Set(groups.flatMap((g) => Object.values(g!).flat()))];
}

export type InputKind = "enum" | "bool" | "int" | "float" | "text";

export function inputKind(p: PlanParameter): InputKind {
  if (enumOptions(p)) return "enum";
  const type = p.annotation?.type;
  if (type === "bool") return "bool";
  if (type === "int") return "int";
  if (type === "float") return "float";
  return "text";
}

export const isDeviceParameter = (p: PlanParameter) => Boolean(p.annotation?.devices);

/**
 * Plans group by the module they're defined in — a pod's plan library. The
 * convention in the reference pod is `epichem_plans.<station>` for the
 * operations a scientist uses and `epichem_plans.<station>_low_level` for the
 * single device actions they're built from (see bluesky/epichem_plans).
 */
export interface PlanGroup {
  key: string;
  label: string;
  /** Lower sorts first: a station's operations before its low-level actions. */
  rank: number;
  plans: PlanRepr[];
}

function groupOf(module: string | undefined): { key: string; label: string; rank: number } {
  if (!module || module === "__main__") return { key: "station", label: "Station plans", rank: 2 };
  if (module.startsWith("bluesky.")) return { key: "bluesky", label: "Bluesky stock plans", rank: 3 };
  const leaf = module.split(".").pop()!;
  const low = leaf.endsWith("_low_level");
  const base = (low ? leaf.slice(0, -"_low_level".length) : leaf).replace(/_/g, " ");
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  return { key: module, label: low ? `${title} · low level` : title, rank: low ? 1 : 0 };
}

export function groupPlans(plans: Record<string, PlanRepr>, query = ""): PlanGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, PlanGroup>();
  for (const plan of Object.values(plans)) {
    if (q && !plan.name.toLowerCase().includes(q) && !(plan.description ?? "").toLowerCase().includes(q)) continue;
    const g = groupOf(plan.module);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, plans: [] });
    groups.get(g.key)!.plans.push(plan);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, plans: g.plans.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

/** A fresh step for `plan`: required enums pre-filled when there's only one choice. */
export function newStep(plan: PlanRepr): ProcedureStep {
  const kwargs: Record<string, unknown> = {};
  for (const p of parametersOf(plan)) {
    const options = enumOptions(p);
    if (isRequired(p) && options?.length === 1) kwargs[p.name] = options[0];
  }
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, plan: plan.name, kwargs };
}

/** `heater=hotplate, setpoint_c=80` — the compact summary a node shows. */
export function summarize(step: ProcedureStep, limit = 3): string {
  const entries = Object.entries(step.kwargs).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const shown = entries.slice(0, limit).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return entries.length > limit ? `${shown.join(", ")}, …` : shown.join(", ");
}

/**
 * The queue items a step list becomes — the same shape the backend's
 * `compile_steps` produces (the backend is authoritative; this is the live
 * preview of the unsaved draft).
 */
export function previewItems(steps: ProcedureStep[], procedure: string | null, version: number) {
  return steps.map((step, index) => ({
    item_type: "plan",
    name: step.plan,
    args: [],
    kwargs: Object.fromEntries(Object.entries(step.kwargs).filter(([, v]) => v !== null && v !== undefined)),
    meta: {
      epichem: {
        procedure: procedure ?? "<unsaved>",
        procedure_version: version,
        run: "<run uuid>",
        sample: "<sample uuid>",
        step_id: step.id,
        step_index: index,
      },
    },
  }));
}
