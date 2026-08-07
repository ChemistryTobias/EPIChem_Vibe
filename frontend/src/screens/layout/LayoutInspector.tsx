/**
 * Detail panel for the selected station: where it is, what it accepts, and
 * whatever device is bound to it.
 *
 * This is plan §10.2's "React-side inspector" — the reason the canvas can
 * stay on `@joint/core` alone instead of needing the commercial Inspector
 * component.
 */

import { useState } from "react";

import { deleteNode } from "../../api/topology";
import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import { deviceTone } from "../devices/deviceTone";
import type { PlacedStation } from "./isometric";

interface LayoutInspectorProps {
  placed: PlacedStation | null;
  labCode: string;
  onClose: () => void;
  /** Edit mode: offer geometry-edit and delete affordances. */
  editable?: boolean;
  onEditGeometry?: () => void;
  onDeleted?: () => void;
}

export function LayoutInspector({
  placed,
  labCode,
  onClose,
  editable = false,
  onEditGeometry,
  onDeleted,
}: LayoutInspectorProps) {
  if (!placed) {
    return (
      <Inspector
        kind="Layout inspector"
        placeholder={
          editable
            ? "Drag on the floor to draw a new station, or pick one to move, resize or delete it."
            : "Select a station on the floor plan to see what's there."
        }
      />
    );
  }

  const { station, device } = placed;

  return (
    <Inspector
      kind="Station inspector"
      title={station.name}
      subtitle={station.code}
      onClose={onClose}
    >
      {editable && onEditGeometry && onDeleted && (
        <StationActions code={station.code} onEditGeometry={onEditGeometry} onDeleted={onDeleted} />
      )}

      <FieldGroup title="Position">
        <Field label="Lab" mono>
          {labCode}
        </Field>
        <Field label="Position" mono>
          {station.pos_x} m, {station.pos_y} m
        </Field>
        <Field label="Footprint" mono>
          {station.size_x_m} × {station.size_y_m} m
        </Field>
        <Field label="Height" mono>
          {station.height_m} m
        </Field>
      </FieldGroup>

      <FieldGroup title="Station">
        <Field label="Kind">{station.kind}</Field>
        <Field label="Capacity" mono>
          {station.capacity}
        </Field>
        <Field label="Accepted labware">
          {station.accepted_labware_types.length
            ? station.accepted_labware_types.join(", ")
            : null}
        </Field>
      </FieldGroup>

      <FieldGroup title="Device">
        {device ? (
          <>
            <Field label="Code" mono>
              {device.code}
            </Field>
            <Field label="Name">{device.name}</Field>
            <Field label="Mode">
              <StatusDot tone={deviceTone(device.operational_mode)} label={device.operational_mode} />
            </Field>
            <Field label="Capabilities">
              {device.capabilities.length ? device.capabilities.join(", ") : null}
            </Field>
            <Field label="Transport" mono>
              {device.transport_protocol}
            </Field>
          </>
        ) : (
          <p className="inspector__note muted">
            No device bound to this station. Bind one by setting{" "}
            <code className="mono">spec.location.station</code> on a device descriptor.
          </p>
        )}
      </FieldGroup>

      {/* Honest about what this view can't show yet. */}
      <FieldGroup title="Not shown">
        <p className="inspector__note muted">
          Live status, sample occupancy, transport routes and utilisation are §10.3 layers that
          need the M2 device plane — there is no live state to draw yet.
        </p>
      </FieldGroup>
    </Inspector>
  );
}

/**
 * Edit-geometry / delete row for the selected station (edit mode). Delete is a
 * two-step inline confirm owning its own busy/error state — a 409 comes back if
 * the station still holds devices, which is worth showing, not swallowing.
 */
function StationActions({
  code,
  onEditGeometry,
  onDeleted,
}: {
  code: string;
  onEditGeometry: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteNode("Station", code);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="node-actions">
      {confirming ? (
        <>
          <span className="node-actions__prompt">Delete {code}?</span>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? "Deleting…" : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button variant="primary" onClick={onEditGeometry}>
            Edit geometry
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </>
      )}
      {error && (
        <p className="create-form__error node-actions__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
