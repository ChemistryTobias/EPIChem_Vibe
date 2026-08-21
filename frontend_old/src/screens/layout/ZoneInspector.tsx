/**
 * The inspector for a selected zone (ADR 0015) and the numeric form to edit its
 * rectangle. Zones are a flat 2D area at the site or lab level; membership is
 * geometric — the boxes whose footprint sits fully inside the zone — and shown
 * here. Zone edits are now **staged like boxes** (ADR 0014 model, req): dragging
 * or resizing a zone opens this editor live, Apply keeps the staged change and
 * Cancel reverts this zone, and nothing writes until the header Save.
 */

import { useEffect, useState } from "react";
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

const s3 = (v: number) => String(Math.round(v * 1e3) / 1e3);

/**
 * The live zone-rectangle editor — the zone counterpart of `GeometryForm`. It
 * opens when a zone is dragged/resized and its fields **follow the drag**
 * (`live` + `syncVersion`); Apply keeps the staged rect (greyed until something
 * changed), Cancel reverts this zone. Nothing writes until the header Save.
 */
export function ZoneRectForm({
  code,
  live,
  syncVersion,
  staged,
  onStage,
  onApply,
  onCancel,
}: {
  code: string;
  live: ZoneRect;
  syncVersion: number;
  /** Whether this zone already has a staged change, so Apply is enabled. */
  staged: boolean;
  /** Validate + stage the rectangle; returns an error to show, or null on ok. */
  onStage: (rect: ZoneRect) => string | null;
  /** Apply keeps the change *and writes it* (req) — handed the committed rect
   * directly so it doesn't depend on the not-yet-flushed draft. */
  onApply: (rect: ZoneRect) => void;
  onCancel: () => void;
}) {
  const [posX, setPosX] = useState(s3(live.pos_x));
  const [posY, setPosY] = useState(s3(live.pos_y));
  const [width, setWidth] = useState(s3(live.width_m));
  const [depth, setDepth] = useState(s3(live.depth_m));
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Resync the fields when a drag/resize pushes new values (syncVersion bumps).
  useEffect(() => {
    setPosX(s3(live.pos_x));
    setPosY(s3(live.pos_y));
    setWidth(s3(live.width_m));
    setDepth(s3(live.depth_m));
    setError(null);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setTouched(true);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const rect = {
      pos_x: num(posX, live.pos_x),
      pos_y: num(posY, live.pos_y),
      width_m: num(width, live.width_m),
      depth_m: num(depth, live.depth_m),
    };
    const err = onStage(rect);
    if (err) {
      setError(err);
      return;
    }
    onApply(rect);
  }

  return (
    <Inspector
      kind="Edit zone"
      title={code}
      subtitle="Follows the drag — Apply keeps it, Cancel reverts this zone"
      onClose={onCancel}
    >
      <form className="create-form" onSubmit={submit}>
        <TextField label="Position X (m)" value={posX} onChange={edit(setPosX)} type="number" step="any" />
        <TextField label="Position Y (m)" value={posY} onChange={edit(setPosY)} type="number" step="any" />
        <TextField label="Width (m)" value={width} onChange={edit(setWidth)} type="number" step="any" />
        <TextField label="Depth (m)" value={depth} onChange={edit(setDepth)} type="number" step="any" />
        {error && (
          <p className="create-form__error" role="alert">
            {error}
          </p>
        )}
        <div className="create-form__actions">
          <Button type="submit" variant="primary" disabled={!(staged || touched)}>
            Apply
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Inspector>
  );
}
