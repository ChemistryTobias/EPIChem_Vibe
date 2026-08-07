/**
 * Creation as a right-hand inspector panel (ADR 0009).
 *
 * One kind at a time: a form with a parent picker, and — as you type — a live
 * draft row that the screen injects into the tree at exactly the spot the new
 * row will land. Nothing is written until you press Create; Cancel discards the
 * draft. When the required parent doesn't exist yet (a device with no stations),
 * the panel points you at creating that parent first instead of walking a
 * wizard.
 *
 * Form state lives here; only the four things the tree needs to preview the row
 * — kind, code, name and the resolved parent id — are reported up through
 * `onPreview`. The parent id is resolved from the picked code against the
 * snapshot so the screen doesn't have to know each kind's parent rule.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { createDevice, listCapabilityClasses } from "../../../api/devices";
import { createLab, createSite, createStation, createZone } from "../../../api/topology";
import type { TopologySnapshot } from "../../../api/topology";
import { Button } from "../../../components/Button";
import { Inspector } from "../../../components/Inspector";
import { useAsync } from "../../../hooks/useAsync";
import type { DraftNode } from "../topologyTree";
import {
  ATMOSPHERES,
  DEVICE_MODES,
  ENVIRONMENT_CLASSES,
  KIND_LABEL,
  NODE_KINDS,
  OCCUPANCIES,
  REQUIRED_PARENT,
  STATION_STATES,
} from "./nodeCreate";
import type { CreateKind } from "./nodeCreate";

import "./CreateInspector.css";

interface CreateInspectorProps {
  kind: CreateKind;
  snapshot: TopologySnapshot;
  /** Live preview of the row being typed — null clears it. */
  onPreview: (draft: DraftNode | null) => void;
  /** Written successfully: reload and close. */
  onCreated: () => void;
  onCancel: () => void;
  /** Jump to creating a different kind (the missing prerequisite). */
  onSwitchKind: (kind: CreateKind) => void;
}

