/**
 * Runs (Roadmap 2.2's dispatch layer, plan §13's Runs screen): every run —
 * procedures and the manual actions started from Device Monitoring — with its
 * live state, and per run its steps: plan steps as their stations report
 * them, flow-control steps as EPIChem carries them out. A run waiting at an
 * Input step is answered here. (Stations themselves are in Device Monitoring.)
 *
 * State is advanced by the backend's orchestrator; the table polls quickly
 * while anything is in flight and slowly otherwise.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { stationsApi } from "../../api/entities";
import { samplesApi } from "../../api/samples";
import type { InputField, Run, RunItem } from "../../api/types";
import { TERMINAL_RUN_STATES, runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { DataTable, type Columns } from "../../components/DataTable";
import { Glyph, STEP_GLYPH, stationGlyph } from "../../components/glyphs";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { QueryBoundary } from "../../components/QueryBoundary";
import { ScreenHeader } from "../../components/ScreenHeader";
import { StatusPill } from "../../components/StatusPill";
import { formatDateTime, formatDuration, formatTime, nameMap, secondsBetween } from "../format";

import "./workflows.css";

const isActive = (run: Run) => !TERMINAL_RUN_STATES.includes(run.state);

export function RunsScreen() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { run: selectedCode } = useSearch({ from: "/workflows/runs" });

  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: runsApi.list,
    refetchInterval: (query) => ((query.state.data ?? []).some(isActive) ? 2000 : 15000),
  });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const samples = useQuery({ queryKey: ["samples"], queryFn: samplesApi.list, refetchInterval: 5000 });

  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);
  const stationById = useMemo(() => new Map((stations.data ?? []).map((st) => [st.uuid, st])), [stations.data]);
  const sampleCodes = useMemo(
    () => new Map((samples.data ?? []).map((s) => [s.uuid, s.code])),
    [samples.data],
  );

  const select = (code: string | null) =>
    navigate({ to: "/workflows/runs", search: code ? { run: code } : {}, replace: true });
  const selected = runs.data?.find((r) => r.code === selectedCode) ?? null;

  const act = useMutation({
    mutationFn: ({ run, how }: { run: Run; how: "stop" | "abort" }) =>
      how === "stop" ? runsApi.stop(run.uuid) : runsApi.abort(run.uuid),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const columns: Columns<Run> = useMemo(
    () => [
      {
        accessorKey: "code",
        header: "Run",
        cell: (c) => (
          <button className="field__link mono" onClick={() => select(c.row.original.code)}>
            {c.row.original.code}
          </button>
        ),
      },
      {
        id: "procedure",
        header: "What",
        accessorFn: (r) => r.procedure_name,
        cell: (c) =>
          c.row.original.kind === "manual" ? (
            <span>
              <span className="mono">{c.row.original.procedure_name}</span> <span className="muted">manual</span>
            </span>
          ) : (
            <span className="table__name">
              {c.row.original.procedure_name} <span className="muted">v{c.row.original.procedure_version}</span>
            </span>
          ),
      },
      {
        id: "station",
        header: "Stations",
        accessorFn: (r) => stationsOf(r).map((id) => stationNames.get(id) ?? "").join(", "),
        cell: (c) => (
          <span className="run-stations">
            {stationsOf(c.row.original).map((id) => (
              <span key={id} title={stationNames.get(id)} className="run-stations__icon">
                <Glyph name={stationGlyph(stationById.get(id))} size={16} />
              </span>
            ))}
          </span>
        ),
      },
      { accessorKey: "state", header: "State", cell: (c) => <StatusPill status={c.row.original.state} /> },
      {
        id: "progress",
        header: "Steps",
        accessorFn: (r) => r.items.filter((i) => i.status === "completed").length,
        cell: (c) => (
          <span className="mono">
            {c.row.original.items.filter((i) => i.status === "completed").length}/{c.row.original.items.length}
          </span>
        ),
      },
      { id: "started", header: "Started", accessorFn: (r) => r.started_at ?? r.created_at, cell: (c) => formatDateTime(c.row.original.started_at ?? c.row.original.created_at) },
      {
        id: "duration",
        header: "Duration",
        accessorFn: (r) => secondsBetween(r.started_at, r.finished_at) ?? 0,
        cell: (c) => formatDuration(secondsBetween(c.row.original.started_at, c.row.original.finished_at)),
      },
      {
        id: "sample",
        header: "Sample",
        accessorFn: (r) => sampleCodes.get(r.sample_uuids[0]) ?? "",
        cell: (c) => {
          const code = sampleCodes.get(c.row.original.sample_uuids[0]);
          return code ? (
            <button className="field__link mono" onClick={() => navigate({ to: "/samples", search: { sample: code } })}>
              {code}
            </button>
          ) : (
            <span className="muted">—</span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stationNames, stationById, sampleCodes],
  );

  const active = (runs.data ?? []).filter(isActive).length;
  const waiting = (runs.data ?? []).filter((r) => r.state === "waiting");

  return (
    <>
      <ScreenHeader
        title="Runs"
        subtitle={runs.data ? `${runs.data.length} run${runs.data.length === 1 ? "" : "s"} · ${active} in flight` : "Loading…"}
        actions={<Button onClick={() => navigate({ to: "/workflows/procedures" })}>Procedures</Button>}
      />
      <div className="screen">
        <div className="screen__content" data-inspects>
          {waiting.map((r) => (
            <div key={r.uuid} className="waiting-banner">
              <Glyph name="input" size={18} />
              <span>
                <span className="mono">{r.code}</span> ({r.procedure_name}) is waiting for your input.
              </span>
              <Button size="sm" variant="primary" onClick={() => select(r.code)}>
                Answer
              </Button>
            </div>
          ))}

          <section className="section">
            <QueryBoundary query={runs}>
              {(rows) => (
                <DataTable
                  data={rows}
                  columns={columns}
                  empty="No runs yet — launch one from the workflow designer."
                />
              )}
            </QueryBoundary>
          </section>
        </div>

        <Inspector
          open={selected !== null}
          kind="Run"
          title={selected ? `${selected.code} — ${selected.procedure_name}` : undefined}
          subtitle={selected?.uuid}
          onClose={() => select(null)}
        >
          {selected && (
            <RunDetail
              run={selected}
              stationNames={stationNames}
              sampleCode={sampleCodes.get(selected.sample_uuids[0])}
              busy={act.isPending}
              error={act.error as Error | null}
              onStop={() => act.mutate({ run: selected, how: "stop" })}
              onAbort={() =>
                confirm(`Abort ${selected.code} now? The running step is interrupted.`) &&
                act.mutate({ run: selected, how: "abort" })
              }
              onSample={(code) => navigate({ to: "/samples", search: { sample: code } })}
            />
          )}
        </Inspector>
      </div>
    </>
  );
}

interface RunDetailProps {
  run: Run;
  stationNames: Map<string, string>;
  sampleCode: string | undefined;
  busy: boolean;
  error: Error | null;
  onStop: () => void;
  onAbort: () => void;
  onSample: (code: string) => void;
}

function RunDetail({ run, stationNames, sampleCode, busy, error, onStop, onAbort, onSample }: RunDetailProps) {
  const active = isActive(run);
  return (
    <>
      {active && (
        <div className="step-form__actions">
          <Button size="sm" onClick={onStop} disabled={busy} title="Take the remaining steps off the queue; the current one finishes">
            Stop after this step
          </Button>
          <Button size="sm" variant="danger" onClick={onAbort} disabled={busy}>
            Abort now
          </Button>
        </div>
      )}
      {run.error && <Alert kind="error">{run.error}</Alert>}
      {run.sync_error && <Alert kind="warning">{run.sync_error}</Alert>}
      {error && <Alert kind="error">{error.message}</Alert>}

      <FieldGroup title="Run">
        <Field label="State">
          <StatusPill status={run.state} />
        </Field>
        <Field label={run.kind === "manual" ? "Plan (manual)" : "Procedure"}>
          {run.kind === "manual" ? run.procedure_name : `${run.procedure_name} · v${run.procedure_version}`}
        </Field>
        <Field label="Stations">{stationsOf(run).map((id) => stationNames.get(id)).join(", ")}</Field>
        <Field label="Sample">
          {sampleCode && (
            <button className="field__link mono" onClick={() => onSample(sampleCode)}>
              {sampleCode}
            </button>
          )}
        </Field>
        <Field label="Queued">{formatDateTime(run.created_at)}</Field>
        <Field label="Started">{formatTime(run.started_at)}</Field>
        <Field label="Finished">{formatTime(run.finished_at)}</Field>
        <Field label="Duration">{formatDuration(secondsBetween(run.started_at, run.finished_at))}</Field>
      </FieldGroup>

      <FieldGroup title="Steps">
        <ol className="run-steps">
          {run.items.map((item, i) => (
            <li key={item.step_id ?? i} className="run-steps__item">
              <div className="run-steps__head">
                <span className="mono run-steps__index">{i + 1}</span>
                {item.type !== "plan" && <Glyph name={STEP_GLYPH[item.type as keyof typeof STEP_GLYPH]} size={14} />}
                <span className="run-steps__plan mono">{item.label || (item.type === "plan" ? item.plan : item.type)}</span>
                <StatusPill status={item.status === "waiting_input" ? "waiting" : item.status} tone={item.status === "waiting_input" ? "warning" : undefined} />
              </div>
              {item.type === "plan" && item.station_uuid && (
                <p className="run-steps__meta muted">on {stationNames.get(item.station_uuid) ?? "a deleted station"}</p>
              )}
              {item.status === "waiting_input" && <InputAnswer run={run} item={item} />}
              {item.type !== "input" && item.type !== "plan" && item.output && (
                <p className="run-steps__kwargs mono muted">→ {JSON.stringify(item.output).slice(0, 160)}</p>
              )}
              {item.type === "input" && item.status === "completed" && item.output && (
                <p className="run-steps__kwargs mono muted">
                  {Object.entries(item.output).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                </p>
              )}
              {item.type === "plan" && Object.keys(item.kwargs_sent ?? item.kwargs).length > 0 && (
                <p className="run-steps__kwargs mono muted">
                  {Object.entries(item.kwargs_sent ?? item.kwargs)
                    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                    .join(", ")}
                </p>
              )}
              {item.time_start && item.time_stop && (
                <p className="run-steps__meta muted">{formatDuration(item.time_stop - item.time_start)}</p>
              )}
              {item.run_uids.length > 0 && (
                <p className="run-steps__meta muted" title="Bluesky run uid(s) — the data lives with the station's document store">
                  bluesky run <span className="mono">{item.run_uids.map((u) => u.slice(0, 8)).join(", ")}</span>
                </p>
              )}
              {item.message && <p className="create__error run-steps__meta">{item.message.trim().split("\n").at(-1)}</p>}
            </li>
          ))}
        </ol>
      </FieldGroup>
    </>
  );
}

const stationsOf = (run: Run) => [
  ...new Set(run.items.map((i) => i.station_uuid).filter(Boolean).concat(run.station_uuid ? [run.station_uuid] : [])),
] as string[];

/** Answering an Input step: its prompt, its fields, Continue. */
function InputAnswer({ run, item }: { run: Run; item: RunItem }) {
  const queryClient = useQueryClient();
  const fields = (item.kwargs.fields as InputField[] | undefined) ?? [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const answer = useMutation({
    mutationFn: () => runsApi.answer(run.uuid, item.step_id, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });
  return (
    <div className="input-answer">
      <p className="input-answer__prompt">{String(item.kwargs.prompt ?? "")}</p>
      {fields.map((f) => (
        <label key={f.name} className="input-answer__field">
          <span className="label">
            {f.label || f.name}
            {f.required ? " *" : ""}
          </span>
          {f.type === "boolean" ? (
            <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} />
          ) : (
            <input
              className="field__input"
              type={f.type === "number" ? "number" : "text"}
              step="any"
              value={String(values[f.name] ?? "")}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <Button size="sm" variant="primary" onClick={() => answer.mutate()} disabled={answer.isPending}>
        {fields.length ? "Submit and continue" : "Confirm and continue"}
      </Button>
      {answer.isError && <p className="create__error">{(answer.error as Error).message}</p>}
    </div>
  );
}
