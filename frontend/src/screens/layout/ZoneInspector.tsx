/**
 * The inspector for a selected zone (ADR 0015) and the numeric form to edit its
 * rectangle. Zones are a flat 2D area at the site or lab level; membership is
 * geometric — the boxes whose footprint sits fully inside the zone — and shown
 * here. Zone writes are immediate (not part of the staged box draft), so the
 * edit/remove affordances are only offered in edit mode with a clean draft; the
 * screen enforces the clean-draft rule and reports it.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { TextField } from "../topology/formFields";
import type { ZoneRect } from "../../api/topology";
import type { ZoneShape } from "./isometric";

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;
const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function ZoneInspector({
  zone,
  childLabel,
  editable,
  busy,
  onEditRect,
  onRemove,
  onClose,
}: {
  zone: ZoneShape | null;
  /** The level's child kind ("lab"/"station"), for the membership label. */
  childLabel: string;
  editable: boolean;
  busy: boolean;
  onEditRect: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  if (!zone) {
    return <Inspector kind="Zone inspector" placeholder="Select a zone to see what falls inside it." />;
  }

  return (
    <Inspector kind="Zone inspector" title={zone.code} subtitle={zone.purpose} onClose={onClose}>
      {editable && (
        <div className="node-actions">
          <Button onClick={onEditRect} disabled={busy}>
            Edit rectangle
          </Button>
          <Button variant="danger" onClick={onRemove} disabled={busy}>
            Delete
          </Button>
        </div>
      )}

      <FieldGroup title="Area">
        <Field label="Purpose">{zone.purpose}</Field>
        <Field label="Position" mono>
          {m(zone.pos.x)}, {m(zone.pos.y)}
        </Field>
        <Field label="Size" mono>
          {m(zone.size.x)} × {m(zone.size.y)}
        </Field>
      </FieldGroup>

      <FieldGroup title={`Contains (${zone.members.length})`}>
        <Field label={`${childLabel}s fully inside`}>
          {zone.members.length ? zone.members.join(", ") : "none"}
        </Field>
      </FieldGroup>
    </Inspector>
  );
}

export function ZoneRectForm({
  code,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  code: string;
  initial: ZoneRect;
  busy: boolean;
  /** Write the rectangle; returns an error string to show, or null on success. */
  onSave: (rect: ZoneRect) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [posX, setPosX] = useState(String(initial.pos_x));
  const [posY, setPosY] = useState(String(initial.pos_y));
  const [width, setWidth] = useState(String(initial.width_m));
  const [depth, setDepth] = useState(String(initial.depth_m));
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const err = await onSave({
      pos_x: num(posX, initial.pos_x),
      pos_y: num(posY, initial.pos_y),
      width_m: num(width, initial.width_m),
      depth_m: num(depth, initial.depth_m),
    });
    setError(err);
  }

  return (
    <Inspector kind="Edit zone" title={code} subtitle="Rectangle on this floor" onClose={onCancel}>
      <form className="create-form" onSubmit={submit}>
        <TextField label="Position X (m)" value={posX} onChange={setPosX} type="number" step="any" />
        <TextField label="Position Y (m)" value={posY} onChange={setPosY} type="number" step="any" />
        <TextField label="Width (m)" value={width} onChange={setWidth} type="number" step="any" />
        <TextField label="Depth (m)" value={depth} onChange={setDepth} type="number" step="any" />
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
