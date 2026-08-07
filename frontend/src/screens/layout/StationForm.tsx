/**
 * Create-or-reshape a station from the Lab Layout editor (ADRs 0009, 0010).
 *
 * Two modes, one form:
 * - "create": prefilled from a footprint drawn on the floor — collects code,
 *   name and the box, and POSTs a new station placed there.
 * - "reshape": the selected station's geometry (position, footprint, height) as
 *   editable numbers, saved with a full-replace PUT that preserves everything
 *   else off the row (`reshapeStation`).
 *
 * It sits in the right-hand inspector column, the same slot as LayoutInspector,
 * and reuses the shared form-field primitives + `.create-form` styles.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { createStation, reshapeStation } from "../../api/topology";
import type { Lab, Station } from "../../api/types";
import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { STATION_STATES } from "../topology/create/nodeCreate";
import { SelectField, TextField } from "../topology/formFields";
import type { DrawnRect } from "./isometric";

interface CreateProps {
  mode: "create";
  lab: Lab;
  rect: DrawnRect;
  onDone: () => void;
  onCancel: () => void;
}

interface ReshapeProps {
  mode: "reshape";
  lab: Lab;
  station: Station;
  zoneCode: string | null;
  onDone: () => void;
  onCancel: () => void;
}

type StationFormProps = CreateProps | ReshapeProps;

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function StationForm(props: StationFormProps) {
  const { lab, mode, onDone, onCancel } = props;
  const initial =
    mode === "create"
      ? { posX: props.rect.pos.x, posY: props.rect.pos.y, sizeX: props.rect.size.x, sizeY: props.rect.size.y, height: 0.5 }
      : {
          posX: props.station.pos_x,
          posY: props.station.pos_y,
          sizeX: props.station.size_x_m,
          sizeY: props.station.size_y_m,
          height: props.station.height_m,
        };

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("generic");
  const [posX, setPosX] = useState(String(initial.posX));
  const [posY, setPosY] = useState(String(initial.posY));
  const [sizeX, setSizeX] = useState(String(initial.sizeX));
  const [sizeY, setSizeY] = useState(String(initial.sizeY));
  const [height, setHeight] = useState(String(initial.height));
  const [state, setState] = useState<string>("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geom = () => ({
    pos_x: num(posX, initial.posX),
    pos_y: num(posY, initial.posY),
    size_x_m: num(sizeX, initial.sizeX),
    size_y_m: num(sizeY, initial.sizeY),
    height_m: num(height, initial.height),
  });

  function save() {
    if (mode === "create") {
      return createStation(code.trim(), name.trim(), {
        lab: lab.code,
        zone: null, // drawn straight onto the lab floor; zone assignment is a hierarchy edit
        kind: kind.trim() || "generic",
        capacity: 1,
        state,
        owning_group: null,
        ...geom(),
      });
    }
    return reshapeStation(props.station, lab.code, props.zoneCode, geom());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  const title = mode === "create" ? "New station" : props.station.code;
  const subtitle =
    mode === "create" ? "Drawn on the floor — press Create" : "Editing geometry — press Save";

  return (
    <Inspector kind={mode === "create" ? "Draw station" : "Edit station"} title={title} subtitle={subtitle} onClose={onCancel}>
      <form className="create-form" onSubmit={submit}>
        {mode === "create" && (
          <>
            <TextField label="Code" value={code} onChange={setCode} placeholder="ST-01" required />
            <TextField label="Name" value={name} onChange={setName} required />
            <TextField label="Kind" value={kind} onChange={setKind} placeholder="generic" />
          </>
        )}

        <TextField label="Position X (m)" value={posX} onChange={setPosX} type="number" />
        <TextField label="Position Y (m)" value={posY} onChange={setPosY} type="number" />
        <TextField label="Footprint X (m)" value={sizeX} onChange={setSizeX} type="number" />
        <TextField label="Footprint Y (m)" value={sizeY} onChange={setSizeY} type="number" />
        <TextField label="Height (m)" value={height} onChange={setHeight} type="number" />

        {mode === "create" && (
          <SelectField label="State" value={state} onChange={setState} options={STATION_STATES} />
        )}

        {error && (
          <p className="create-form__error" role="alert">
            {error}
          </p>
        )}

        <div className="create-form__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
          <Button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Inspector>
  );
}
