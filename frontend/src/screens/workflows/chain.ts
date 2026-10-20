/**
 * The designer's step graph (Roadmap 2.2). A procedure runs as one chain —
 * Start, then each connected step in turn — but the canvas may also hold
 * loose steps and fragments not wired in yet. Stored as the step list itself:
 * the connected steps first, in run order, then the detached ones, each with
 * `after` naming the step it hangs from in its fragment. Every edit goes
 * through links (source → target, at most one each way) and back, so the list
 * order and the flags can't drift from what the canvas shows.
 */

import type { ProcedureStep } from "../../api/types";

export const START = "__start";

export type Link = [source: string, target: string];

const normal = (s: ProcedureStep, detached: boolean, after: string | null): ProcedureStep => ({
  ...s,
  detached,
  after,
});

/** The links a step list encodes. */
export function linksOf(steps: ProcedureStep[]): Link[] {
  const links: Link[] = [];
  let previous = START;
  for (const s of steps) {
    if (s.detached) {
      if (s.after) links.push([s.after, s.id]);
    } else {
      links.push([previous, s.id]);
      previous = s.id;
    }
  }
  return links;
}

/** The step list a set of links encodes: Start's chain, then the loose fragments. */
export function fromLinks(steps: ProcedureStep[], links: Link[]): ProcedureStep[] {
  const ids = new Set(steps.map((s) => s.id));
  const out = new Map<string, string>();
  const into = new Map<string, string>();
  for (const [source, target] of links) {
    if ((source !== START && !ids.has(source)) || !ids.has(target)) continue;
    out.set(source, target);
    into.set(target, source);
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const result: ProcedureStep[] = [];

  for (let id = out.get(START); id && !placed.has(id); id = out.get(id)) {
    placed.add(id);
    result.push(normal(byId.get(id)!, false, null));
  }
  const heads = steps.filter((s) => !placed.has(s.id) && !(into.has(s.id) && ids.has(into.get(s.id)!) && !placed.has(into.get(s.id)!)));
  for (const head of heads) {
    for (let id: string | undefined = head.id; id && !placed.has(id); id = out.get(id)) {
      placed.add(id);
      result.push(normal(byId.get(id)!, true, id === head.id ? null : into.get(id)!));
    }
  }
  for (const s of steps) if (!placed.has(s.id)) result.push(normal(s, true, null)); // only a cycle could leave one
  return result;
}

/** Does following links from `from` reach `to`? */
function reaches(links: Link[], from: string, to: string): boolean {
  const out = new Map(links);
  const seen = new Set<string>();
  for (let id: string | undefined = from; id && !seen.has(id); id = out.get(id)) {
    if (id === to) return true;
    seen.add(id);
  }
  return false;
}

/** Wire source → target, replacing source's old successor and target's old
 * predecessor. Null when it would close a loop. */
export function connect(steps: ProcedureStep[], source: string, target: string): ProcedureStep[] | null {
  if (source === target || target === START) return null;
  const links = linksOf(steps).filter(([s, t]) => s !== source && t !== target);
  if (reaches(links, target, source)) return null;
  return fromLinks(steps, [...links, [source, target]]);
}

export function disconnect(steps: ProcedureStep[], source: string, target: string): ProcedureStep[] {
  return fromLinks(steps, linksOf(steps).filter(([s, t]) => !(s === source && t === target)));
}

/** Put `step` right after `source` (Start or a step), before whatever followed it. */
export function insertAfter(steps: ProcedureStep[], source: string, step: ProcedureStep): ProcedureStep[] {
  const links = linksOf(steps);
  const next = links.find(([s]) => s === source)?.[1];
  const kept = links.filter(([s]) => s !== source);
  const added: Link[] = [[source, step.id]];
  if (next) added.push([step.id, next]);
  return fromLinks([...steps, step], [...kept, ...added]);
}

/** Remove a step, joining its neighbours so the chain stays whole. */
export function removeStep(steps: ProcedureStep[], id: string): ProcedureStep[] {
  const links = linksOf(steps);
  const previous = links.find(([, t]) => t === id)?.[0];
  const next = links.find(([s]) => s === id)?.[1];
  const kept = links.filter(([s, t]) => s !== id && t !== id);
  if (previous && next) kept.push([previous, next]);
  return fromLinks(
    steps.filter((s) => s.id !== id),
    kept,
  );
}

/** The last connected step, or Start — where "append" goes. */
export const chainEnd = (steps: ProcedureStep[]) => steps.filter((s) => !s.detached).at(-1)?.id ?? START;

/**
 * Where each node sits. A step someone placed keeps its position; the rest
 * follow their predecessor, one gap to the right — so inserting into an
 * untouched chain pushes the tail along, and a loose fragment gets a row of
 * its own below.
 */
export function positions(steps: ProcedureStep[], gap: number, row: number): Map<string, { x: number; y: number }> {
  const at = new Map<string, { x: number; y: number }>([[START, { x: 0, y: 0 }]]);
  let fragment = 0;
  let previous = START;
  for (const s of steps) {
    const from = s.detached ? (s.after ? at.get(s.after) : undefined) : at.get(previous);
    if (s.detached && !s.after) fragment += 1;
    const auto = from ? { x: from.x + gap, y: from.y } : { x: gap, y: fragment * row };
    at.set(s.id, s.position ? { x: s.position[0], y: s.position[1] } : auto);
    if (!s.detached) previous = s.id;
  }
  return at;
}
