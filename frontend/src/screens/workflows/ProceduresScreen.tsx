/**
 * The procedure library (Roadmap 2.1): every procedure, searchable, with the
 * stations it uses, its last run, and the usual verbs — new, open, duplicate,
 * delete. Opening one goes to the designer; "New" creates an empty procedure
 * straight away and opens it, the way a workflow tool starts you on a canvas
 * rather than a form.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { stationsApi } from "../../api/entities";
import type { Procedure, Run } from "../../api/types";
import { proceduresApi, runsApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Glyph, STEP_GLYPH, stationGlyph } from "../../components/glyphs";
import { ScreenHeader } from "../../components/ScreenHeader";
import { SearchBox } from "../../components/SearchBox";
import { StatusPill } from "../../components/StatusPill";
import { formatDateTime, matchesQuery } from "../format";

import "./workflows.css";

export function ProceduresScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [stationFilter, setStationFilter] = useState("");

  const procedures = useQuery({ queryKey: ["procedures"], queryFn: proceduresApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const runs = useQuery({ queryKey: ["runs"], queryFn: runsApi.list });

  const stationById = useMemo(() => new Map((stations.data ?? []).map((s) => [s.uuid, s])), [stations.data]);
  const lastRun = useMemo(() => {
    const map = new Map<string, Run>();
    for (const run of runs.data ?? []) if (run.procedure_uuid && !map.has(run.procedure_uuid)) map.set(run.procedure_uuid, run);
    return map;
  }, [runs.data]);

  const stationsOf = (p: Procedure) => [
    ...new Set(
      p.steps.filter((s) => (s.type ?? "plan") === "plan").map((s) => s.station_uuid ?? p.station_uuid).filter(Boolean) as string[],
    ),
  ];
  const controlsOf = (p: Procedure) => [...new Set(p.steps.map((s) => s.type ?? "plan").filter((t) => t !== "plan"))];

  const open = (p: Procedure) => navigate({ to: "/workflows/designer/$procedureId", params: { procedureId: p.uuid } });

  const create = useMutation({
    mutationFn: () => {
      const taken = new Set((procedures.data ?? []).map((p) => p.name));
      let name = "Untitled procedure";
      for (let n = 2; taken.has(name); n++) name = `Untitled procedure ${n}`;
      const station = (stations.data ?? []).find((s) => s.queueserver_url);
      return proceduresApi.create({ name, station_uuid: station?.uuid ?? null, steps: [] });
    },
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      open(p);
    },
  });
  const duplicate = useMutation({
    mutationFn: (p: Procedure) => proceduresApi.duplicate(p.uuid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procedures"] }),
  });
  const remove = useMutation({
    mutationFn: (p: Procedure) => proceduresApi.remove(p.uuid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procedures"] }),
  });

  const rows = (procedures.data ?? []).filter(
    (p) =>
      matchesQuery(query, p.name, p.description, ...p.steps.map((s) => s.plan)) &&
      (!stationFilter || stationsOf(p).includes(stationFilter)),
  );
  const usedStations = [...new Set((procedures.data ?? []).flatMap(stationsOf))].map((id) => stationById.get(id)).filter(Boolean);

  return (
    <>
      <ScreenHeader
        title="Procedures"
        subtitle={procedures.data ? `${procedures.data.length} procedure${procedures.data.length === 1 ? "" : "s"}` : "Loading…"}
        actions={
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            New procedure
          </Button>
        }
      />
      <div className="screen">
        <div className="screen__content">
          <div className="library__filters">
            <SearchBox className="library__search" value={query} onChange={setQuery} placeholder="Search name, description, plans" />
            <div className="samples__chips">
              <button className={stationFilter === "" ? "chip chip--active" : "chip"} onClick={() => setStationFilter("")}>
                all stations
              </button>
              {usedStations.map((s) => (
                <button
                  key={s!.uuid}
                  className={stationFilter === s!.uuid ? "chip chip--active chip--icon" : "chip chip--icon"}
                  onClick={() => setStationFilter(s!.uuid)}
                >
                  <Glyph name={stationGlyph(s)} size={14} /> {s!.name}
                </button>
              ))}
            </div>
          </div>

          {[create, duplicate, remove].map((m, i) =>
            m.isError ? <Alert key={i} kind="error">{(m.error as Error).message}</Alert> : null,
          )}

          {procedures.data && rows.length === 0 && (
            <div className="library__empty">
              <p className="label">{procedures.data.length ? "No procedure matches" : "No procedures yet"}</p>
              {!procedures.data.length && (
                <p className="muted">
                  A procedure is a sequence of station plans and flow-control steps. Start one and build it on the
                  canvas.
                </p>
              )}
              {!procedures.data.length && (
                <Button variant="primary" onClick={() => create.mutate()}>
                  New procedure
                </Button>
              )}
            </div>
          )}

          <ul className="library">
            {rows.map((p) => {
              const run = lastRun.get(p.uuid);
              return (
                <li key={p.uuid} className="library__row">
                  <button className="library__open" onClick={() => open(p)}>
                    <span className="library__icons">
                      {stationsOf(p).map((id) => (
                        <span key={id} className="library__icon" title={stationById.get(id)?.name}>
                          <Glyph name={stationGlyph(stationById.get(id))} size={18} />
                        </span>
                      ))}
                      {controlsOf(p).map((t) => (
                        <span key={t} className="library__icon library__icon--control" title={t}>
                          <Glyph name={STEP_GLYPH[t as keyof typeof STEP_GLYPH]} size={18} />
                        </span>
                      ))}
                      {p.steps.length === 0 && <span className="library__icon library__icon--empty" />}
                    </span>
                    <span className="library__text">
                      <span className="library__name">{p.name}</span>
                      <span className="library__meta">
                        {p.steps.length} step{p.steps.length === 1 ? "" : "s"} · v{p.version} · updated {formatDateTime(p.updated_at)}
                        {p.description ? ` · ${p.description}` : ""}
                      </span>
                    </span>
                  </button>
                  <span className="library__run">
                    {run ? (
                      <button
                        className="library__runlink"
                        onClick={() => navigate({ to: "/workflows/runs", search: { run: run.code } })}
                        title={`Last run ${run.code}`}
                      >
                        <span className="mono muted">{run.code}</span> <StatusPill status={run.state} />
                      </button>
                    ) : (
                      <span className="muted">never run</span>
                    )}
                  </span>
                  <span className="library__actions">
                    <Button size="sm" onClick={() => open(p)}>
                      Open
                    </Button>
                    <Button size="sm" onClick={() => duplicate.mutate(p)} disabled={duplicate.isPending}>
                      Duplicate
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => confirm(`Delete procedure "${p.name}"?`) && remove.mutate(p)}
                      disabled={remove.isPending}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
