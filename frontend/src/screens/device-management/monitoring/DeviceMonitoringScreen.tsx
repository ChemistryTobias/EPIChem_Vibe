/**
 * Device monitoring and control (plan §13's Device Status, Roadmap 2.2): the
 * stations, what each pod is doing, every device's live readings, and the
 * actions a person can run from here —
 *
 * - **station plans**: the operations its pod offers (high-level libraries);
 * - **device actions**: per device, the plans that act on it — low-level
 *   plans taking it as a device argument, or the plans auto-discovered from
 *   its driver.
 *
 * Every action opens the plan's generated form in the inspector and runs it
 * as a manual run on the station's queue (recorded in Runs). Readings come
 * from the pod's `read_devices` and show their age; nothing here is cached
 * beyond a few seconds.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { devicesApi, labsApi, stationsApi } from "../../../api/entities";
import type { Palette, PlanRepr, Readings, Station } from "../../../api/types";
import { TERMINAL_RUN_STATES, executionApi, runsApi } from "../../../api/workflows";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Glyph, deviceGlyph, stationGlyph } from "../../../components/glyphs";
import { Inspector } from "../../../components/Inspector";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { StatusPill } from "../../../components/StatusPill";
import { formatTime, nameMap } from "../../format";
import { isDeviceParameter, parametersOf } from "../../workflows/plans";
import { QuickRun } from "./QuickRun";

import "./monitoring.css";

interface Action {
  plan: PlanRepr;
  preset: Record<string, unknown>;
  /** What the panel says this is about. */
  about: string;
}

/** A plan belongs to a device if it takes it as a device argument, or was
 * generated from its driver (module epichem_pod.auto.<device>_low_level). */
function deviceActions(palette: Palette, device: string): Action[] {
  const actions: Action[] = [];
  for (const plan of Object.values(palette.plans)) {
    if (plan.module === `epichem_pod.auto.${device}_low_level`) {
      actions.push({ plan, preset: {}, about: device });
      continue;
    }
    const params = parametersOf(plan).filter(isDeviceParameter);
    if (params.length !== 1) continue; // two device arguments: not one device's action
    const options = Object.values(params[0].annotation?.devices ?? {}).flat();
    if (options.includes(device) && (plan.module ?? "").endsWith("_low_level")) {
      actions.push({ plan, preset: { [params[0].name]: device }, about: device });
    }
  }
  return actions.sort((a, b) => a.plan.name.localeCompare(b.plan.name));
}

/** The station's own operations: plans outside low-level and auto libraries. */
function stationPlans(palette: Palette): PlanRepr[] {
  return Object.values(palette.plans)
    .filter((p) => !(p.module ?? "").endsWith("_low_level") && !(p.module ?? "").startsWith("bluesky."))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "hotplate_off" on hotplate1 reads "off": drop the device's name, or its type. */
const short = (plan: string, device: string) =>
  plan
    .replace(new RegExp(`^${device}_`), "")
    .replace(new RegExp(`^${device.replace(/\d+$/, "")}_`), "")
    .replace(/_/g, " ");

function age(timestamp: number): string {
  const s = Math.max(0, Date.now() / 1000 - timestamp);
  return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : "stale";
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value ?? "—");
}

export function DeviceMonitoringScreen() {
  const navigate = useNavigate();
  const { station: selectedId } = useSearch({ from: "/devices/monitoring" });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const labNames = useMemo(() => nameMap(labs.data), [labs.data]);
  const [action, setAction] = useState<Action | null>(null);

  const list = [...(stations.data ?? [])].sort(
    (a, b) => Number(Boolean(b.queueserver_url)) - Number(Boolean(a.queueserver_url)) || a.name.localeCompare(b.name),
  );
  const station = list.find((s) => s.uuid === selectedId) ?? list.find((s) => s.queueserver_url) ?? list[0];

  const select = (uuid: string) => {
    setAction(null);
    navigate({ to: "/devices/monitoring", search: { station: uuid }, replace: true });
  };

  return (
    <>
      <ScreenHeader title="Device Monitoring" subtitle="Stations, their devices live, and what you can run on them" />
      <div className="screen">
        <div className={action ? "monitor monitor--inspecting" : "monitor"}>
          <aside className="monitor__stations" data-inspects>
            {list.length === 0 && <p className="muted monitor__empty">No stations yet.</p>}
            {list.map((s) => (
              <StationRow
                key={s.uuid}
                station={s}
                lab={labNames.get(s.lab_uuid)}
                active={s.uuid === station?.uuid}
                onClick={() => select(s.uuid)}
              />
            ))}
          </aside>
          <section className="monitor__main" data-inspects>
            {station ? (
              <StationPanel key={station.uuid} station={station} onAction={setAction} active={action} />
            ) : (
              <p className="muted">Pick a station.</p>
            )}
          </section>
        </div>

        <Inspector
          open={action !== null && station !== undefined}
          kind="Action"
          title={action?.plan.name}
          subtitle={action ? `${action.about} · ${station?.name}` : undefined}
          onClose={() => setAction(null)}
        >
          {action && station && (
            <ActionPanel station={station} action={action} />
          )}
        </Inspector>
      </div>
    </>
  );
}

