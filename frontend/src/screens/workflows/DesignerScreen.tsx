/**
 * The workflow designer (Roadmap 2.1/2.2, plan §9 and §10.4), n8n-style:
 * one procedure on a full-width canvas — Start, then a tile per step, an end
 * "+" — and a side panel that is either the node picker (stations with their
 * plans, flow-control steps) or the selected step's settings.
 *
 * - Plans come from each station pod's `plans_allowed` (§9.2); steps can use
 *   different stations, and Wait / Input / HTTP steps EPIChem runs itself.
 * - Validation runs server-side on every change and badges the tiles (§9.3);
 *   issues and the compiled queue items sit in a collapsible panel.
 * - The draft is local until Save — one save, one revision. Run saves first
 *   if needed. Pick a different procedure in Workflows → Procedures.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { NodePicker } from "./NodePicker";
import { describeStep, humanize, newControlStep, newId, newPlanStep, previewItems, referencesBefore } from "./plans";
import { RunLauncher, type SampleDraft } from "./RunLauncher";
import { StepSettings } from "./StepSettings";

import "./workflows.css";

const GAP = 180;

interface Draft {
  name: string;
  description: string | null;
  station_uuid: string | null;
  steps: ProcedureStep[];
}

type Panel = { mode: "pick"; at: number } | { mode: "step"; id: string } | { mode: "run" } | null;

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
      setPanel(procedure.data.steps.length ? null : { mode: "pick", at: 0 });
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

  function insert(step: ProcedureStep, at: number) {
    const next = [...steps];
    next.splice(at, 0, step);
    setSteps(next);
    setPanel({ mode: "step", id: step.id });
  }
  function move(id: string, by: number) {
    const from = steps.findIndex((s) => s.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(from, 1);
    next.splice(to, 0, step);
    setSteps(next);
  }
  function remove(id: string) {
    setSteps(steps.filter((s) => s.id !== id));
    setPanel(null);
  }

  // ---- canvas ---------------------------------------------------------------
  const titleOf = useCallback(
    (step: ProcedureStep) => step.label || ((step.type ?? "plan") === "plan" ? humanize(step.plan) : { wait: "Wait", input: "Input", http: "HTTP request" }[step.type as "wait"]),
    [],
  );
  const layout = useCallback((): Node[] => {
    const tiles: StepTileNode[] = steps.map((step, index) => {
      const station = step.station_uuid ? stationById.get(step.station_uuid) : undefined;
      const control = (step.type ?? "plan") !== "plan";
      return {
        id: step.id,
        type: "step",
        position: { x: (index + 1) * GAP, y: 0 },
        selected: step.id === selectedId,
        data: {
          index,
          glyph: control ? STEP_GLYPH[step.type as keyof typeof STEP_GLYPH] : stationGlyph(station),
          title: titleOf(step),
          subtitle: describeStep(step, station?.name),
          control,
          errors: diagnostics.filter((d) => d.step_id === step.id && d.severity === "error").length,
          warnings: diagnostics.filter((d) => d.step_id === step.id && d.severity === "warning").length,
        },
      };
    });
    return [
      { id: "__start", type: "start", position: { x: 0, y: 22 }, draggable: false, selectable: false, data: {} },
      ...tiles,
      {
        id: "__add",
        type: "add",
        position: { x: (steps.length + 1) * GAP, y: 22 },
        draggable: false,
        selectable: false,
        data: { onAdd: () => setPanel({ mode: "pick", at: steps.length }), empty: steps.length === 0 },
      },
    ];
  }, [steps, stationById, selectedId, diagnostics, titleOf]);

  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => setNodes(layout()), [layout]);

  const ids = ["__start", ...steps.map((s) => s.id), "__add"];
  const edges: PlusEdgeType[] = ids.slice(1).map((target, i) => ({
    id: `${ids[i]}->${target}`,
    source: ids[i],
    target,
    type: "plus",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#006C66" },
    data: target === "__add" ? {} : { onInsert: () => setPanel({ mode: "pick", at: i }) },
  }));

  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.12, maxZoom: 1, duration: 200 }), 40);
    return () => clearTimeout(t);
  }, [steps.length, procedureId, panel !== null, flow]);

  function reorderFromCanvas() {
    const order = nodes.filter((n) => n.type === "step").sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
    const byId = new Map(steps.map((s) => [s.id, s]));
    if (order.join() !== steps.map((s) => s.id).join()) setSteps(order.map((id) => byId.get(id)!));
    else setNodes(layout());
  }

  // ---- keyboard -------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
    if (e.key === "Escape") setPanel(null);
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      remove(selectedId);
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
      const firstStation = d.steps.find((s) => (s.type ?? "plan") === "plan")?.station_uuid ?? d.station_uuid;
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
  const selectedIndex = selected ? steps.indexOf(selected) : -1;
  const usedStations = [...new Set(steps.filter((s) => (s.type ?? "plan") === "plan").map((s) => s.station_uuid))]
    .map((id) => (id ? stationById.get(id)?.name : undefined))
    .filter(Boolean)
    .join(", ");
  const blocked =
    steps.length === 0
      ? "The procedure has no steps."
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
          <div className="designer__canvas" data-inspects>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={(changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n))}
              onNodeClick={(_, node) => node.type === "step" && setPanel({ mode: "step", id: node.id })}
              onNodeDragStop={reorderFromCanvas}
              onPaneClick={() => panel?.mode === "step" && setPanel(null)}
              nodesConnectable={false}
              deleteKeyCode={null}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#DCDCDC" gap={22} />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>

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
                          const index = steps.findIndex((s) => s.id === d.step_id);
                          return (
                            <li key={i}>
                              <button className="diagnostics__item" onClick={() => d.step_id && setPanel({ mode: "step", id: d.step_id })}>
                                <StatusPill status={d.severity} tone={d.severity === "error" ? "error" : "warning"} />
                                <span className="mono diagnostics__where">
                                  {index >= 0 ? `${index + 1} ${titleOf(steps[index])}` : "procedure"}
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
                    <pre className="designer__items mono">{JSON.stringify(previewItems(steps.filter((s) => (s.type ?? "plan") === "plan"), procedureId, saved.version), null, 2)}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <Inspector
          open={panel !== null}
          kind={panel?.mode === "pick" ? "Add step" : panel?.mode === "run" ? "Run" : "Step"}
          title={panel?.mode === "pick" ? `Step ${panel.at + 1}` : panel?.mode === "run" ? "Launch a run" : selected ? titleOf(selected) : ""}
          subtitle={selected && panel?.mode === "step" ? `step ${selectedIndex + 1} of ${steps.length}` : undefined}
          onClose={() => setPanel(null)}
        >
          {panel?.mode === "pick" && (
            <NodePicker
              stations={stations.data ?? []}
              palettes={palettes}
              onPlan={(plan, station) => insert(newPlanStep(plan, station.uuid), panel.at)}
              onControl={(type) => insert(newControlStep(type), panel.at)}
            />
          )}
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
            <>
              <div className="step-form__actions">
                <Button size="sm" onClick={() => move(selected.id, -1)} disabled={selectedIndex === 0}>
                  ← Earlier
                </Button>
                <Button size="sm" onClick={() => move(selected.id, 1)} disabled={selectedIndex === steps.length - 1}>
                  Later →
                </Button>
                <Button size="sm" onClick={() => insert({ ...selected, id: newId() }, selectedIndex + 1)}>
                  Duplicate
                </Button>
                <Button size="sm" variant="danger" onClick={() => remove(selected.id)}>
                  Remove
                </Button>
              </div>
              <StepSettings
                step={selected}
                stations={stations.data ?? []}
                palette={selected.station_uuid ? palettes.get(selected.station_uuid)?.data : undefined}
                diagnostics={diagnostics.filter((d) => d.step_id === selected.id)}
                refs={referencesBefore(steps, selectedIndex)}
                onChange={(step) => setSteps(steps.map((s) => (s.id === step.id ? step : s)))}
              />
            </>
          )}
        </Inspector>
      </div>
    </>
  );
}
