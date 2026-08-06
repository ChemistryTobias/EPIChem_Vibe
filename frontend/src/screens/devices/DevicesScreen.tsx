/**
 * Devices screen: a summary strip, then the registered devices as a card
 * grid, filterable by the query parameters the API already supports
 * (`GET /api/v1/devices?lab=&capability_class=&mode=`).
 *
 * Read-only. The plan's live device plane — real state off MQTT, jog/home
 * controls, signal readouts — is M2, and nothing behind those buttons exists
 * yet; this screen shows the *registry* record for each device.
 */

import { useCallback, useMemo, useState } from "react";

import { listCapabilityClasses, listDevices } from "../../api/devices";
import { listLabs } from "../../api/topology";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import type { Device } from "../../api/types";
import { DeviceCard } from "./DeviceCard";
import { DeviceInspector } from "./DeviceInspector";

import "./DevicesScreen.css";

const MODES = ["read_write", "read_only", "maintenance", "disabled"];

export function DevicesScreen() {
  const [lab, setLab] = useState("");
  const [capabilityClass, setCapabilityClass] = useState("");
  const [mode, setMode] = useState("");
  const [selected, setSelected] = useState<Device | null>(null);

  // The fetch identity is what re-runs it, so the filters are the deps.
  const devices = useAsync(
    useCallback(
      () => listDevices({ lab: lab || undefined, capability_class: capabilityClass || undefined, mode: mode || undefined }),
      [lab, capabilityClass, mode],
    ),
  );

  // Filter dropdown options come from the registry too — no hard-coded lab
  // or class names anywhere in the frontend.
  const labs = useAsync(useCallback(() => listLabs(), []));
  const classes = useAsync(useCallback(() => listCapabilityClasses(), []));

  const summary = useMemo(() => {
    const rows = devices.data ?? [];
    const byMode = (m: string) => rows.filter((d) => d.operational_mode === m).length;
    return [
      { label: "Registered", value: rows.length },
      { label: "Read/write", value: byMode("read_write") },
      { label: "Read only", value: byMode("read_only") },
      { label: "Maintenance", value: byMode("maintenance") },
      { label: "Disabled", value: byMode("disabled") },
    ];
  }, [devices.data]);

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
            {summary.map((item) => (
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
            <select id="device-lab" value={lab} onChange={(e) => setLab(e.target.value)}>
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
              onChange={(e) => setCapabilityClass(e.target.value)}
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
            <select id="device-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">All</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <span className="toolbar__spacer label">{(devices.data ?? []).length} shown</span>
          </div>

          <AsyncBoundary
            state={devices}
            isEmpty={(rows) => rows.length === 0}
            empty={
              <p>
                No devices match. Import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {(rows) => (
              <div className="device-grid">
                {rows.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    selected={device.id === selected?.id}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            )}
          </AsyncBoundary>
        </div>

        <DeviceInspector device={selected} onClose={() => setSelected(null)} />
      </div>
    </>
  );
}
