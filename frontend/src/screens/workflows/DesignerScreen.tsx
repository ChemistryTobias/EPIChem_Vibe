/**
 * The workflow designer (Roadmap 2.1/2.2, plan §9 and §10.4), n8n-style:
 * one procedure on a full-width canvas — Start, then a tile per step, an end
 * "+" — and a side panel that is either the step picker (stations → station
 * and device actions, flow-control steps) or the selected step's values.
 *
 * - Plans come from each station pod's `plans_allowed` (§9.2); steps can use
 *   different stations, and Wait / Input / HTTP steps EPIChem runs itself.
 * - Add a step from the picker (click, or drag it onto the canvas), wire tiles
 *   by dragging handle to handle, cut a link with its "×"; each tile carries
 *   its own Duplicate / Delete. Only steps connected to Start run (`chain.ts`).
 * - Validation runs server-side on every change and badges the tiles (§9.3);
 *   issues and the compiled queue items sit in a collapsible panel.
 * - The draft is local until Save — one save, one revision. Run saves first
 *   if needed. Pick a different procedure in Workflows → Procedures.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { stationsApi } from "../../api/entities";
import type { Diagnostic, Procedure, ProcedureStep } from "../../api/types";
import { executionApi, proceduresApi, runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Glyph, STEP_GLYPH, stationGlyph } from "../../components/glyphs";
import { Inspector } from "../../components/Inspector";
import { StatusPill } from "../../components/StatusPill";
import { rememberProcedure } from "../../router";
import { edgeTypes, nodeTypes, type PlusEdgeType, type StepTileNode } from "./canvas";
import { START, chainEnd, connect, disconnect, insertAfter, linksOf, positions, removeStep } from "./chain";
import { DRAG_TYPE, NodePicker, type StepTemplate } from "./NodePicker";
import { describeStep, humanize, newControlStep, newId, newPlanStep, previewItems, referencesBefore } from "./plans";
import { RunLauncher, type SampleDraft } from "./RunLauncher";
import { StepSettings } from "./StepSettings";

import "./workflows.css";

const GAP = 180;
const ROW = 190;

interface Draft {
  name: string;
  description: string | null;
  station_uuid: string | null;
  steps: ProcedureStep[];
}

/** pick: the picker, adding after `after` (Start or a step). */
type Panel = { mode: "pick"; after: string } | { mode: "step"; id: string } | { mode: "run" } | null;

const toDraft = (p: Procedure): Draft => ({
  name: p.name,
  description: p.description,
  station_uuid: p.station_uuid,
  // Older steps name no station: they run on the procedure's.
  steps: p.steps.map((s) => ({
    id: s.id,
    type: s.type ?? "plan",
    plan: s.plan,
    station_uuid: (s.type ?? "plan") === "plan" ? (s.station_uuid ?? p.station_uuid) : null,
    kwargs: s.kwargs,
    label: s.label ?? null,
    position: s.position ?? null,
    detached: Boolean(s.detached),
    after: s.after ?? null,
  })),
});

export function DesignerScreen() {
  return (
    <ReactFlowProvider>
      <Designer />
    </ReactFlowProvider>
  );
}

