/**
 * Sample tracking (Roadmap 3, plan §7.3) — the minimal, run-linked version.
 *
 * Every workflow run registers the sample it produces; samples can also be
 * registered by hand. A sample's state and location are never typed in —
 * they move only through lifecycle events (registered → staged → reserved →
 * in process → processed → characterized → archived, with quarantine from
 * anywhere live), so the timeline in the inspector is the sample's whole
 * story: who moved it, where, when, and which run did.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { apiGet } from "../../api/client";
import { stationsApi } from "../../api/entities";
import { SAMPLE_STATES, TRANSITIONS, samplesApi, type SampleFields } from "../../api/samples";
import type { Sample, SampleDetail, SampleState } from "../../api/types";
import { runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { DataTable, type Columns } from "../../components/DataTable";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { SearchBox } from "../../components/SearchBox";
import { QueryBoundary } from "../../components/QueryBoundary";
import { ScreenHeader } from "../../components/ScreenHeader";
import { StatusPill } from "../../components/StatusPill";
import { formatDate, formatDateTime, matchesQuery, nameMap, orDash } from "../format";

import "./samples.css";

const amountOf = (s: Sample) =>
  s.amount_value === null ? null : `${s.amount_value}${s.amount_unit ? ` ${s.amount_unit}` : ""}`;

export function SamplesScreen() {
  const navigate = useNavigate();
  const { sample: selectedCode } = useSearch({ from: "/samples" });
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SampleState | "all">("all");
  const [creating, setCreating] = useState(false);

  const samples = useQuery({ queryKey: ["samples"], queryFn: samplesApi.list, refetchInterval: 5000 });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const runs = useQuery({ queryKey: ["runs"], queryFn: runsApi.list });
  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);
  const runCodes = useMemo(() => new Map((runs.data ?? []).map((r) => [r.uuid, r.code])), [runs.data]);

  const select = (code: string | null) => {
    setCreating(false);
    navigate({ to: "/samples", search: code ? { sample: code } : {}, replace: true });
  };

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of samples.data ?? []) c.set(s.state, (c.get(s.state) ?? 0) + 1);
    return c;
  }, [samples.data]);

  const rows = (samples.data ?? []).filter(
    (s) => (state === "all" || s.state === state) && matchesQuery(query, s.code, s.name, s.substance),
  );

  const columns: Columns<Sample> = useMemo(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: (c) => (
          <button className="field__link mono" onClick={() => select(c.row.original.code)}>
            {c.row.original.code}
          </button>
        ),
      },
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      { accessorKey: "state", header: "State", cell: (c) => <StatusPill status={c.row.original.state} /> },
      { accessorKey: "substance", header: "Substance", cell: (c) => <span className="mono">{orDash(c.row.original.substance)}</span> },
      { id: "amount", header: "Amount", accessorFn: (s) => s.amount_value ?? -1, cell: (c) => <span className="mono">{orDash(amountOf(c.row.original))}</span> },
      { id: "station", header: "Location", accessorFn: (s) => stationNames.get(s.station_uuid ?? "") ?? "", cell: (c) => orDash(stationNames.get(c.row.original.station_uuid ?? "")) },
      {
        id: "run",
        header: "Run",
        accessorFn: (s) => runCodes.get(s.run_uuid ?? "") ?? "",
        cell: (c) => {
          const code = runCodes.get(c.row.original.run_uuid ?? "");
          return code ? (
            <button className="field__link mono" onClick={() => navigate({ to: "/workflows/runs", search: { run: code } })}>
              {code}
            </button>
          ) : (
            <span className="muted">by hand</span>
          );
        },
      },
      { id: "updated", header: "Updated", accessorFn: (s) => s.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stationNames, runCodes],
  );

  return (
    <>
      <ScreenHeader
        title="Samples"
        subtitle={samples.data ? `${samples.data.length} sample${samples.data.length === 1 ? "" : "s"} tracked` : "Loading…"}
        actions={
          <Button variant="primary" onClick={() => { select(null); setCreating(true); }}>
            Register sample
          </Button>
        }
      />

      <div className="screen">
        <div className="screen__content" data-inspects>
          <div className="samples__filters">
            <SearchBox className="samples__search" value={query} onChange={setQuery} placeholder="Search code, name, substance" />
            <div className="samples__chips">
              <button className={state === "all" ? "chip chip--active" : "chip"} onClick={() => setState("all")}>
                all <span className="chip__count">{samples.data?.length ?? 0}</span>
              </button>
              {SAMPLE_STATES.filter((s) => counts.has(s)).map((s) => (
                <button key={s} className={state === s ? "chip chip--active" : "chip"} onClick={() => setState(s)}>
                  {s.replace("_", " ")} <span className="chip__count">{counts.get(s)}</span>
                </button>
              ))}
            </div>
          </div>

          <QueryBoundary query={samples}>
            {() => (
              <DataTable
                data={rows}
                columns={columns}
                empty={samples.data?.length ? "No sample matches." : "No samples yet — every workflow run registers one, or register one by hand."}
              />
            )}
          </QueryBoundary>
        </div>

        <SampleInspector
          code={creating ? null : (selectedCode ?? null)}
          creating={creating}
          stationNames={stationNames}
          runCodes={runCodes}
          onClose={() => select(null)}
          onCreated={(code) => select(code)}
          onRun={(code) => navigate({ to: "/workflows/runs", search: { run: code } })}
        />
      </div>
    </>
  );
}

interface SampleInspectorProps {
  code: string | null;
  creating: boolean;
  stationNames: Map<string, string>;
  runCodes: Map<string, string>;
  onClose: () => void;
  onCreated: (code: string) => void;
  onRun: (code: string) => void;
}

function SampleInspector({ code, creating, stationNames, runCodes, onClose, onCreated, onRun }: SampleInspectorProps) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["sample", code],
    queryFn: () => samplesApi.get(code!),
    enabled: code !== null,
    refetchInterval: 5000,
  });
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<{ uuid: string; name: string }[]>("/users?limit=500") });
  const userNames = useMemo(() => nameMap(users.data), [users.data]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SampleFields & { station_uuid?: string | null }>({});

  const invalidate = () => queryClient.invalidateQueries({ predicate: (q) => ["samples", "sample", "runs"].includes(q.queryKey[0] as string) });

  const create = useMutation({
    mutationFn: () => samplesApi.create({ ...draft, name: draft.name ?? "" }),
    onSuccess: async (sample) => {
      setDraft({});
      await invalidate();
      onCreated(sample.code);
    },
  });
  const save = useMutation({
    mutationFn: () => samplesApi.update(code!, draft),
    onSuccess: async () => {
      setDraft({});
      setEditing(false);
      await invalidate();
    },
  });

  const open = creating || code !== null;
  const sample = detail.data;
  const dirty = Object.keys(draft).length > 0;

  const leave = () => {
    setDraft({});
    setEditing(false);
  };

  return (
    <Inspector
      open={open}
      kind="Sample"
      title={creating ? (draft.name ?? "") : editing ? (draft.name ?? sample?.name) : sample ? `${sample.code} — ${sample.name}` : code ?? ""}
      subtitle={creating ? undefined : sample?.uuid}
      onClose={() => {
        leave();
        onClose();
      }}
      edit={
        creating
          ? {
              editing: true,
              creating: true,
              dirty: Boolean(draft.name?.trim()),
              saving: create.isPending,
              onToggle: onClose,
              onSave: () => create.mutate(),
              onCancel: () => {
                leave();
                onClose();
              },
              onRename: (name) => setDraft((d) => ({ ...d, name })),
            }
          : sample
            ? {
                editing,
                dirty,
                saving: save.isPending,
                onToggle: () => (editing ? leave() : setEditing(true)),
                onSave: () => save.mutate(),
                onCancel: leave,
                onRename: (name) => setDraft((d) => ({ ...d, name })),
              }
            : undefined
      }
    >
      {creating ? (
        <>
          <SampleFieldsForm draft={draft} setDraft={setDraft} source={null} stationNames={stationNames} withStation />
          {create.isError && <p className="create__error">{(create.error as Error).message}</p>}
        </>
      ) : detail.isError ? (
        <Alert kind="error">{(detail.error as Error).message}</Alert>
      ) : !sample ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {editing ? (
            <>
              <SampleFieldsForm draft={draft} setDraft={setDraft} source={sample} stationNames={stationNames} />
              {save.isError && <p className="create__error">{(save.error as Error).message}</p>}
            </>
          ) : (
            <FieldGroup title="Sample">
              <Field label="State">
                <StatusPill status={sample.state} />
              </Field>
              <Field label="Substance">{sample.substance}</Field>
              <Field label="Amount">{amountOf(sample)}</Field>
              <Field label="Location">{stationNames.get(sample.station_uuid ?? "")}</Field>
              <Field label="Description">{sample.description}</Field>
              <Field label="Notes">{sample.notes}</Field>
              <Field label="Owner">{userNames.get(sample.owner_uuid ?? "")}</Field>
              <Field label="Produced by">
                {sample.run_uuid && runCodes.get(sample.run_uuid) ? (
                  <button className="field__link mono" onClick={() => onRun(runCodes.get(sample.run_uuid!)!)}>
                    {runCodes.get(sample.run_uuid)}
                  </button>
                ) : sample.run_uuid ? (
                  <span className="mono">{sample.run_uuid}</span>
                ) : (
                  "registered by hand"
                )}
              </Field>
            </FieldGroup>
          )}

          {!editing && <Lifecycle sample={sample} stationNames={stationNames} onDone={invalidate} />}

          {!editing && sample.parameters && (
            <FieldGroup title="Run parameters">
              <pre className="samples__params mono">{JSON.stringify(sample.parameters, null, 2)}</pre>
            </FieldGroup>
          )}

          {!editing && (
            <FieldGroup title="History">
              <ol className="timeline">
                {[...sample.events].reverse().map((event) => (
                  <li key={event.uuid} className="timeline__item">
                    <div className="timeline__head">
                      <StatusPill status={event.to_state} />
                      <span className="muted timeline__at">{formatDateTime(event.at)}</span>
                    </div>
                    <p className="timeline__line">
                      {event.from_state ? `${event.from_state.replace("_", " ")} → ${event.to_state.replace("_", " ")}` : "registered"}
                      {event.station_uuid && ` · at ${stationNames.get(event.station_uuid) ?? "a deleted station"}`}
                      {event.actor_uuid && ` · ${userNames.get(event.actor_uuid) ?? "someone"}`}
                      {event.run_uuid && runCodes.get(event.run_uuid) && (
                        <>
                          {" · "}
                          <button className="field__link mono" onClick={() => onRun(runCodes.get(event.run_uuid!)!)}>
                            {runCodes.get(event.run_uuid)}
                          </button>
                        </>
                      )}
                    </p>
                    {event.reason && <p className="timeline__reason">{event.reason}</p>}
                  </li>
                ))}
              </ol>
            </FieldGroup>
          )}
        </>
      )}
    </Inspector>
  );
}

function SampleFieldsForm({
  draft,
  setDraft,
  source,
  stationNames,
  withStation = false,
}: {
  draft: SampleFields & { station_uuid?: string | null };
  setDraft: (update: (d: SampleFields & { station_uuid?: string | null }) => SampleFields & { station_uuid?: string | null }) => void;
  source: SampleDetail | null;
  stationNames: Map<string, string>;
  withStation?: boolean;
}) {
  const value = (key: keyof SampleFields) => {
    const v = key in draft ? draft[key] : source?.[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const text = (key: keyof SampleFields, label: string, placeholder?: string) => (
    <Field label={label}>
      <input
        className="field__input"
        value={value(key)}
        placeholder={placeholder}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value === "" ? null : e.target.value }))}
      />
    </Field>
  );
  return (
    <>
      {text("substance", "Substance", "e.g. PEDOT:PSS or an InChIKey")}
      <Field label="Amount">
        <div className="field__triple">
          <input
            className="field__input mono"
            type="number"
            min={0}
            step="any"
            value={value("amount_value")}
            onChange={(e) => setDraft((d) => ({ ...d, amount_value: e.target.value === "" ? null : Number(e.target.value) }))}
          />
          <input
            className="field__input"
            placeholder="unit"
            value={value("amount_unit")}
            onChange={(e) => setDraft((d) => ({ ...d, amount_unit: e.target.value || null }))}
          />
        </div>
      </Field>
      {withStation && (
        <Field label="Location">
          <select
            className="field__input"
            value={draft.station_uuid ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, station_uuid: e.target.value || null }))}
          >
            <option value="">nowhere in particular</option>
            {[...stationNames].map(([uuid, name]) => (
              <option key={uuid} value={uuid}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {text("description", "Description")}
      {text("notes", "Notes")}
    </>
  );
}

/** The next states a sample can take, as buttons, with an optional move and reason. */
function Lifecycle({ sample, stationNames, onDone }: { sample: SampleDetail; stationNames: Map<string, string>; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [station, setStation] = useState("");
  const move = useMutation({
    mutationFn: (to: SampleState) =>
      samplesApi.addEvent(sample.uuid, { to_state: to, reason: reason || null, station_uuid: station || null }),
    onSuccess: async () => {
      setReason("");
      setStation("");
      await onDone();
    },
  });
  const next = TRANSITIONS[sample.state];

  return (
    <FieldGroup title="Lifecycle">
      {next.length === 0 ? (
        <p className="muted">A {sample.state} sample&apos;s story is over — no further states.</p>
      ) : (
        <>
          <div className="lifecycle__moves">
            {next.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === "quarantined" || to === "disposed" ? "danger" : "secondary"}
                disabled={move.isPending}
                onClick={() => move.mutate(to)}
              >
                {to.replace("_", " ")}
              </Button>
            ))}
          </div>
          <Field label="Reason">
            <input className="field__input" value={reason} placeholder="optional" onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Moved to">
            <select className="field__input" value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">stays where it is</option>
              {[...stationNames].map(([uuid, name]) => (
                <option key={uuid} value={uuid}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          {move.isError && <p className="create__error">{(move.error as Error).message}</p>}
        </>
      )}
    </FieldGroup>
  );
}