function ActionPanel({ station, action }: { station: Station; action: Action }) {
  const palette = useQuery({ queryKey: ["palette", station.uuid], queryFn: () => executionApi.palette(station.uuid) });
  return (
    <QuickRun
      station={station.uuid}
      plan={action.plan}
      preset={action.preset}
      registered={palette.data?.registered ?? []}
    />
  );
}

function StationRow({ station, lab, active, onClick }: { station: Station; lab?: string; active: boolean; onClick: () => void }) {
  const status = useQuery({
    queryKey: ["execution", station.uuid],
    queryFn: () => executionApi.status(station.uuid),
    enabled: Boolean(station.queueserver_url),
    refetchInterval: 5000,
  });
  const s = status.data;
  const state = !station.queueserver_url
    ? null
    : !s
      ? "…"
      : !s.reachable || !s.status
        ? "unreachable"
        : s.status.worker_environment_exists
          ? s.status.manager_state
          : "closed";
  return (
    <button className={active ? "station-row station-row--active" : "station-row"} onClick={onClick}>
      <span className="station-row__icon">
        <Glyph name={stationGlyph(station)} size={22} />
      </span>
      <span className="station-row__text">
        <span className="station-row__name">{station.name}</span>
        <span className="station-row__sub">{lab ?? ""}</span>
      </span>
      {state === null ? <span className="station-row__off">no pod</span> : state === "…" ? null : <StatusPill status={state} />}
    </button>
  );
}