function Designer() {
  const { procedureId } = useParams({ from: "/workflows/designer/$procedureId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const flow = useReactFlow();

  const procedure = useQuery({ queryKey: ["procedure", procedureId], queryFn: () => proceduresApi.get(procedureId), retry: false });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const executable = useMemo(() => (stations.data ?? []).filter((s) => s.queueserver_url), [stations.data]);
  const stationById = useMemo(() => new Map((stations.data ?? []).map((s) => [s.uuid, s])), [stations.data]);

  const paletteQueries = useQueries({
    queries: executable.map((s) => ({
      queryKey: ["palette", s.uuid],
      queryFn: () => executionApi.palette(s.uuid),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const palettes = useMemo(() => new Map(executable.map((s, i) => [s.uuid, paletteQueries[i]])), [executable, paletteQueries]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issuesTab, setIssuesTab] = useState<"issues" | "items">("issues");
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (procedure.data && loadedFor.current !== procedure.data.uuid) {
      loadedFor.current = procedure.data.uuid;
      setDraft(toDraft(procedure.data));
      setPanel(procedure.data.steps.length ? null : { mode: "pick", after: START });
      rememberProcedure(procedure.data.uuid);
    }
  }, [procedure.data]);
  useEffect(() => {
    if (procedure.isError) rememberProcedure(null);
  }, [procedure.isError]);

  const saved = procedure.data ?? null;
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const steps = draft?.steps ?? [];

  // ---- validation -----------------------------------------------------------
  const pending = useDeferredValue(JSON.stringify({ s: draft?.station_uuid ?? null, steps }));
  const validation = useQuery({
    queryKey: ["validate", pending],
    queryFn: () => {
      const { s, steps: st } = JSON.parse(pending);
      return proceduresApi.validate(s, st);
    },
    enabled: draft !== null,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const diagnostics: Diagnostic[] = useMemo(() => validation.data?.diagnostics ?? [], [validation.data]);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  // ---- editing --------------------------------------------------------------
  const setSteps = (next: ProcedureStep[]) => setDraft((d) => (d ? { ...d, steps: next } : d));
  const selectedId = panel?.mode === "step" ? panel.id : null;
  const connectedSteps = steps.filter((s) => !s.detached);
  const [notice, setNotice] = useState<string | null>(null);

  const make = useCallback(
    (t: StepTemplate): ProcedureStep | null => {
      if (t.kind === "control") return newControlStep(t.type);
      const plan = palettes.get(t.station)?.data?.plans[t.plan];
      return plan ? newPlanStep(plan, t.station, t.preset) : null;
    },
    [palettes],
  );
  function add(t: StepTemplate, after: string) {
    const step = make(t);
    if (!step) return;
    setSteps(insertAfter(steps, after, step));
    setPanel({ mode: "step", id: step.id });
  }
  function remove(id: string) {
    setSteps(removeStep(steps, id));
    if (selectedId === id) setPanel(null);
  }
  function duplicate(id: string) {
    const original = steps.find((s) => s.id === id);
    if (!original) return;
    const copy: ProcedureStep = { ...original, id: newId(), position: null };
    if (original.detached) {
      const [x, y] = original.position ?? [0, 0];
      setSteps([...steps, { ...copy, after: null, position: original.position ? [x + 30, y + 150] : null }]);
    } else {
      setSteps(insertAfter(steps, id, copy));
    }
    setPanel({ mode: "step", id: copy.id });
  }
  function wire(source: string | null, target: string | null) {
    if (!source || !target) return;
    const next = connect(steps, source, target);
    if (next) setSteps(next);
    else setNotice("That link would make a loop — a procedure runs straight through.");
  }

  // ---- canvas ---------------------------------------------------------------
  const titleOf = useCallback(
    (step: ProcedureStep) => step.label || ((step.type ?? "plan") === "plan" ? humanize(step.plan) : { wait: "Wait", input: "Input", http: "HTTP request" }[step.type as "wait"]),
    [],
  );
  const placed = useMemo(() => positions(steps, GAP, ROW), [steps]);
  /** The device a plan step acts on, if one of its values names one. */
  const deviceOf = useCallback(
    (step: ProcedureStep) => {
      const palette = step.station_uuid ? palettes.get(step.station_uuid)?.data : undefined;
      if (!palette) return undefined;
      const generated = palette.plans[step.plan]?.module?.match(/^epichem_pod\.auto\.(.+)_low_level$/);
      return generated?.[1] ?? Object.values(step.kwargs).find((v): v is string => typeof v === "string" && v in palette.devices);
    },
    [palettes],
  );
  const layout = useCallback((): Node[] => {
    let index = 0;
    const tiles: StepTileNode[] = steps.map((step) => {
      const station = step.station_uuid ? stationById.get(step.station_uuid) : undefined;
      const control = (step.type ?? "plan") !== "plan";
      return {
        id: step.id,
        type: "step",
        position: placed.get(step.id)!,
        selected: step.id === selectedId,
        data: {
          index: step.detached ? null : index++,
          glyph: control ? STEP_GLYPH[step.type as keyof typeof STEP_GLYPH] : stationGlyph(station),
          title: titleOf(step),
          subtitle: describeStep(step, [station?.name, deviceOf(step)].filter(Boolean).join(" · ")),
          control,
          errors: diagnostics.filter((d) => d.step_id === step.id && d.severity === "error").length,
          warnings: diagnostics.filter((d) => d.step_id === step.id && d.severity === "warning").length,
          onDuplicate: () => duplicate(step.id),
          onDelete: () => remove(step.id),
        },
      };
    });
    // The "+" goes after the last connected step — past any tile on its row,
    // so it never lands on a step someone moved there.
    const end = placed.get(chainEnd(steps))!;
    const rowRight = Math.max(end.x, ...steps.map((s) => placed.get(s.id)!).filter((at) => Math.abs(at.y - end.y) < 120).map((at) => at.x));
    return [
      { id: START, type: "start", position: { x: 0, y: 22 }, draggable: false, selectable: false, data: {} },
      ...tiles,
      {
        id: "__add",
        type: "add",
        position: { x: rowRight + GAP, y: end.y + 22 },
        draggable: false,
        selectable: false,
        connectable: false,
        data: { onAdd: () => setPanel({ mode: "pick", after: chainEnd(steps) }), empty: steps.length === 0 },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, placed, stationById, selectedId, diagnostics, titleOf, deviceOf]);

  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => setNodes(layout()), [layout]);

  const edges: PlusEdgeType[] = [
    ...linksOf(steps).map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: "plus" as const,
      reconnectable: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#006C66" },
      data: { onInsert: () => setPanel({ mode: "pick", after: source }), onCut: () => setSteps(disconnect(steps, source, target)) },
    })),
    {
      id: "__end",
      source: chainEnd(steps),
      target: "__add",
      type: "plus",
      reconnectable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#006C66" },
      data: {},
    },
  ];

  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.12, maxZoom: 1, duration: 200 }), 40);
    return () => clearTimeout(t);
  }, [steps.length, procedureId, panel !== null, flow]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Where someone puts a tile, it stays. */
  function keepPositions(moved: Node[]) {
    const at = new Map(moved.filter((n) => n.type === "step").map((n) => [n.id, [Math.round(n.position.x), Math.round(n.position.y)] as [number, number]]));
    if (at.size) setSteps(steps.map((s) => (at.has(s.id) ? { ...s, position: at.get(s.id)! } : s)));
  }
  function onDrop(e: DragEvent) {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    const step = make(JSON.parse(raw) as StepTemplate);
    if (!step) return;
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const placedStep = { ...step, position: [Math.round(at.x - 45), Math.round(at.y - 45)] as [number, number] };
    // Onto an empty canvas it's the first step; otherwise it lands loose,
    // ready to be wired where it belongs.
    setSteps(connectedSteps.length === 0 ? insertAfter(steps, START, placedStep) : [...steps, { ...placedStep, detached: true, after: null }]);
    setPanel({ mode: "step", id: step.id });
  }

  // ---- keyboard -------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
    if (e.key === "Escape") setPanel(null);
    if (e.key === "Delete" || e.key === "Backspace") {
      const edge = flow.getEdges().find((x) => x.selected && x.id !== "__end");
      if (edge) {
        e.preventDefault();
        setSteps(disconnect(steps, edge.source, edge.target));
      } else if (selectedId) {
        e.preventDefault();
        remove(selectedId);
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (dirty) save.mutate();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- save / run -----------------------------------------------------------
  const save = useMutation({
    mutationFn: () => {
      const d = draft!;
      const firstStation = d.steps.find((s) => (s.type ?? "plan") === "plan" && !s.detached)?.station_uuid ?? d.station_uuid;
      return proceduresApi.update(procedureId, { ...d, name: d.name.trim() || saved!.name, station_uuid: firstStation });
    },
    onSuccess: async (p) => {
      queryClient.setQueryData(["procedure", procedureId], p);
      setDraft(toDraft(p));
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
    },
  });
  const start = useMutation({
    mutationFn: (sample: SampleDraft) =>
      runsApi.create({
        procedure_uuid: procedureId,
        sample: {
          name: sample.name || undefined,
          substance: sample.substance || undefined,
          amount_value: sample.amount_value === "" ? undefined : Number(sample.amount_value),
          amount_unit: sample.amount_unit || undefined,
          description: sample.description || undefined,
        },
      }),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate({ to: "/workflows/runs", search: { run: run.code } });
    },
  });

  async function prepareRun() {
    if (dirty) await save.mutateAsync();
    setPanel({ mode: "run" });
  }

  // ---- render ---------------------------------------------------------------
  if (procedure.isError) {
    return (
      <div className="screen__content">
        <Alert kind="error">This procedure doesn&apos;t exist (any more).</Alert>
        <p>
          <Button onClick={() => navigate({ to: "/workflows/procedures" })}>Back to procedures</Button>
        </p>
      </div>
    );
  }
  if (!draft || !saved) return <div className="screen__content muted">Loading…</div>;

  const selected = steps.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = selected && !selected.detached ? connectedSteps.indexOf(selected) : -1;
  const usedStations = [...new Set(connectedSteps.filter((s) => (s.type ?? "plan") === "plan").map((s) => s.station_uuid))]
    .map((id) => (id ? stationById.get(id)?.name : undefined))
    .filter(Boolean)
    .join(", ");
  const blocked =
    connectedSteps.length === 0
      ? "No step is connected to Start."
      : errors.length > 0
        ? `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix first — see Issues on the canvas.`
        : null;

  return (
    <>
      <header className="editor-bar">
        <button className="editor-bar__back" onClick={() => navigate({ to: "/workflows/procedures" })} title="All procedures">
          <Glyph name="back" size={16} />
        </button>
        <div className="editor-bar__title">
          <input
            className="editor-bar__name"
            value={draft.name}
            maxLength={50}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Procedure name"
          />
          <span className="editor-bar__state muted">
            v{saved.version} · {save.isPending ? "saving…" : dirty ? "unsaved changes" : "saved"}
          </span>
        </div>
        <button className="editor-bar__issues" onClick={() => setIssuesOpen((v) => !v)} title="Issues and compiled queue items">
          {steps.length === 0 ? null : validation.isFetching && !validation.data ? (
            <span className="muted">validating…</span>
          ) : errors.length ? (
            <StatusPill status={`${errors.length} error${errors.length === 1 ? "" : "s"}`} tone="error" />
          ) : warnings.length ? (
            <StatusPill status={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`} tone="warning" />
          ) : steps.length ? (
            <StatusPill status="valid" tone="ok" />
          ) : null}
        </button>
        <Button onClick={() => setPanel({ mode: "pick", after: chainEnd(steps) })}>
          <Glyph name="plus" size={12} /> Add step
        </Button>
        <Button onClick={() => setSteps(steps.map((s) => ({ ...s, position: null })))} disabled={!steps.some((s) => s.position)} title="Line the tiles up again">
          Tidy up
        </Button>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          Save
        </Button>
        <Button variant="primary" onClick={prepareRun} disabled={steps.length === 0 || save.isPending}>
          <Glyph name="play" size={12} /> Run
        </Button>
      </header>

      <div className="screen">
        <div className={panel ? "designer designer--inspecting" : "designer"}>
          {save.isError && <Alert kind="error">{(save.error as Error).message}</Alert>}
          <div
            className="designer__canvas"
            data-inspects
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={onDrop}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={(changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n))}
              onNodeClick={(_, node) => node.type === "step" && setPanel({ mode: "step", id: node.id })}
              onNodeDragStop={(_, __, moved) => keepPositions(moved)}
              onPaneClick={() => panel?.mode === "step" && setPanel(null)}
              onConnect={(c: Connection) => wire(c.source, c.target)}
              onReconnect={(old: Edge, c: Connection) => {
                const cut = disconnect(steps, old.source, old.target);
                const next = c.source && c.target ? connect(cut, c.source, c.target) : null;
                if (next) setSteps(next);
                else setNotice("That link would make a loop — a procedure runs straight through.");
              }}
              isValidConnection={(c) => c.target !== START && c.target !== "__add" && c.source !== "__add" && c.source !== c.target}
              connectionRadius={30}
              deleteKeyCode={null}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#DCDCDC" gap={22} />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>

            {notice && <div className="designer__notice">{notice}</div>}
            {steps.length > 0 && connectedSteps.length < steps.length && (
              <div className="designer__hint muted">Dashed tiles aren&apos;t connected and won&apos;t run — drag from a tile&apos;s right edge to the next one&apos;s left.</div>
            )}

            {issuesOpen && (
              <div className="issues">
                <div className="designer__tabs">
                  <button className={issuesTab === "issues" ? "designer__tab designer__tab--active" : "designer__tab"} onClick={() => setIssuesTab("issues")}>
                    Issues ({diagnostics.length})
                  </button>
                  <button className={issuesTab === "items" ? "designer__tab designer__tab--active" : "designer__tab"} onClick={() => setIssuesTab("items")}>
                    Queue items
                  </button>
                  <button className="issues__close" onClick={() => setIssuesOpen(false)} aria-label="Close">
                    ×
                  </button>
                </div>
                <div className="issues__body">
                  {issuesTab === "issues" ? (
                    diagnostics.length === 0 ? (
                      <p className="muted">{steps.length ? "Nothing to report — every step validates." : "Add a step to start."}</p>
                    ) : (
                      <ul className="diagnostics">
                        {diagnostics.map((d, i) => {
                          const index = connectedSteps.findIndex((s) => s.id === d.step_id);
                          const step = steps.find((s) => s.id === d.step_id);
                          return (
                            <li key={i}>
                              <button className="diagnostics__item" onClick={() => d.step_id && setPanel({ mode: "step", id: d.step_id })}>
                                <StatusPill status={d.severity} tone={d.severity === "error" ? "error" : "warning"} />
                                <span className="mono diagnostics__where">
                                  {step ? `${index >= 0 ? index + 1 : "loose"} ${titleOf(step)}` : "procedure"}
                                  {d.parameter ? ` · ${d.parameter}` : ""}
                                </span>
                                <span>{d.message}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  ) : (
                    <pre className="designer__items mono">{JSON.stringify(previewItems(connectedSteps.filter((s) => (s.type ?? "plan") === "plan"), procedureId, saved.version), null, 2)}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <Inspector
          open={panel !== null}
          kind="Step"
          heading={panel?.mode === "pick" ? "Add a step" : panel?.mode === "run" ? "Run" : "Step settings"}
          title={
            panel?.mode === "pick"
              ? panel.after === START
                ? "At the start"
                : `After ${titleOf(steps.find((s) => s.id === panel.after) ?? steps[0])}`
              : panel?.mode === "run"
                ? "Launch a run"
                : selected
                  ? titleOf(selected)
                  : ""
          }
          subtitle={
            selected && panel?.mode === "step"
              ? [
                  selected.detached ? "not connected" : `step ${selectedIndex + 1} of ${connectedSteps.length}`,
                  selected.station_uuid ? stationById.get(selected.station_uuid)?.name : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          onClose={() => setPanel(null)}
        >
          {panel?.mode === "pick" && <NodePicker stations={stations.data ?? []} palettes={palettes} onPick={(t) => add(t, panel.after)} />}
          {panel?.mode === "run" && (
            <RunLauncher
              procedure={saved}
              stations={usedStations}
              blocked={blocked}
              warnings={warnings.length}
              starting={start.isPending}
              error={start.error as Error | null}
              onStart={(sample) => start.mutate(sample)}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel?.mode === "step" && selected && (
            <StepSettings
              step={selected}
              palette={selected.station_uuid ? palettes.get(selected.station_uuid)?.data : undefined}
              diagnostics={diagnostics.filter((d) => d.step_id === selected.id)}
              refs={selected.detached ? [] : referencesBefore(connectedSteps, selectedIndex)}
              onChange={(step) => setSteps(steps.map((s) => (s.id === step.id ? step : s)))}
            />
          )}
        </Inspector>
      </div>
    </>
  );
}
