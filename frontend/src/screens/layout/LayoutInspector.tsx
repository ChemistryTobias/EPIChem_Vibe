/**
 * Detail panel for the selected box — generic across all three levels (ADR
 * 0012). It shows the box's geometry and offers the edit-mode affordances (enter,
 * edit geometry, remove) plus its revision history. This is plan §10.2's
 * "React-side inspector" — the reason the canvas can stay on `@joint/core` alone
 * instead of needing the commercial Inspector component.
 */

import { useState } from "react";

import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { RevisionHistory } from "../topology/RevisionHistory";
import type { LevelConfig } from "./levels";

interface LayoutInspectorProps {
  level: LevelConfig;
  code: string | null;
  editable: boolean;
  onEnter: (code: string) => void;
  onEditGeometry: () => void;
  onRemoved: () => void;
  onClose: () => void;
}

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;

export function LayoutInspector({
  level,
  code,
  editable,
  onEnter,
  onEditGeometry,
  onRemoved,
  onClose,
}: LayoutInspectorProps) {
  const geom = code ? level.geometryOf(code) : null;

  if (!code || !geom) {
    return (
      <Inspector
        kind="Layout inspector"
        placeholder={
          editable
            ? `Add a ${level.childLabel}, or pick one to move, resize, enter or ${level.removeVerb.toLowerCase()} it.`
            : `Select a ${level.childLabel} to see where it sits, or click it to enter.`
        }
      />
    );
  }

  const canEnter = level.drillInto(code) !== null;

  return (
    <Inspector kind={`${level.childLabel} inspector`} title={code} subtitle={level.level} onClose={onClose}>
      {editable && (
        <BoxActions
          code={code}
          canEnter={canEnter}
          removeVerb={level.removeVerb}
          onEnter={() => onEnter(code)}
          onEditGeometry={onEditGeometry}
          onRemove={() => level.remove(code)}
          onRemoved={onRemoved}
        />
      )}

      {!editable && canEnter && (
        <div className="node-actions">
          <Button variant="primary" onClick={() => onEnter(code)}>
            Enter {code}
          </Button>
        </div>
      )}

      <FieldGroup title="Placement">
        <Field label="Position" mono>
          {m(geom.pos.x)}, {m(geom.pos.y)}
        </Field>
        <Field label="Footprint" mono>
          {m(geom.size.x)} × {m(geom.size.y)}
        </Field>
        {level.level !== "site" && (
          <Field label="Height" mono>
            {m(geom.height)}
          </Field>
        )}
      </FieldGroup>

      <RevisionHistory kind={level.childKind} code={code} />
    </Inspector>
  );
}

/**
 * Enter / edit-geometry / remove row for the selected box (edit mode). Remove is
 * a two-step inline confirm owning its own busy/error state — a hard delete can
 * come back 409 (a lab that still holds stations), which is worth showing.
 */
function BoxActions({
  code,
  canEnter,
  removeVerb,
  onEnter,
  onEditGeometry,
  onRemove,
  onRemoved,
}: {
  code: string;
  canEnter: boolean;
  removeVerb: "Delete" | "Hide";
  onEnter: () => void;
  onEditGeometry: () => void;
  onRemove: () => Promise<unknown>;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove();
      onRemoved();
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
          <span className="node-actions__prompt">
            {removeVerb} {code}?
          </span>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? `${removeVerb}…` : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {canEnter && (
            <Button variant="primary" onClick={onEnter}>
              Enter
            </Button>
          )}
          <Button onClick={onEditGeometry}>Edit geometry</Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {removeVerb}
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
