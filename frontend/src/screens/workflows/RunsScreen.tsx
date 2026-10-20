/**
 * Runs (Roadmap 2.2's dispatch layer, plan §13's Queue/Runs screens, first
 * cut): the executable stations and what their pods are doing, every run
 * with its live state, and per run its steps as the station reports them.
 *
 * State here is observed, never decided: each list read syncs unfinished
 * runs from their station's queue and history (backend `runs/api.py`), so
 * the table polls quickly while anything is in flight and slowly otherwise.
 */

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { stationsApi } from "../../api/entities";
import { samplesApi } from "../../api/samples";
import type { Run, Station } from "../../api/types";
import { TERMINAL_RUN_STATES, executionApi, runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { DataTable, type Columns } from "../../components/DataTable";
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
        header: "Procedure",
        accessorFn: (r) => r.procedure_name,
        cell: (c) => (
          <span className="table__name">
            {c.row.original.procedure_name} <span className="muted">v{c.row.original.procedure_version}</span>
          </span>
        ),
      },
      { id: "station", header: "Station", accessorFn: (r) => stationNames.get(r.station_uuid) ?? "" },
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
    [stationNames, sampleCodes],
  );

  const active = (runs.data ?? []).filter(isActive).length;

  return (
    <>
      <ScreenHeader
        title="Runs"
        subtitle={runs.data ? `${runs.data.length} run${runs.data.length === 1 ? "" : "s"} · ${active} in flight` : "Loading…"}
        actions={<Button onClick={() => navigate({ to: "/workflows/designer" })}>Designer</Button>}
      />
      <div className="screen">
        <div className="screen__content" data-inspects>
          <section className="section">
            <h3 className="section__title">Stations</h3>
            <StationCards stations={(stations.data ?? []).filter((s) => s.queueserver_url)} />
          </section>

          <section className="section">
            <h3 className="section__title">Runs</h3>
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
              stationName={stationNames.get(selected.station_uuid)}
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

/** One card per executable station: its pod's state and the two actions an operator needs. */
function StationCards({ stations }: { stations: Station[] }) {
  const queryClient = useQueryClient();
  const statuses = useQueries({
    queries: stations.map((s) => ({
      queryKey: ["execution", s.uuid],
      queryFn: () => executionApi.status(s.uuid),
      refetchInterval: 4000,
    })),
  });
  const act = useMutation({
    mutationFn: ({ station, how }: { station: string; how: "open" | "start" }) =>
      how === "open" ? executionApi.openEnvironment(station) : executionApi.startQueue(station),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["execution"] }),
  });

  if (stations.length === 0) {
    return (
      <Alert kind="info">
        No executable station yet. In Device Management, give a station a queueserver URL — with{" "}
        <span className="mono">docker compose up</span>, <span className="mono">http://station-spinbot:60610</span> and{" "}
        <span className="mono">http://station-synthesis:60610</span> are running.
      </Alert>
    );
  }

  return (
    <div className="station-cards">
      {stations.map((station, i) => {
        const s = statuses[i]?.data;
        const st = s?.status;
        return (
          <div key={station.uuid} className="station-card">
            <div className="station-card__top">
              <span className="station-card__name">{station.name}</span>
              {!s ? (
                <span className="muted">…</span>
              ) : !s.reachable || !st ? (
                <span title={s.error ?? undefined}>
                  <StatusPill status="unreachable" />
                </span>
              ) : (
                <StatusPill status={st.worker_environment_exists ? st.manager_state : "closed"} />
              )}
            </div>
            <p className="station-card__url mono muted">{station.queueserver_url}</p>
            {st && (
              <p className="station-card__line">
                {st.items_in_queue} queued · {st.items_in_history} done
                {st.re_state && st.re_state !== "idle" ? ` · engine ${st.re_state}` : ""}
              </p>
            )}
            {s && !s.reachable && <p className="station-card__line create__error">{s.error}</p>}
            {st && (
              <div className="station-card__actions">
                {!st.worker_environment_exists && (
                  <Button size="sm" onClick={() => act.mutate({ station: station.uuid, how: "open" })}>
                    Open environment
                  </Button>
                )}
                {st.worker_environment_exists && st.manager_state === "idle" && st.items_in_queue > 0 && (
                  <Button size="sm" onClick={() => act.mutate({ station: station.uuid, how: "start" })}>
                    Start queue
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RunDetailProps {
  run: Run;
  stationName: string | undefined;
  sampleCode: string | undefined;
  busy: boolean;
  error: Error | null;
  onStop: () => void;
  onAbort: () => void;
  onSample: (code: string) => void;
}

function RunDetail({ run, stationName, sampleCode, busy, error, onStop, onAbort, onSample }: RunDetailProps) {
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
        <Field label="Procedure">{`${run.procedure_name} · v${run.procedure_version}`}</Field>
        <Field label="Station">{stationName}</Field>
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
            <li key={item.item_uid ?? i} className="run-steps__item">
              <div className="run-steps__head">
                <span className="mono run-steps__index">{i + 1}</span>
                <span className="run-steps__plan mono">{item.plan}</span>
                <StatusPill status={item.status} />
              </div>
              {Object.keys(item.kwargs).length > 0 && (
                <p className="run-steps__kwargs mono muted">
                  {Object.entries(item.kwargs)
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
