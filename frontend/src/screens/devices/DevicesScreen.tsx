/**
 * Devices screen: a summary strip, then the registered devices as a card
 * grid, filterable by the query parameters the API already supports
 * (`GET /api/v1/devices?lab=&capability_class=&mode=`).
 *
 * Read-only. The plan's live device plane — real state off MQTT, jog/home
 * controls, signal readouts — is M2, and nothing behind those buttons exists
 * yet; this screen shows the *registry* record for each device.
 */

import { useCallback, useState } from "react";

import { listCapabilityClasses, listDevices } from "../../api/devices";
import { listLabs } from "../../api/topology";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { Pager } from "../../components/Pager";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import type { Device } from "../../api/types";
import { DeviceCard } from "./DeviceCard";
import { DeviceInspector } from "./DeviceInspector";

import "./DevicesScreen.css";

const MODES = ["read_write", "read_only", "maintenance", "disabled"];
const MODE_LABELS: Record<string, string> = {
  read_write: "Read/write",
  read_only: "Read only",
  maintenance: "Maintenance",
  disabled: "Disabled",
};
const PAGE_SIZE = 60;

export function DevicesScreen() {
  const [lab, setLab] = useState("");
  const [capabilityClass, setCapabilityClass] = useState("");
  const [mode, setMode] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Device | null>(null);

  // The fetch identity is what re-runs it, so the filters are the deps.
  const devices = useAsync(
    useCallback(
      () =>
        listDevices({
          lab: lab || undefined,
          capability_class: capabilityClass || undefined,
          mode: mode || undefined,
          limit: PAGE_SIZE,
          offset,
        }),
      [lab, capabilityClass, mode, offset],
    ),
  );

  // Any filter change resets to the first page — otherwise a narrower
  // filter can leave you on a page that no longer exists.
  const applyFilter = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  // Filter dropdown options come from the registry too — no hard-coded lab
  // or class names anywhere in the frontend.
  const labs = useAsync(useCallback(() => listLabs(), []));
  const classes = useAsync(useCallback(() => listCapabilityClasses(), []));

  // Counted server-side, not from the rows on screen: with paging, a
  // page-local tally would silently mean "…of the 60 devices you can
  // currently see", which is not what a summary strip is claiming. Each
  // request asks for a single row and reads X-Total-Count.
  const summary = useAsync(
    useCallback(async () => {
      const scope = { lab: lab || undefined, capability_class: capabilityClass || undefined };
      const [all, ...perMode] = await Promise.all([
        listDevices({ ...scope, limit: 1 }),
        ...MODES.map((m) => listDevices({ ...scope, mode: m, limit: 1 })),
      ]);
      return [
        { label: "Registered", value: all.total },
        ...MODES.map((m, i) => ({ label: MODE_LABELS[m], value: perMode[i].total })),
      ];
    }, [lab, capabilityClass]),
  );

  return (
    <>
      <ScreenHeader
        title="Devices"
        subtitle="Registry records for every registered device (§6.1). Live state is M2."
        actions={
          <Button variant="primary" onClick={devices.reload}>
            Refresh
          </Button>
        }
      />

      <div className="screen">
        <div className="screen__content">
          <div className="summary">
            {(summary.data ?? []).map((item) => (
              <div key={item.label} className="summary__cell">
                <p className="label">{item.label}</p>
                <p className="summary__value mono">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="toolbar">
            <label className="label" htmlFor="device-lab">
              Lab
            </label>
            <select
              id="device-lab"
              value={lab}
              onChange={(e) => applyFilter(() => setLab(e.target.value))}
            >
              <option value="">All</option>
              {(labs.data ?? []).map((l) => (
                <option key={l.id} value={l.code}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="device-class">
              Class
            </label>
            <select
              id="device-class"
              value={capabilityClass}
              onChange={(e) => applyFilter(() => setCapabilityClass(e.target.value))}
            >
              <option value="">All</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="device-mode">
              Mode
            </label>
            <select
              id="device-mode"
              value={mode}
              onChange={(e) => applyFilter(() => setMode(e.target.value))}
            >
              <option value="">All</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <span className="toolbar__spacer label">{devices.data?.total ?? 0} match</span>
          </div>

          <AsyncBoundary
            state={devices}
            isEmpty={(page) => page.total === 0}
            empty={
              <p>
                No devices match. Import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {(page) => (
              <>
                <div className="device-grid">
                  {page.items.map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      selected={device.id === selected?.id}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
                <Pager
                  total={page.total}
                  limit={PAGE_SIZE}
                  offset={offset}
                  onOffsetChange={setOffset}
                  noun="devices"
                />
              </>
            )}
          </AsyncBoundary>
        </div>

        <DeviceInspector device={selected} onClose={() => setSelected(null)} />
      </div>
    </>
  );
}
