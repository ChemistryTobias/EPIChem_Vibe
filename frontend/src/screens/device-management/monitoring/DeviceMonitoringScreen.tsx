/**
 * Device monitoring and control (plan §13's Device Status, Roadmap 2.2): the
 * stations, what each pod is doing, and what a person can run there — kept to
 * an overview first, detail on demand:
 *
 * - **pinned** actions up top (per station, remembered in this browser);
 * - **station actions**: the operations its pod offers, folded away;
 * - **devices** as compact cards (a few live readings); open one for all its
 *   readings and its **device actions** — plans generated from its driver, or
 *   low-level plans taking it as their device.
 *
 * An action with nothing to fill in runs from its ▶ in one click; anything
 * else opens its form in the action inspector. Every run is a manual run on
 * the station's queue (recorded in Runs), and recent ones can run again with
 * the same values. Readings come from the pod's `read_devices`.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { devicesApi, labsApi, stationsApi } from "../../../api/entities";
import type { Readings, Run, Station } from "../../../api/types";
import { TERMINAL_RUN_STATES, executionApi, runsApi } from "../../../api/workflows";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Glyph, deviceGlyph, stationGlyph } from "../../../components/glyphs";
import { StationIcon } from "../../../components/IconPicker";
import { Inspector } from "../../../components/Inspector";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { StatusPill } from "../../../components/StatusPill";
import { formatTime, nameMap } from "../../format";
import { actionKey, actionLabel, catalog, openParameters, type Action, type DeviceActions } from "../../workflows/plans";
import { QuickRun } from "./QuickRun";

import "./monitoring.css";

interface Opened {
  action: Action;
  autorun: boolean;
  /** Each click is its own: ▶ twice on one action runs it twice. */
  token: number;
}

/** Pinned actions per station, in this browser. Unset: its first few station actions. */
function usePins(station: string) {
  const key = `epichem.pins.${station}`;
  const read = (): string[] | null => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  };
  const [pins, setPins] = useState<string[] | null>(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPins(read()), [key]);
  const save = (next: string[]) => {
    setPins(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // the pins just won't outlive the page
    }
  };
  return { pins, save };
}

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
  const [opened, setOpened] = useState<Opened | null>(null);

  const list = [...(stations.data ?? [])].sort(
    (a, b) => Number(Boolean(b.queueserver_url)) - Number(Boolean(a.queueserver_url)) || a.name.localeCompare(b.name),
  );
  const station = list.find((s) => s.uuid === selectedId) ?? list.find((s) => s.queueserver_url) ?? list[0];

  const select = (uuid: string) => {
    setOpened(null);
    navigate({ to: "/devices/monitoring", search: { station: uuid }, replace: true });
  };

  return (
    <>
      <ScreenHeader title="Device Monitoring" subtitle="Stations, their devices live, and what you can run on them" />
      <div className="screen">
        <div className={opened ? "monitor monitor--inspecting" : "monitor"}>
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
              <StationPanel
                key={station.uuid}
                station={station}
                onOpen={(action, autorun = false) => setOpened({ action, autorun, token: Date.now() })}
                active={opened?.action ?? null}
              />
            ) : (
              <p className="muted">Pick a station.</p>
            )}
          </section>
        </div>

        <Inspector
          open={opened !== null && station !== undefined}
          kind="Action"
          title={opened ? actionLabel(opened.action) : undefined}
          subtitle={opened ? `${opened.action.device ?? "station"} · ${station?.name}` : undefined}
          onClose={() => setOpened(null)}
        >
          {opened && station && <ActionPanel station={station} opened={opened} />}
        </Inspector>
      </div>
    </>
  );
}