export function CreateInspector({
  kind,
  snapshot,
  onPreview,
  onCreated,
  onCancel,
  onSwitchKind,
}: CreateInspectorProps) {
  const label = KIND_LABEL[kind].toLowerCase();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  // Parents, preselected to the first existing row so the shown option and the
  // state always agree (an empty required <select> still displays its first
  // option — submitting then would orphan the row).
  const [site, setSite] = useState(() => snapshot.sites[0]?.code ?? "");
  const [lab, setLab] = useState(() => snapshot.labs[0]?.code ?? "");
  const [zone, setZone] = useState(""); // optional
  const [station, setStation] = useState(() => snapshot.stations[0]?.code ?? "");

  // Kind-specific extras.
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("");
  const [room, setRoom] = useState("");
  const [envClass, setEnvClass] = useState<string>(ENVIRONMENT_CLASSES[0]);
  const [atmosphere, setAtmosphere] = useState<string>(ATMOSPHERES[0]);
  const [occupancy, setOccupancy] = useState<string>("shared");
  const [stationKind, setStationKind] = useState("generic");
  const [capacity, setCapacity] = useState("1");
  const [stationState, setStationState] = useState<string>("active");
  const [nodeKind, setNodeKind] = useState<string>("device");
  const [capabilityClass, setCapabilityClass] = useState("");
  const [mode, setMode] = useState<string>("read_write");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classes = useAsync(useCallback(() => listCapabilityClasses(), []));

  const byCode = (rows: { id: string; code: string }[], c: string) =>
    rows.find((r) => r.code === c)?.id ?? null;

  // The real row the draft will hang under, as an id (null for a new Site).
  const parentId = useMemo<string | null>(() => {
    switch (kind) {
      case "Site":
        return null;
      case "Lab":
        return byCode(snapshot.sites, site);
      case "Zone":
        return byCode(snapshot.labs, lab);
      case "Station":
        return zone ? byCode(snapshot.zones, zone) : byCode(snapshot.labs, lab);
      case "Device":
        return byCode(snapshot.stations, station);
    }
  }, [kind, snapshot, site, lab, zone, station]);

  // Push the live preview on every edit; clear it once, on unmount.
  useEffect(() => {
    onPreview({ kind, code, name, parentId });
  }, [kind, code, name, parentId, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  // Is the one required parent missing entirely? (A station's zone is optional,
  // so it's never what blocks creation.)
  const requiredParent = REQUIRED_PARENT[kind];
  const parentPool: Record<CreateKind, { id: string; code: string }[]> = {
    Site: [],
    Lab: snapshot.sites,
    Zone: snapshot.labs,
    Station: snapshot.labs,
    Device: snapshot.stations,
  };
  const missingPrereq = requiredParent !== null && parentPool[kind].length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create();
      onCreated();
    } catch (cause) {
      // The backend's problem+json title/detail is the useful message.
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  function create() {
    const c = code.trim();
    const n = name.trim();
    switch (kind) {
      case "Site":
        return createSite(c, n, {
          address: address.trim() || null,
          timezone: timezone.trim() || null,
        });
      case "Lab":
        return createLab(c, n, {
          site,
          room_number: room.trim() || null,
          environment_class: envClass,
        });
      case "Zone":
        return createZone(c, n, { lab, atmosphere, occupancy });
      case "Station":
        return createStation(c, n, {
          lab,
          zone: zone || null,
          kind: stationKind.trim() || "generic",
          capacity: Number(capacity) || 1,
          state: stationState,
          owning_group: null,
        });
      case "Device":
        return createDevice({
          code: c,
          name: n,
          node_kind: nodeKind,
          capability_class: nodeKind === "module" ? null : capabilityClass || null,
          station: station || null,
          operational_mode: mode,
        });
    }
  }

  return (
    <Inspector kind="Create" title={`New ${label}`} subtitle="Draft — press Create to save" onClose={onCancel}>
      {missingPrereq ? (
        <PrereqNotice
          kind={kind}
          parent={requiredParent}
          onSwitchKind={onSwitchKind}
          onCancel={onCancel}
        />
      ) : (
        <form className="create-form" onSubmit={submit}>
          <TextField label="Code" value={code} onChange={setCode} placeholder={`${kind.toUpperCase()}-01`} required />
          <TextField label="Name" value={name} onChange={setName} required />

          {kind === "Lab" && (
            <ParentSelect label="Site" options={snapshot.sites} value={site} onChange={setSite} />
          )}
          {(kind === "Zone" || kind === "Station") && (
            <ParentSelect label="Lab" options={snapshot.labs} value={lab} onChange={setLab} />
          )}
          {kind === "Station" && (
            <ParentSelect label="Zone" options={snapshot.zones} value={zone} onChange={setZone} optional />
          )}
          {kind === "Device" && (
            <ParentSelect label="Station" options={snapshot.stations} value={station} onChange={setStation} />
          )}

          {kind === "Site" && (
            <>
              <TextField label="Address" value={address} onChange={setAddress} />
              <TextField label="Timezone" value={timezone} onChange={setTimezone} placeholder="Europe/Berlin" />
            </>
          )}
          {kind === "Lab" && (
            <>
              <TextField label="Room number" value={room} onChange={setRoom} />
              <SelectField label="Environment class" value={envClass} onChange={setEnvClass} options={ENVIRONMENT_CLASSES} />
            </>
          )}
          {kind === "Zone" && (
            <>
              <SelectField label="Atmosphere" value={atmosphere} onChange={setAtmosphere} options={ATMOSPHERES} />
              <SelectField label="Occupancy" value={occupancy} onChange={setOccupancy} options={OCCUPANCIES} />
            </>
          )}
          {kind === "Station" && (
            <>
              <TextField label="Kind" value={stationKind} onChange={setStationKind} placeholder="generic" />
              <TextField label="Capacity" value={capacity} onChange={setCapacity} type="number" />
              <SelectField label="State" value={stationState} onChange={setStationState} options={STATION_STATES} />
            </>
          )}
          {kind === "Device" && (
            <>
              <SelectField label="Node kind" value={nodeKind} onChange={setNodeKind} options={NODE_KINDS} />
              {nodeKind === "device" && (
                <label className="create-form__field">
                  <span className="label">Capability class</span>
                  <select value={capabilityClass} onChange={(e) => setCapabilityClass(e.target.value)}>
                    <option value="">— none —</option>
                    {(classes.data ?? []).map((cc) => (
                      <option key={cc.id} value={cc.name}>
                        {cc.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <SelectField label="Mode" value={mode} onChange={setMode} options={DEVICE_MODES} />
            </>
          )}

          {error && (
            <p className="create-form__error" role="alert">
              {error}
            </p>
          )}

          <div className="create-form__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
            <Button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Inspector>
  );
}

function PrereqNotice({
  kind,
  parent,
  onSwitchKind,
  onCancel,
}: {
  kind: CreateKind;
  parent: CreateKind;
  onSwitchKind: (kind: CreateKind) => void;
  onCancel: () => void;
}) {
  return (
    <div className="create-form">
      <p className="create-form__prereq">
        A {KIND_LABEL[kind].toLowerCase()} needs a {KIND_LABEL[parent].toLowerCase()} to live in,
        and there aren&apos;t any yet. Create a {KIND_LABEL[parent].toLowerCase()} first.
      </p>
      <div className="create-form__actions">
        <Button variant="primary" onClick={() => onSwitchKind(parent)}>
          New {KIND_LABEL[parent].toLowerCase()}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---- small field primitives -------------------------------------------------

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="create-form__field">
      <span className="label">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="create-form__field">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A required parent picker (or optional, with a "— none —" choice). */
function ParentSelect({
  label,
  options,
  value,
  onChange,
  optional,
}: {
  label: string;
  options: { id: string; code: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}): ReactNode {
  return (
    <label className="create-form__field">
      <span className="label">
        {label}
        {optional ? "" : " *"}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={!optional}>
        {optional && <option value="">— none —</option>}
        {options.map((o) => (
          <option key={o.id} value={o.code}>
            {o.code} — {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
