/**
 * Editing a hierarchy node in the right-hand inspector (ADR 0009), the sibling
 * of CreateInspector: the same per-kind form, prefilled from the selected row,
 * saved with a full-replace PUT.
 *
 * Only Site/Lab/Zone/Station are editable here. A device's full-replace spec
 * carries transport/ophyd/network/module-parent config whose faithful
 * reconstruction belongs with the Device Status screen (see `deleteDevice`'s
 * note in `api/devices.ts`), so the inspector offers a device delete + history
 * but not an edit.
 *
 * The `code` is the stable identity and stays read-only — a rename edits the
 * human-readable name only. Fields the form doesn't show (a lab's canvas
 * geometry, a station's box) are preserved by the `*EditSpec` builders in
 * `api/topology.ts`, not by this component.
 */

import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  updateLab,
  updateSite,
  updateStation,
  updateZone,
} from "../../api/topology";
import type { TopologySnapshot } from "../../api/topology";
import type { Lab, Site, Station, Zone } from "../../api/types";
import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import {
  ATMOSPHERES,
  ENVIRONMENT_CLASSES,
  OCCUPANCIES,
  STATION_STATES,
} from "./create/nodeCreate";
import { ParentSelect, SelectField, TextField } from "./formFields";
import type { TreeNode } from "./topologyTree";

/** The kinds this inspector can edit — everything but Device. */
type EditableKind = "Site" | "Lab" | "Zone" | "Station";

interface EditInspectorProps {
  node: TreeNode & { kind: EditableKind };
  snapshot: TopologySnapshot;
  /** Saved successfully: reload and keep the (possibly renamed) node selected. */
  onSaved: () => void;
  onCancel: () => void;
}

const codeOf = (rows: { id: string; code: string }[], id: string | null) =>
  (id === null ? "" : (rows.find((r) => r.id === id)?.code ?? ""));

export function EditInspector({ node, snapshot, onSaved, onCancel }: EditInspectorProps) {
  const { kind } = node;

  // Prefill every field from the row; each kind reads only the ones it shows.
  const [name, setName] = useState(node.name);
  const [address, setAddress] = useState(() => (node.row as Site).address ?? "");
  const [timezone, setTimezone] = useState(() => (node.row as Site).timezone ?? "");
  const [site, setSite] = useState(() => codeOf(snapshot.sites, (node.row as Lab).site_id ?? null));
  const [lab, setLab] = useState(() => codeOf(snapshot.labs, (node.row as Zone | Station).lab_id ?? null));
  const [zone, setZone] = useState(() => codeOf(snapshot.zones, (node.row as Station).zone_id ?? null));
  const [room, setRoom] = useState(() => (node.row as Lab).room_number ?? "");
  const [envClass, setEnvClass] = useState(() => (node.row as Lab).environment_class ?? ENVIRONMENT_CLASSES[0]);
  const [atmosphere, setAtmosphere] = useState(() => (node.row as Zone).atmosphere ?? ATMOSPHERES[0]);
  const [occupancy, setOccupancy] = useState(() => (node.row as Zone).occupancy ?? "shared");
  const [stationKind, setStationKind] = useState(() => (node.row as Station).kind ?? "generic");
  const [capacity, setCapacity] = useState(() => String((node.row as Station).capacity ?? 1));
  const [stationState, setStationState] = useState(() => (node.row as Station).state ?? "active");
  const [owningGroup, setOwningGroup] = useState(() => (node.row as Station).owning_group ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zonesInLab = useMemo(() => {
    const labRow = snapshot.labs.find((l) => l.code === lab);
    return labRow ? snapshot.zones.filter((z) => z.lab_id === labRow.id) : [];
  }, [snapshot, lab]);

  function save() {
    const n = name.trim();
    switch (kind) {
      case "Site":
        return updateSite(node.row as Site, {
          name: n,
          address: address.trim() || null,
          timezone: timezone.trim() || null,
        });
      case "Lab":
        return updateLab(node.row as Lab, {
          name: n,
          site,
          room_number: room.trim() || null,
          environment_class: envClass,
        });
      case "Zone":
        return updateZone(node.row as Zone, { name: n, lab, atmosphere, occupancy });
      case "Station":
        return updateStation(node.row as Station, {
          name: n,
          lab,
          zone: zone || null,
          kind: stationKind.trim() || "generic",
          capacity: Number(capacity) || 1,
          state: stationState,
          owning_group: owningGroup.trim() || null,
        });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <Inspector
      kind={`Edit ${kind.toLowerCase()}`}
      title={node.code}
      subtitle="Editing — press Save to write"
      onClose={onCancel}
    >
      <form className="create-form" onSubmit={submit}>
        <TextField label="Code" value={node.code} onChange={() => {}} />
        <TextField label="Name" value={name} onChange={setName} required />

        {kind === "Lab" && (
          <ParentSelect label="Site" options={snapshot.sites} value={site} onChange={setSite} />
        )}
        {kind === "Zone" && (
          <ParentSelect label="Lab" options={snapshot.labs} value={lab} onChange={setLab} />
        )}
        {kind === "Station" && (
          <>
            <ParentSelect label="Lab" options={snapshot.labs} value={lab} onChange={setLab} />
            <ParentSelect label="Zone" options={zonesInLab} value={zone} onChange={setZone} optional />
          </>
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
            <TextField label="Owning group" value={owningGroup} onChange={setOwningGroup} />
          </>
        )}

        {error && (
          <p className="create-form__error" role="alert">
            {error}
          </p>
        )}

        <div className="create-form__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Inspector>
  );
}