function ActionPanel({ station, opened }: { station: Station; opened: Opened }) {
  const palette = useQuery({ queryKey: ["palette", station.uuid], queryFn: () => executionApi.palette(station.uuid) });
  return <QuickRun station={station.uuid} action={opened.action} autorun={opened.autorun} token={opened.token} registered={palette.data?.registered ?? []} />;
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

interface PanelProps {
  station: Station;
  onOpen: (action: Action, autorun?: boolean) => void;
  active: Action | null;
}

function StationPanel({ station, onOpen, active }: PanelProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const executable = Boolean(station.queueserver_url);
  const [device, setDevice] = useState<string | null>(null);
  const { pins, save: savePins } = usePins(station.uuid);
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
  const rerun = useMutation({
    mutationFn: (run: Run) => {
      const item = run.items[0];
      return executionApi.run(station.uuid, item.plan, item.kwargs_sent ?? item.kwargs);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });

  const registry = (devices.data ?? []).filter((d) => d.station_uuid === station.uuid);
  const s = status.data?.status;
  const running = queue.data?.running_item;
  const recent = (runs.data ?? []).filter((r) => r.station_uuid === station.uuid).slice(0, 5);
  const actions = useMemo(() => (palette.data ? catalog(palette.data) : null), [palette.data]);
  const everything = actions ? [...actions.station, ...actions.devices.flatMap((d) => d.actions), ...actions.other] : [];
  const pinned = pins === null ? (actions?.station.slice(0, 6) ?? []) : everything.filter((a) => pins.includes(actionKey(a)));
  const isPinned = (a: Action) => pinned.some((p) => actionKey(p) === actionKey(a));
  const togglePin = (a: Action) => {
    const keys = pinned.map(actionKey);
    savePins(isPinned(a) ? keys.filter((k) => k !== actionKey(a)) : [...keys, actionKey(a)]);
  };
  const tile = (a: Action) => (
    <ActionTile key={actionKey(a)} action={a} active={active} pinned={isPinned(a)} onOpen={onOpen} onPin={togglePin} />
  );

  // Pod devices first, then registry devices with no pod counterpart.
  const podDevices = actions?.devices ?? [];
  const unlinked = registry.filter((d) => !d.ophyd_name || !podDevices.some((p) => p.name === d.ophyd_name));
  const opened = podDevices.find((d) => d.name === device);

  return (
    <>
      <header className="station-head">
        <span className="station-head__icon">
          <StationIcon station={station} size={34} />
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

      {opened ? (
        <DeviceDetail
          device={opened}
          registryName={registry.find((d) => d.ophyd_name === opened.name)?.name}
          readings={readings.data}
          readingsError={readings.isError ? (readings.error as Error).message : null}
          onBack={() => setDevice(null)}
          tile={tile}
        />
      ) : (
        actions && (
          <>
            <section className="section">
              <h3 className="section__title">Pinned</h3>
              {pinned.length > 0 ? (
                <div className="action-tiles">{pinned.map(tile)}</div>
              ) : (
                <p className="muted monitor__hint">Pin the actions you use most (☆ on any action) and they show up here.</p>
              )}
            </section>

            {actions.station.length > 0 && (
              <details className="section fold" open={pins !== null && pinned.length === 0}>
                <summary className="section__title fold__summary">
                  Station actions <span className="fold__count">{actions.station.length}</span>
                </summary>
                <div className="action-tiles">{actions.station.map(tile)}</div>
              </details>
            )}

            {(podDevices.length > 0 || unlinked.length > 0) && (
              <section className="section">
                <h3 className="section__title">
                  Devices
                  {palette.data && podDevices.some((d) => !palette.data!.registered.includes(d.name)) && (
                    <Button size="sm" className="section__action" onClick={() => act.mutate("register")} disabled={act.isPending}>
                      Register all
                    </Button>
                  )}
                </h3>
                {readings.isError && <p className="step-form__warning">Live readings unavailable: {(readings.error as Error).message}</p>}
                <div className="device-cards">
                  {podDevices.map((d) => (
                    <DeviceCard
                      key={d.name}
                      device={d}
                      registryName={registry.find((r) => r.ophyd_name === d.name)?.name}
                      readings={readings.data}
                      onOpen={() => setDevice(d.name)}
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

            {actions.other.length > 0 && (
              <details className="section fold">
                <summary className="section__title fold__summary">
                  More <span className="fold__count">{actions.other.length}</span>
                </summary>
                <div className="action-tiles">{actions.other.map(tile)}</div>
              </details>
            )}
          </>
        )
      )}

      {recent.length > 0 && (
        <section className="section">
          <h3 className="section__title">Recent runs here</h3>
          {rerun.isError && <Alert kind="error">{(rerun.error as Error).message}</Alert>}
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
                {run.kind === "manual" && TERMINAL_RUN_STATES.includes(run.state) && run.items[0] && (
                  <button
                    className="recent-runs__again"
                    onClick={() => rerun.mutate(run)}
                    disabled={rerun.isPending}
                    title={`Run ${run.items[0].plan} again with the same values`}
                  >
                    <Glyph name="rerun" size={13} /> again
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One action: open its mask; ▶ runs it at once when there's nothing to fill in; ☆ pins it. */
function ActionTile({
  action,
  active,
  pinned,
  onOpen,
  onPin,
}: {
  action: Action;
  active: Action | null;
  pinned: boolean;
  onOpen: (a: Action, autorun?: boolean) => void;
  onPin: (a: Action) => void;
}) {
  const open = openParameters(action);
  const selected = active !== null && actionKey(active) === actionKey(action);
  return (
    <div className={selected ? "action-tile action-tile--active" : "action-tile"}>
      <button className="action-tile__main" onClick={() => onOpen(action)} title={action.plan.description}>
        <span className="action-tile__glyph">
          <Glyph name={action.device ? deviceGlyph(action.device) : "play"} size={14} />
        </span>
        <span className="action-tile__text">
          <span className="action-tile__name">
            {actionLabel(action)}
            {action.device && <span className="action-tile__device"> · {action.device}</span>}
          </span>
          <span className="action-tile__desc">
            {open.length === 0 ? "no values needed" : `${open.length} value${open.length === 1 ? "" : "s"}: ${open.map((p) => p.name).join(", ")}`}
          </span>
        </span>
      </button>
      <button className={pinned ? "action-tile__pin action-tile__pin--on" : "action-tile__pin"} onClick={() => onPin(action)} title={pinned ? "Unpin" : "Pin to the top"}>
        {pinned ? "★" : "☆"}
      </button>
      {open.length === 0 && (
        <button className="action-tile__run" onClick={() => onOpen(action, true)} title="Run now">
          <Glyph name="play" size={12} />
        </button>
      )}
    </div>
  );
}

function readingRows(name: string, readings?: Readings) {
  return Object.entries(readings?.[name]?.readings ?? {}).map(([key, r]) => ({
    key,
    label: key.replace(new RegExp(`^${name}_`), "").replace(/_/g, " "),
    value: `${formatValue(r.value)}${r.units ? ` ${r.units}` : ""}`,
    timestamp: r.timestamp,
  }));
}

/** A device at a glance: a few readings and how many actions it has. */
function DeviceCard({ device, registryName, readings, onOpen }: { device: DeviceActions; registryName?: string; readings?: Readings; onOpen: () => void }) {
  const rows = readingRows(device.name, readings);
  const error = readings?.[device.name]?.error;
  return (
    <button className="device-card device-card--link" onClick={onOpen}>
      <div className="device-card__head">
        <Glyph name={deviceGlyph(device.name, device.classname)} size={22} />
        <span className="device-card__name">{device.name}</span>
        <span className="device-card__class mono">{device.classname}</span>
      </div>
      <p className={registryName ? "device-card__note muted" : "device-card__note device-card__note--warn"}>{registryName ?? "not registered in EPIChem"}</p>
      {error && <p className="create__error">{error}</p>}
      {rows.length > 0 && (
        <dl className="readings">
          {rows.slice(0, 3).map((r) => (
            <div key={r.key} className="readings__row">
              <dt>{r.label}</dt>
              <dd className="mono">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="device-card__more">
        {rows.length > 3 ? `+${rows.length - 3} readings · ` : ""}
        {device.actions.length} action{device.actions.length === 1 ? "" : "s"}
        <Glyph name="chevron" size={12} />
      </span>
    </button>
  );
}

/** One device, opened: every reading and every action. */
function DeviceDetail({
  device,
  registryName,
  readings,
  readingsError,
  onBack,
  tile,
}: {
  device: DeviceActions;
  registryName?: string;
  readings?: Readings;
  readingsError: string | null;
  onBack: () => void;
  tile: (a: Action) => React.ReactNode;
}) {
  const rows = readingRows(device.name, readings);
  const newest = rows.reduce((t, r) => Math.max(t, r.timestamp), 0);
  return (
    <>
      <button className="monitor__back" onClick={onBack}>
        <Glyph name="back" size={14} /> Station overview
      </button>
      <div className="device-detail__head">
        <span className="device-detail__icon">
          <Glyph name={deviceGlyph(device.name, device.classname)} size={28} />
        </span>
        <div>
          <h3 className="device-detail__name">{device.name}</h3>
          <p className="muted mono device-detail__class">
            {device.classname} · {registryName ?? "not registered in EPIChem"}
          </p>
        </div>
      </div>
      <section className="section">
        <h3 className="section__title">Readings</h3>
        {readingsError && <p className="step-form__warning">Live readings unavailable: {readingsError}</p>}
        {readings?.[device.name]?.error && <p className="create__error">{readings[device.name].error}</p>}
        {rows.length > 0 ? (
          <dl className="readings readings--wide">
            {rows.map((r) => (
              <div key={r.key} className="readings__row">
                <dt>{r.label}</dt>
                <dd className="mono">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">This device reports no readings.</p>
        )}
        {newest > 0 && <p className="device-card__age muted">read {age(newest)}</p>}
      </section>
      <section className="section">
        <h3 className="section__title">Device actions</h3>
        {device.actions.length ? <div className="action-tiles">{device.actions.map(tile)}</div> : <p className="muted">No actions for this device.</p>}
      </section>
    </>
  );
}
