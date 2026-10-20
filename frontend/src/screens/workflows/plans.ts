/**
 * Reading bluesky-queueserver's plan representations (plan §9.2) — the one
 * source the designer's palette and every parameter form are generated from.
 * Nothing here is hand-maintained per plan: a plan added to a station pod
 * shows up, with its form, the next time the palette loads.
 */

import type { Palette, PlanParameter, PlanRepr, ProcedureStep } from "../../api/types";

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

// ------------------------------------------------------------ flow control

export const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A plan step on a station, required single-choice enums pre-filled. */
export function newPlanStep(plan: PlanRepr, station: string, preset: Record<string, unknown> = {}): ProcedureStep {
  const step = newStep(plan);
  return { ...step, type: "plan", station_uuid: station, kwargs: { ...step.kwargs, ...preset } };
}

export const CONTROL_STEPS = [
  { type: "wait", label: "Wait", description: "Pause for a fixed time before the next step." },
  { type: "input", label: "Input", description: "Ask the operator to confirm or enter values; the run waits." },
  { type: "http", label: "HTTP request", description: "Call an API — notify someone, ask an optimiser for parameters." },
] as const;

export function newControlStep(type: "wait" | "input" | "http"): ProcedureStep {
  const kwargs: Record<string, Record<string, unknown>> = {
    wait: { duration_s: 60 },
    input: { prompt: "", fields: [] },
    http: { method: "POST", url: "", body: "" },
  };
  return { id: newId(), type, plan: "", kwargs: kwargs[type] };
}

/** One line under a node: what the step will do. */
export function describeStep(step: ProcedureStep, stationName?: string): string {
  const k = step.kwargs;
  switch (step.type ?? "plan") {
    case "wait": {
      const s = Number(k.duration_s);
      return Number.isFinite(s) ? (s >= 3600 ? `${s / 3600} h` : s >= 60 ? `${s / 60} min` : `${s} s`) : "set a duration";
    }
    case "input":
      return String(k.prompt || "set a prompt").slice(0, 40);
    case "http": {
      try {
        return `${k.method ?? "GET"} ${new URL(String(k.url)).host}`;
      } catch {
        return `${k.method ?? "GET"} — set a URL`;
      }
    }
    default:
      return stationName ?? "";
  }
}

/** Plan names read better as words: coat_sample -> "coat sample". */
export const humanize = (name: string) => name.replace(/_/g, " ");

/**
 * What a step's later neighbours can reference (`{{steps.<id>.<field>}}`):
 * an input's fields, an HTTP response's status and body, a plan's run uids.
 */
export function referencesBefore(steps: ProcedureStep[], index: number): { value: string; label: string }[] {
  const refs: { value: string; label: string }[] = [];
  steps.slice(0, index).forEach((step, i) => {
    const kind = { wait: "Wait", input: "Input", http: "HTTP request" }[step.type as "wait"];
    const name = `${i + 1} ${step.label || (step.type === "plan" || !step.type ? humanize(step.plan) : kind)}`;
    const ref = (path: string) => `{{steps.${step.id}.${path}}}`;
    if (step.type === "input") {
      for (const f of (step.kwargs.fields as { name: string; label?: string }[] | undefined) ?? []) {
        if (f.name) refs.push({ value: ref(f.name), label: `${name} → ${f.label || f.name}` });
      }
    } else if (step.type === "http") {
      refs.push({ value: ref("status"), label: `${name} → status` });
      refs.push({ value: ref("json"), label: `${name} → response JSON` });
    } else if (!step.type || step.type === "plan") {
      refs.push({ value: ref("run_uids.0"), label: `${name} → bluesky run uid` });
    }
  });
  return refs;
}

export const isTemplate = (value: unknown) => typeof value === "string" && /\{\{\s*steps\./.test(value);

// ------------------------------------------------------------ actions

/**
 * One plan as something to do on a station: a station-level operation, or an
 * action on one device (with that device filled in, `preset`).
 */
export interface Action {
  plan: PlanRepr;
  preset: Record<string, unknown>;
  /** The device it acts on; null for a station action. */
  device: string | null;
}

export interface DeviceActions {
  name: string;
  classname?: string;
  actions: Action[];
}

/**
 * A station's plans the way people think of them (Device Monitoring and the
 * designer's picker both use this):
 *
 * - **station**: the operations its pod offers — every library that isn't a
 *   low-level one;
 * - **devices**: per device, the plans that act on it — generated from its
 *   driver (`epichem_pod.auto.<device>_low_level`), or a low-level plan whose
 *   one device argument can be it (filled in);
 * - **other**: what's left — bluesky's stock plans, low-level plans tied to
 *   no single device.
 */
export function catalog(palette: Palette): { station: Action[]; devices: DeviceActions[]; other: Action[] } {
  const station: Action[] = [];
  const other: Action[] = [];
  const devices = new Map<string, DeviceActions>(
    Object.entries(palette.devices).map(([name, d]) => [name, { name, classname: d.classname, actions: [] }]),
  );
  for (const plan of Object.values(palette.plans)) {
    const module = plan.module ?? "";
    const auto = module.match(/^epichem_pod\.auto\.(.+)_low_level$/);
    if (auto && devices.has(auto[1])) {
      devices.get(auto[1])!.actions.push({ plan, preset: {}, device: auto[1] });
      continue;
    }
    if (module.endsWith("_low_level")) {
      const params = parametersOf(plan).filter(isDeviceParameter);
      const options = params.length === 1 ? Object.values(params[0].annotation?.devices ?? {}).flat() : [];
      const targets = options.filter((d) => devices.has(d));
      for (const d of targets) devices.get(d)!.actions.push({ plan, preset: { [params[0].name]: d }, device: d });
      if (targets.length === 0) other.push({ plan, preset: {}, device: null });
      continue;
    }
    (module.startsWith("bluesky.") ? other : station).push({ plan, preset: {}, device: null });
  }
  const byName = (a: Action, b: Action) => a.plan.name.localeCompare(b.plan.name);
  return {
    station: station.sort(byName),
    devices: [...devices.values()].map((d) => ({ ...d, actions: d.actions.sort(byName) })),
    other: other.sort(byName),
  };
}

/** A stable key for an action — what pins remember. */
export const actionKey = (a: Action) => `${a.device ?? ""}:${a.plan.name}`;

/** "hotplate_off" on hotplate1 reads "off": drop the device's name, or its type. */
export function actionLabel(a: Action): string {
  if (!a.device) return humanize(a.plan.name);
  return a.plan.name
    .replace(new RegExp(`^${a.device}_`), "")
    .replace(new RegExp(`^${a.device.replace(/\d+$/, "")}_`), "")
    .replace(/_/g, " ");
}

/** The parameters a person still has to think about once the preset is in. */
export const openParameters = (a: Action) => parametersOf(a.plan).filter((p) => !(p.name in a.preset));
