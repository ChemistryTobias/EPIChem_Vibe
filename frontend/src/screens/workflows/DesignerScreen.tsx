/**
 * Workflow designer (Roadmap 2.1/2.2, plan §9 and §10.4): compose a station's
 * Bluesky plans into a procedure, see it validated live, and launch it.
 *
 * - The palette and every parameter form are generated from the station
 *   pod's `plans_allowed`/`devices_allowed` (§9.2) — nothing per-plan lives
 *   in this codebase.
 * - A procedure is a linear sequence (§9.1's fast path): the canvas lays
 *   steps out left to right, and dragging a node sideways reorders it.
 * - Validation runs server-side against the live pod on every change and
 *   comes back keyed to step ids (§9.3); the canvas badges the nodes.
 * - The draft is local until Save, like the layout editor's: one save, one
 *   revision. Run saves first if needed, then dispatches.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { stationsApi } from "../../api/entities";
import type { Diagnostic, Procedure, ProcedureStep, Station } from "../../api/types";
import { executionApi, proceduresApi, runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { ScreenHeader } from "../../components/ScreenHeader";
import { StatusPill } from "../../components/StatusPill";
import { PLAN_MIME, PlanPalette } from "./PlanPalette";
import { groupPlans, newStep, previewItems } from "./plans";
import { RunLauncher, type SampleDraft } from "./RunLauncher";
import { StepForm } from "./StepForm";
import { StepNode, type StepNodeType } from "./StepNode";

import "./workflows.css";

const NODE_W = 220;
const GAP = 60;
const nodeTypes = { step: StepNode };

interface Draft {
  name: string;
  description: string | null;
  station_uuid: string | null;
  steps: ProcedureStep[];
}

const toDraft = (p: Procedure): Draft => ({
  name: p.name,
  description: p.description,
  station_uuid: p.station_uuid,
  steps: p.steps.map(({ id, plan, kwargs, label }) => ({ id, plan, kwargs, label: label ?? null })),
});

export function DesignerScreen() {
  return (
    <ReactFlowProvider>
      <Designer />
    </ReactFlowProvider>
  );
}

function Designer() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const flow = useReactFlow();

  const procedures = useQuery({ queryKey: ["procedures"], queryFn: proceduresApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const executable = (stations.data ?? []).filter((s) => s.queueserver_url);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", description: null, station_uuid: null, steps: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [tab, setTab] = useState<"diagnostics" | "items">("diagnostics");
  const initialised = useRef(false);

  const saved = procedures.data?.find((p) => p.uuid === currentId) ?? null;
  const baseline: Draft = saved ? toDraft(saved) : { name: "", description: null, station_uuid: draft.station_uuid, steps: [] };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) && (saved !== null || draft.steps.length > 0 || draft.name !== "");
  const station: Station | undefined = stations.data?.find((s) => s.uuid === draft.station_uuid);

  /** Open the first procedure, or a blank one on the first executable station. */
  useEffect(() => {
    if (initialised.current || !procedures.data || !stations.data) return;
    initialised.current = true;
    const first = procedures.data[0];
    if (first) open(first);
    else setDraft((d) => ({ ...d, station_uuid: executable[0]?.uuid ?? null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedures.data, stations.data]);

  function open(p: Procedure | null) {
    setCurrentId(p?.uuid ?? null);
    setDraft(p ? toDraft(p) : { name: "", description: null, station_uuid: executable[0]?.uuid ?? null, steps: [] });
    setSelected(null);
    setLaunching(false);
  }

  function switchTo(id: string) {
    if (dirty && !confirm("Discard the unsaved changes to this procedure?")) return;
    open(id === "" ? null : (procedures.data?.find((p) => p.uuid === id) ?? null));
  }

  // ---- what the station offers, and what validation says ------------------
  const palette = useQuery({
    queryKey: ["palette", draft.station_uuid],
    queryFn: () => executionApi.palette(draft.station_uuid!),
    enabled: Boolean(station?.queueserver_url),
    retry: false,
  });
  const register = useMutation({
    mutationFn: () => executionApi.registerDevices(draft.station_uuid!),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const pending = useDeferredValue(JSON.stringify({ s: draft.station_uuid, steps: draft.steps }));
  const validation = useQuery({
    queryKey: ["validate", pending],
    queryFn: () => {
      const { s, steps } = JSON.parse(pending);
      return proceduresApi.validate(s, steps);
    },
    enabled: draft.station_uuid !== null,
    placeholderData: (previous) => previous,
    retry: false,
  });
  // Memoised: a fresh `[]` per render would re-run the node layout effect below forever.
  const diagnostics: Diagnostic[] = useMemo(() => validation.data?.diagnostics ?? [], [validation.data]);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  const groupLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groupPlans(palette.data?.plans ?? {})) for (const p of g.plans) map.set(p.name, g.label);
    return map;
  }, [palette.data]);

  // ---- the canvas -----------------------------------------------------------
  const layoutNodes = useCallback(
    (): StepNodeType[] =>
      draft.steps.map((step, index) => ({
        id: step.id,
        type: "step",
        position: { x: index * (NODE_W + GAP), y: 0 },
        selected: step.id === selected,
        data: {
          step,
          index,
          group: groupLabel.get(step.plan) ?? "",
          unknown: Boolean(palette.data) && !palette.data!.plans[step.plan],
          errors: diagnostics.filter((d) => d.step_id === step.id && d.severity === "error").length,
          warnings: diagnostics.filter((d) => d.step_id === step.id && d.severity === "warning").length,
        },
      })),
    [draft.steps, selected, groupLabel, palette.data, diagnostics],
  );
  const [nodes, setNodes] = useState<StepNodeType[]>([]);
  useEffect(() => setNodes(layoutNodes()), [layoutNodes]);

  const edges: Edge[] = draft.steps.slice(1).map((step, i) => ({
    id: `${draft.steps[i].id}->${step.id}`,
    source: draft.steps[i].id,
    target: step.id,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#006C66" },
  }));

  // Refit when the sequence grows or shrinks, not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1.1, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [draft.steps.length, currentId, flow, launching || selected !== null]);

  const setSteps = (steps: ProcedureStep[]) => setDraft((d) => ({ ...d, steps }));

  function insert(step: ProcedureStep, at?: number) {
    const index = at ?? (selected ? draft.steps.findIndex((s) => s.id === selected) + 1 : draft.steps.length);
    const steps = [...draft.steps];
    steps.splice(index, 0, step);
    setSteps(steps);
    setSelected(step.id);
    setLaunching(false);
  }

  function move(id: string, by: number) {
    const from = draft.steps.findIndex((s) => s.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= draft.steps.length) return;
    const steps = [...draft.steps];
    const [step] = steps.splice(from, 1);
    steps.splice(to, 0, step);
    setSteps(steps);
  }

  function removeStep(id: string) {
    setSteps(draft.steps.filter((s) => s.id !== id));
    setSelected(null);
  }

  /** Dropped sideways: the new order is the nodes' left-to-right order. */
  function reorderFromCanvas() {
    const order = [...nodes].sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
    const byId = new Map(draft.steps.map((s) => [s.id, s]));
    const steps = order.map((id) => byId.get(id)!).filter(Boolean);
    if (steps.map((s) => s.id).join() !== draft.steps.map((s) => s.id).join()) setSteps(steps);
    else setNodes(layoutNodes()); // snap back into line
  }

  function onDrop(event: React.DragEvent) {
    const name = event.dataTransfer.getData(PLAN_MIME);
    const plan = palette.data?.plans[name];
    if (!plan) return;
    event.preventDefault();
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const index = draft.steps.filter((_, i) => i * (NODE_W + GAP) + NODE_W / 2 < at.x).length;
    insert(newStep(plan), index);
  }

  // ---- keyboard: Delete removes the selected step ---------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
    if (e.key === "Escape") setSelected(null);
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      removeStep(selected);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- save / delete / run --------------------------------------------------
  const save = useMutation({
    mutationFn: async (): Promise<Procedure> => {
      const body = { ...draft, name: draft.name.trim() };
      return currentId ? proceduresApi.update(currentId, body) : proceduresApi.create(body);
    },
    onSuccess: async (procedure) => {
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      setCurrentId(procedure.uuid);
      setDraft(toDraft(procedure));
    },
  });

  const remove = useMutation({
    mutationFn: () => proceduresApi.remove(currentId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      open(null);
    },
  });

  const start = useMutation({
    mutationFn: (sample: SampleDraft) =>
      runsApi.create({
        procedure_uuid: currentId!,
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
    if (dirty || !currentId) {
      if (!draft.name.trim()) return alert("Give the procedure a name first.");
      await save.mutateAsync();
    }
    setSelected(null);
    setLaunching(true);
  }

  const canSave = draft.name.trim() !== "" && (dirty || !currentId) && !save.isPending;
  const selectedStep = draft.steps.find((s) => s.id === selected) ?? null;
  const blocked = !station?.queueserver_url
    ? "The procedure's station isn't executable."
    : errors.length > 0
      ? `${errors.length} error${errors.length === 1 ? "" : "s"} to fix first — see the diagnostics under the canvas.`
      : draft.steps.length === 0
        ? "The procedure has no steps."
        : null;

  return (
    <>
      <ScreenHeader
        title="Workflow designer"
        subtitle={
          saved
            ? `${saved.name} · v${saved.version}${dirty ? " · unsaved changes" : ""}`
            : draft.name
              ? `${draft.name} · new`
              : "A new procedure"
        }
        actions={
          <>
            <Button onClick={() => switchTo("")}>New</Button>
            <Button onClick={() => save.mutate()} disabled={!canSave}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="primary" onClick={prepareRun} disabled={draft.steps.length === 0 || save.isPending}>
              Run
            </Button>
          </>
        }
      />

      <div className="screen">
        <div className={launching || selectedStep ? "designer designer--inspecting" : "designer"}>
          <aside className="designer__palette" data-inspects>
            <div className="designer__station">
              <p className="label">Station</p>
              <select
                className="field__input"
                value={draft.station_uuid ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, station_uuid: e.target.value || null }))}
              >
                <option value="">Choose…</option>
                {(stations.data ?? []).map((s) => (
                  <option key={s.uuid} value={s.uuid} disabled={!s.queueserver_url}>
                    {s.name}
                    {s.queueserver_url ? "" : " (no queueserver)"}
                  </option>
                ))}
              </select>
              {stations.data && executable.length === 0 && (
                <p className="muted step-form__hint">
                  No station is executable yet. Give one a queueserver URL in Device Management — e.g.{" "}
                  <span className="mono">http://station-spinbot:60610</span>.
                </p>
              )}
            </div>
            <PlanPalette
              palette={palette.data}
              loading={palette.isFetching && !palette.data}
              error={palette.error as Error | null}
              onAdd={(plan) => insert(newStep(plan))}
              onRegister={() => register.mutate()}
              registering={register.isPending}
            />
          </aside>

          <section className="designer__main">
            <div className="designer__bar">
              <label className="designer__field">
                <span className="label">Procedure</span>
                <select className="field__input" value={currentId ?? ""} onChange={(e) => switchTo(e.target.value)}>
                  <option value="">— new procedure —</option>
                  {(procedures.data ?? []).map((p) => (
                    <option key={p.uuid} value={p.uuid}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="designer__field designer__field--grow">
                <span className="label">Name</span>
                <input
                  className="field__input"
                  value={draft.name}
                  placeholder="Name this procedure"
                  maxLength={50}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <div className="designer__validity">
                {validation.isFetching && !validation.data ? (
                  <span className="muted">validating…</span>
                ) : draft.station_uuid === null ? null : errors.length > 0 ? (
                  <StatusPill status={`${errors.length} error${errors.length === 1 ? "" : "s"}`} tone="error" />
                ) : warnings.length > 0 ? (
                  <StatusPill status={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`} tone="warning" />
                ) : draft.steps.length > 0 ? (
                  <StatusPill status="valid" tone="ok" />
                ) : null}
              </div>
              {currentId && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => confirm(`Delete procedure "${saved?.name}"?`) && remove.mutate()}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              )}
            </div>

            {save.isError && <Alert kind="error">{(save.error as Error).message}</Alert>}
            {remove.isError && <Alert kind="error">{(remove.error as Error).message}</Alert>}
            {validation.isError && <Alert kind="error">Validation: {(validation.error as Error).message}</Alert>}

            <div className="designer__canvas" data-inspects onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              {draft.steps.length === 0 && (
                <div className="designer__empty">
                  <p className="label">An empty procedure</p>
                  <p className="muted">
                    Click a plan in the palette, or drag one here. Steps run left to right; drag a step sideways to
                    reorder it.
                  </p>
                </div>
              )}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={(changes: NodeChange<StepNodeType>[]) => setNodes((n) => applyNodeChanges(changes, n))}
                onNodeClick={(_, node) => {
                  setSelected(node.id);
                  setLaunching(false);
                }}
                onNodeDragStop={reorderFromCanvas}
                onPaneClick={() => setSelected(null)}
                nodesConnectable={false}
                deleteKeyCode={null}
                minZoom={0.2}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#DCDCDC" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            <div className="designer__drawer" data-inspects>
              <div className="designer__tabs">
                <button
                  className={tab === "diagnostics" ? "designer__tab designer__tab--active" : "designer__tab"}
                  onClick={() => setTab("diagnostics")}
                >
                  Diagnostics ({diagnostics.length})
                </button>
                <button
                  className={tab === "items" ? "designer__tab designer__tab--active" : "designer__tab"}
                  onClick={() => setTab("items")}
                >
                  Queue items
                </button>
              </div>
              <div className="designer__drawer-body">
                {tab === "diagnostics" ? (
                  diagnostics.length === 0 ? (
                    <p className="muted">
                      {draft.station_uuid === null
                        ? "Choose a station to validate against."
                        : draft.steps.length
                          ? "Nothing to report — every step validates against the station's plans."
                          : "Add a step to start."}
                    </p>
                  ) : (
                    <ul className="diagnostics">
                      {diagnostics.map((d, i) => {
                        const index = draft.steps.findIndex((s) => s.id === d.step_id);
                        return (
                          <li key={i}>
                            <button className="diagnostics__item" onClick={() => d.step_id && setSelected(d.step_id)}>
                              <StatusPill status={d.severity} tone={d.severity === "error" ? "error" : "warning"} />
                              <span className="mono diagnostics__where">
                                {index >= 0 ? `${index + 1} ${draft.steps[index].plan}` : "procedure"}
                                {d.parameter ? `.${d.parameter}` : ""}
                              </span>
                              <span>{d.message}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <pre className="designer__items mono">
                    {JSON.stringify(previewItems(draft.steps, currentId, saved?.version ?? 1), null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </section>
        </div>

        <Inspector
          open={launching || selectedStep !== null}
          kind={launching ? "Run" : "Step"}
          title={launching ? "Launch a run" : (selectedStep?.label ?? selectedStep?.plan)}
          subtitle={launching ? undefined : selectedStep ? `step ${draft.steps.indexOf(selectedStep) + 1} of ${draft.steps.length}` : undefined}
          onClose={() => {
            setLaunching(false);
            setSelected(null);
          }}
        >
          {launching && saved ? (
            <RunLauncher
              procedure={saved}
              station={station}
              blocked={blocked}
              warnings={warnings.length}
              starting={start.isPending}
              error={start.error as Error | null}
              onStart={(sample) => start.mutate(sample)}
              onCancel={() => setLaunching(false)}
            />
          ) : selectedStep ? (
            <>
              <div className="step-form__actions">
                <Button size="sm" onClick={() => move(selectedStep.id, -1)} disabled={draft.steps[0] === selectedStep}>
                  ← Earlier
                </Button>
                <Button size="sm" onClick={() => move(selectedStep.id, 1)} disabled={draft.steps.at(-1) === selectedStep}>
                  Later →
                </Button>
                <Button
                  size="sm"
                  onClick={() => insert({ ...selectedStep, id: newStep({ name: selectedStep.plan, parameters: [] }).id })}
                >
                  Duplicate
                </Button>
                <Button size="sm" variant="danger" onClick={() => removeStep(selectedStep.id)}>
                  Remove
                </Button>
              </div>
              <StepForm
                step={selectedStep}
                plan={palette.data?.plans[selectedStep.plan]}
                diagnostics={diagnostics.filter((d) => d.step_id === selectedStep.id)}
                registered={palette.data?.registered ?? []}
                onChange={(step) => setSteps(draft.steps.map((s) => (s.id === step.id ? step : s)))}
              />
            </>
          ) : null}
        </Inspector>
      </div>
    </>
  );
}