function StationPanel({ station, onAction, active }: { station: Station; onAction: (a: Action) => void; active: Action | null }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const executable = Boolean(station.queueserver_url);
  const status = useQuery({
    queryKey: ["execution", station.uuid],
    queryFn: () => executionApi.status(station.uuid),
    enabled: executable,
    refetchInterval: 3000,
  });
  const reachable = Boolean(status.data?.reachable && status.data.status?.worker_environment_exists);
  const palette = useQuery({ queryKey: ["palette", station.uuid], queryFn: () => executionApi.palette(station.uuid), enabled: reachable });
  const readings = useQuery({
    queryKey: ["readings", station.uuid],
    queryFn: () => executionApi.readings(station.uuid),
    enabled: reachable,
    refetchInterval: 2000,
    retry: false,
  });
  const queue = useQuery({ queryKey: ["queue", station.uuid], queryFn: () => executionApi.queue(station.uuid), enabled: reachable, refetchInterval: 3000 });
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });
  const runs = useQuery({ queryKey: ["runs"], queryFn: runsApi.list, refetchInterval: 4000 });

  const act = useMutation({
    mutationFn: (how: "open" | "start" | "register") =>
      how === "open"
        ? executionApi.openEnvironment(station.uuid)
        : how === "start"
          ? executionApi.startQueue(station.uuid)
          : executionApi.registerDevices(station.uuid).then(() => undefined),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const registry = (devices.data ?? []).filter((d) => d.station_uuid === station.uuid);
  const s = status.data?.status;
  const running = queue.data?.running_item;
  const recent = (runs.data ?? []).filter((r) => r.station_uuid === station.uuid).slice(0, 5);

  // Pod devices first, then registry devices with no pod counterpart.
  const podDevices = Object.keys(palette.data?.devices ?? {});
  const unlinked = registry.filter((d) => !d.ophyd_name || !podDevices.includes(d.ophyd_name));

  return (
    <>
      <header className="station-head">
        <span className="station-head__icon">
          <Glyph name={stationGlyph(station)} size={34} />
        </span>
        <div className="station-head__text">
          <h2 className="station-head__name">{station.name}</h2>
          <p className="mono muted station-head__url">{station.queueserver_url ?? "no queueserver URL — not executable"}</p>
        </div>
        <div className="station-head__state">
          {executable &&
            (status.data && (!status.data.reachable || !s) ? (
              <StatusPill status="unreachable" title={status.data.error ?? undefined} />
            ) : s ? (
              <StatusPill status={s.worker_environment_exists ? s.manager_state : "closed"} />
            ) : null)}
          {s && !s.worker_environment_exists && (
            <Button size="sm" onClick={() => act.mutate("open")} disabled={act.isPending}>
              Open environment
            </Button>
          )}
          {s?.worker_environment_exists && s.manager_state === "idle" && s.items_in_queue > 0 && (
            <Button size="sm" onClick={() => act.mutate("start")} disabled={act.isPending}>
              Start queue
            </Button>
          )}
        </div>
      </header>

      {!executable && (
        <Alert kind="info">
          This station has no pod. Give it a queueserver URL in the Hierarchy, or link a discovered pod with
          New device → Discover.
        </Alert>
      )}
      {status.data && !status.data.reachable && <Alert kind="error">{status.data.error}</Alert>}
      {act.isError && <Alert kind="error">{(act.error as Error).message}</Alert>}

      {reachable && (
        <div className="station-now">
          {running ? (
            <>
              <span className="label">Running</span>
              <span className="mono">{running.name}</span>
              {running.meta?.epichem?.run_code ? <span className="muted">{String(running.meta.epichem.run_code)}</span> : null}
            </>
          ) : (
            <span className="label">Idle</span>
          )}
          <span className="station-now__spacer" />
          <span className="muted">
            {queue.data?.items.length ?? 0} queued · {s?.items_in_history ?? 0} done
          </span>
        </div>
      )}

      {palette.data && stationPlans(palette.data).length > 0 && (
        <section className="section">
          <h3 className="section__title">Station plans</h3>
          <div className="plan-tiles">
            {stationPlans(palette.data).map((plan) => (
              <button
                key={plan.name}
                className={active?.plan.name === plan.name ? "plan-tile plan-tile--active" : "plan-tile"}
                onClick={() => onAction({ plan, preset: {}, about: "station" })}
                title={plan.description}
              >
                <Glyph name="play" size={14} />
                <span className="plan-tile__name">{plan.name.replace(/_/g, " ")}</span>
                {plan.description && <span className="plan-tile__desc">{plan.description}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {(podDevices.length > 0 || registry.length > 0) && (
        <section className="section">
          <h3 className="section__title">
            Devices
            {palette.data && podDevices.some((d) => !palette.data!.registered.includes(d)) && (
              <Button size="sm" className="section__action" onClick={() => act.mutate("register")} disabled={act.isPending}>
                Register all
              </Button>
            )}
          </h3>
          {readings.isError && (
            <p className="step-form__warning">Live readings unavailable: {(readings.error as Error).message}</p>
          )}
          <div className="device-cards">
            {podDevices.map((name) => (
              <DeviceCard
                key={name}
                name={name}
                classname={palette.data?.devices[name]?.classname}
                registryName={registry.find((d) => d.ophyd_name === name)?.name}
                readings={readings.data}
                actions={palette.data ? deviceActions(palette.data, name) : []}
                active={active}
                onAction={onAction}
              />
            ))}
            {unlinked.map((d) => (
              <div key={d.uuid} className="device-card device-card--offline">
                <div className="device-card__head">
                  <Glyph name={deviceGlyph(d.name)} size={22} />
                  <span className="device-card__name">{d.name}</span>
                </div>
                <p className="muted device-card__note">
                  {d.ophyd_name ? `"${d.ophyd_name}" isn't in this station's pod.` : "Registry only — no pod device linked."}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <h3 className="section__title">Recent runs here</h3>
          <ul className="recent-runs">
            {recent.map((run) => (
              <li key={run.uuid}>
                <button className="field__link mono" onClick={() => navigate({ to: "/workflows/runs", search: { run: run.code } })}>
                  {run.code}
                </button>
                <span>{run.kind === "manual" ? run.procedure_name.replace(/_/g, " ") : run.procedure_name}</span>
                <span className="muted">{run.kind === "manual" ? "manual" : `v${run.procedure_version}`}</span>
                <StatusPill status={run.state} />
                <span className="muted">{formatTime(run.started_at ?? run.created_at)}</span>
                {!TERMINAL_RUN_STATES.includes(run.state) && <span className="recent-runs__live" />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function DeviceCard({
  name,
  classname,
  registryName,
  readings,
  actions,
  active,
  onAction,
}: {
  name: string;
  classname?: string | null;
  registryName?: string;
  readings?: Readings;
  actions: Action[];
  active: Action | null;
  onAction: (a: Action) => void;
}) {
  const data = readings?.[name];
  const entries = Object.entries(data?.readings ?? {});
  const newest = entries.reduce((t, [, r]) => Math.max(t, r.timestamp), 0);
  return (
    <div className="device-card">
      <div className="device-card__head">
        <Glyph name={deviceGlyph(name, classname)} size={22} />
        <span className="device-card__name">{name}</span>
        <span className="device-card__class mono">{classname}</span>
      </div>
      <p className={registryName ? "device-card__note muted" : "device-card__note device-card__note--warn"}>
        {registryName ?? "not registered in EPIChem"}
      </p>
      {data?.error && <p className="create__error">{data.error}</p>}
      {entries.length > 0 && (
        <dl className="readings">
          {entries.map(([key, r]) => (
            <div key={key} className="readings__row">
              <dt>{key.replace(new RegExp(`^${name}_`), "").replace(/_/g, " ")}</dt>
              <dd className="mono">
                {formatValue(r.value)}
                {r.units && <span className="readings__unit"> {r.units}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {newest > 0 && <p className="device-card__age muted">read {age(newest)}</p>}
      {actions.length > 0 && (
        <div className="device-card__actions">
          {actions.map((a) => (
            <button
              key={a.plan.name}
              className={active?.plan.name === a.plan.name && active.about === name ? "action-chip action-chip--active" : "action-chip"}
              onClick={() => onAction(a)}
              title={a.plan.description}
            >
              {short(a.plan.name, name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
