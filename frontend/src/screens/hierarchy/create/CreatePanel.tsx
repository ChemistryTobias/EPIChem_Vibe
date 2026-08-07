/**
 * The creation panel for the Hierarchy screen (ADR 0009): a blank-slate-aware,
 * New-Device-first flow.
 *
 * A panel above the tree rather than a modal — same call the sample form makes
 * (no focus-trap/scroll-lock to get wrong, and the tree stays visible). What's
 * different here is that entities have prerequisites: a device needs a station,
 * a station a lab, a lab a site (ADR 0007). `buildCreateFlow` (nodeCreate.ts)
 * turns "New Device" on an empty registry into an ordered walk — Site → Lab →
 * Station → Device — and collapses it to a single step once the scaffolding
 * exists. Each intermediate step locks the thing it just created as the next
 * step's parent; steps whose prerequisite already exists show a picker instead.
 */

import { useCallback, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { listCapabilityClasses, createDevice } from "../../../api/devices";
import { createLab, createSite, createStation, createZone } from "../../../api/topology";
import type { TopologySnapshot } from "../../../api/topology";
import { Button } from "../../../components/Button";
import { useAsync } from "../../../hooks/useAsync";
import {
  ATMOSPHERES,
  DEVICE_MODES,
  ENVIRONMENT_CLASSES,
  KIND_LABEL,
  NODE_KINDS,
  OCCUPANCIES,
  STATION_STATES,
  buildCreateFlow,
} from "./nodeCreate";
import type { CreateKind } from "./nodeCreate";

import "./CreatePanel.css";

/** Codes of the things created earlier in the current flow, by kind. */
type Locked = Partial<Record<CreateKind, string>>;

interface CreatePanelProps {
  target: CreateKind;
  snapshot: TopologySnapshot;
  /** Re-fetch the tree after each successful create. */
  onCreated: () => void;
  /** The flow finished (or was cancelled): close the panel. */
  onClose: () => void;
}

export function CreatePanel({ target, snapshot, onCreated, onClose }: CreatePanelProps) {
  // The flow is fixed when the panel opens, from the counts at that moment.
  const [flow] = useState(() =>
    buildCreateFlow(target, {
      Site: snapshot.sites.length,
      Lab: snapshot.labs.length,
      Station: snapshot.stations.length,
    }),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [locked, setLocked] = useState<Locked>({});

  const step = flow[stepIndex];

  // A create succeeded: refresh the tree, remember what we made as the next
  // step's locked parent, and advance — or close if this was the last step.
  const handleCreated = (kind: CreateKind, code: string) => {
    onCreated();
    if (stepIndex + 1 < flow.length) {
      setLocked((prev) => ({ ...prev, [kind]: code }));
      setStepIndex((i) => i + 1);
    } else {
      onClose();
    }
  };

  return (
    <section className="node-create" aria-label={`Create ${KIND_LABEL[step]}`}>
      <div className="node-create__head">
        <p className="label node-create__title">
          {flow.length > 1
            ? `New ${KIND_LABEL[target].toLowerCase()} — step ${stepIndex + 1} of ${flow.length}: create a ${KIND_LABEL[step].toLowerCase()}`
            : `New ${KIND_LABEL[step].toLowerCase()}`}
        </p>
        {flow.length > 1 && stepIndex === 0 && (
          <p className="node-create__hint muted">
            A {KIND_LABEL[target].toLowerCase()} needs somewhere to live. We&apos;ll set up the
            missing pieces first, then create it.
          </p>
        )}
      </div>

      <StepForm key={step} kind={step} snapshot={snapshot} locked={locked} onCreated={handleCreated} onCancel={onClose} />
    </section>
  );
}

// ---- per-step form dispatch -------------------------------------------------

interface StepFormProps {
  kind: CreateKind;
  snapshot: TopologySnapshot;
  locked: Locked;
  onCreated: (kind: CreateKind, code: string) => void;
  onCancel: () => void;
}

function StepForm({ kind, snapshot, locked, onCreated, onCancel }: StepFormProps) {
  switch (kind) {
    case "Site":
      return <SiteForm onCreated={onCreated} onCancel={onCancel} />;
    case "Lab":
      return <LabForm snapshot={snapshot} locked={locked} onCreated={onCreated} onCancel={onCancel} />;
    case "Zone":
      return <ZoneForm snapshot={snapshot} locked={locked} onCreated={onCreated} onCancel={onCancel} />;
    case "Station":
      return <StationForm snapshot={snapshot} locked={locked} onCreated={onCreated} onCancel={onCancel} />;
    case "Device":
      return <DeviceForm snapshot={snapshot} locked={locked} onCreated={onCreated} onCancel={onCancel} />;
  }
}

// ---- shared form scaffolding ------------------------------------------------

/**
 * Manages the fields every kind shares (code, name) plus submit/busy/error, so
 * each kind-specific form is just its extra fields and a spec builder. The
 * `submit` callback is handed the trimmed code/name and returns the created
 * row; its own extra fields come in through the closure.
 */
function useCreateForm(
  kind: CreateKind,
  submit: (code: string, name: string) => Promise<{ code: string }>,
  onCreated: (kind: CreateKind, code: string) => void,
) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await submit(code.trim(), name.trim());
      onCreated(kind, created.code);
    } catch (cause) {
      // The backend's problem+json title/detail is the useful message (a
      // duplicate code, an unresolved reference); surface it verbatim.
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return { code, setCode, name, setName, busy, error, run };
}

function FormShell({
  kind,
  form,
  onCancel,
  children,
}: {
  kind: CreateKind;
  form: ReturnType<typeof useCreateForm>;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <form className="node-create__form" onSubmit={form.run}>
      <div className="node-create__grid">
        <label>
          <span className="label">Code *</span>
          <input
            value={form.code}
            onChange={(e) => form.setCode(e.target.value)}
            placeholder={`${kind.toUpperCase()}-01`}
            required
          />
        </label>
        <label className="node-create__wide">
          <span className="label">Name *</span>
          <input value={form.name} onChange={(e) => form.setName(e.target.value)} required />
        </label>
        {children}
      </div>

      {form.error && (
        <p className="node-create__error" role="alert">
          {form.error}
        </p>
      )}

      <div className="node-create__actions">
        <Button type="submit" variant="primary" disabled={form.busy}>
          {form.busy ? "Creating…" : `Create ${KIND_LABEL[kind].toLowerCase()}`}
        </Button>
        <Button type="button" onClick={onCancel} disabled={form.busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A parent reference: fixed text when the parent was just created in this flow,
 * a picker of existing rows otherwise. `value`/`onChange` are only used in the
 * picker case.
 */
function ParentField({
  label,
  lockedCode,
  options,
  value,
  onChange,
  optional,
}: {
  label: string;
  lockedCode: string | undefined;
  options: { code: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  if (lockedCode) {
    return (
      <label>
        <span className="label">{label}</span>
        <span className="node-create__locked mono" title="Created in this flow">
          {lockedCode}
        </span>
      </label>
    );
  }
  return (
    <label>
      <span className="label">
        {label}
        {optional ? "" : " *"}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={!optional}>
        {optional && <option value="">— none —</option>}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} — {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// A form's onCancel is threaded through the returned form object for FormShell.
type FormChildProps = {
  snapshot: TopologySnapshot;
  locked: Locked;
  onCreated: (kind: CreateKind, code: string) => void;
  onCancel: () => void;
};

// ---- Site -------------------------------------------------------------------

function SiteForm({
  onCreated,
  onCancel,
}: {
  onCreated: (kind: CreateKind, code: string) => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("");
  const form = useCreateForm(
    "Site",
    (code, name) =>
      createSite(code, name, {
        address: address.trim() || null,
        timezone: timezone.trim() || null,
      }),
    onCreated,
  );
  return (
    <FormShell kind="Site" form={form} onCancel={onCancel}>
      <label>
        <span className="label">Address</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label>
        <span className="label">Timezone</span>
        <input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Europe/Berlin"
        />
      </label>
    </FormShell>
  );
}

// ---- Lab --------------------------------------------------------------------

function LabForm({ snapshot, locked, onCreated, onCancel }: FormChildProps) {
  const [site, setSite] = useState("");
  const [room, setRoom] = useState("");
  const [envClass, setEnvClass] = useState<string>(ENVIRONMENT_CLASSES[0]);
  const form = useCreateForm(
    "Lab",
    (code, name) =>
      createLab(code, name, {
        site: locked.Site ?? site,
        room_number: room.trim() || null,
        environment_class: envClass,
      }),
    onCreated,
  );
  return (
    <FormShell kind="Lab" form={form} onCancel={onCancel}>
      <ParentField
        label="Site"
        lockedCode={locked.Site}
        options={snapshot.sites}
        value={site}
        onChange={setSite}
      />
      <label>
        <span className="label">Room number</span>
        <input value={room} onChange={(e) => setRoom(e.target.value)} />
      </label>
      <label>
        <span className="label">Environment class</span>
        <select value={envClass} onChange={(e) => setEnvClass(e.target.value)}>
          {ENVIRONMENT_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </FormShell>
  );
}

// ---- Zone -------------------------------------------------------------------

function ZoneForm({ snapshot, locked, onCreated, onCancel }: FormChildProps) {
  const [lab, setLab] = useState("");
  const [atmosphere, setAtmosphere] = useState<string>(ATMOSPHERES[0]);
  const [occupancy, setOccupancy] = useState<string>("shared");
  const form = useCreateForm(
    "Zone",
    (code, name) =>
      createZone(code, name, {
        lab: locked.Lab ?? lab,
        atmosphere,
        occupancy,
      }),
    onCreated,
  );
  return (
    <FormShell kind="Zone" form={form} onCancel={onCancel}>
      <ParentField
        label="Lab"
        lockedCode={locked.Lab}
        options={snapshot.labs}
        value={lab}
        onChange={setLab}
      />
      <label>
        <span className="label">Atmosphere</span>
        <select value={atmosphere} onChange={(e) => setAtmosphere(e.target.value)}>
          {ATMOSPHERES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Occupancy</span>
        <select value={occupancy} onChange={(e) => setOccupancy(e.target.value)}>
          {OCCUPANCIES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    </FormShell>
  );
}

// ---- Station ----------------------------------------------------------------

function StationForm({ snapshot, locked, onCreated, onCancel }: FormChildProps) {
  const [lab, setLab] = useState("");
  const [zone, setZone] = useState("");
  const [kind, setKind] = useState("generic");
  const [capacity, setCapacity] = useState("1");
  const [state, setState] = useState<string>("active");
  // Only zones under the chosen lab are valid parents; while the lab is locked
  // we can't cheaply filter (the snapshot is by id), so offer all — the backend
  // still validates the pairing.
  const form = useCreateForm(
    "Station",
    (code, name) =>
      createStation(code, name, {
        lab: locked.Lab ?? lab,
        zone: zone.trim() || null,
        kind: kind.trim() || "generic",
        capacity: Number(capacity) || 1,
        state,
        owning_group: null,
      }),
    onCreated,
  );
  return (
    <FormShell kind="Station" form={form} onCancel={onCancel}>
      <ParentField
        label="Lab"
        lockedCode={locked.Lab}
        options={snapshot.labs}
        value={lab}
        onChange={setLab}
      />
      <ParentField
        label="Zone"
        lockedCode={undefined}
        options={snapshot.zones}
        value={zone}
        onChange={setZone}
        optional
      />
      <label>
        <span className="label">Kind</span>
        <input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="generic" />
      </label>
      <label>
        <span className="label">Capacity</span>
        <input
          type="number"
          min="1"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </label>
      <label>
        <span className="label">State</span>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          {STATION_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </FormShell>
  );
}

// ---- Device -----------------------------------------------------------------

function DeviceForm({ snapshot, locked, onCreated, onCancel }: FormChildProps) {
  const [station, setStation] = useState("");
  const [nodeKind, setNodeKind] = useState<string>("device");
  const [capabilityClass, setCapabilityClass] = useState("");
  const [mode, setMode] = useState<string>("read_write");

  const classes = useAsync(useCallback(() => listCapabilityClasses(), []));

  const form = useCreateForm(
    "Device",
    (code, name) =>
      createDevice({
        code,
        name,
        node_kind: nodeKind,
        // A passive module promises no capability (ADR 0007); a device may still
        // be registered without one.
        capability_class: nodeKind === "module" ? null : capabilityClass || null,
        station: locked.Station ?? (station || null),
        operational_mode: mode,
      }),
    onCreated,
  );

  return (
    <FormShell kind="Device" form={form} onCancel={onCancel}>
      <ParentField
        label="Station"
        lockedCode={locked.Station}
        options={snapshot.stations}
        value={station}
        onChange={setStation}
      />
      <label>
        <span className="label">Node kind</span>
        <select value={nodeKind} onChange={(e) => setNodeKind(e.target.value)}>
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {nodeKind === "device" && (
        <label>
          <span className="label">Capability class</span>
          <select
            value={capabilityClass}
            onChange={(e) => setCapabilityClass(e.target.value)}
          >
            <option value="">— none —</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="label">Mode</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {DEVICE_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </FormShell>
  );
}
