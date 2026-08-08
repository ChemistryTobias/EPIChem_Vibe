/**
 * Detail panel for the selected box — generic across all three levels (ADRs
 * 0012/0014). It shows the box's (draft-aware) geometry and, in edit mode, the
 * staged affordances: edit geometry and remove (both recorded in the draft, not
 * written until Save). In inspect mode it offers Enter, since drilling is a level
 * change and level changes only happen in inspect mode. This is plan §10.2's
 * "React-side inspector" — the reason the canvas can stay on `@joint/core` alone.
 */

import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { RevisionHistory } from "../topology/RevisionHistory";
import type { BoxGeometry, LevelConfig } from "./levels";

interface LayoutInspectorProps {
  level: LevelConfig;
  code: string | null;
  /** Effective (draft-aware) geometry of the selected box, or null if none. */
  geom: BoxGeometry | null;
  /** True for a box that only exists in the draft (created, not yet saved). */
  isNew: boolean;
  editable: boolean;
  onEnter: (code: string) => void;
  onEditGeometry: () => void;
  onRemove: () => void;
  onClose: () => void;
}

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;

export function LayoutInspector({
  level,
  code,
  geom,
  isNew,
  editable,
  onEnter,
  onEditGeometry,
  onRemove,
  onClose,
}: LayoutInspectorProps) {
  if (!code || !geom) {
    return (
      <Inspector
        kind="Layout inspector"
        placeholder={
          editable
            ? `Add a ${level.childLabel}, or pick one to move, resize, or ${level.removeVerb.toLowerCase()} it. Nothing is written until you Save.`
            : `Select a ${level.childLabel} to see where it sits, or click its label to enter.`
        }
      />
    );
  }

  const canEnter = level.drillInto(code) !== null;

  return (
    <Inspector
      kind={`${level.childLabel} inspector`}
      title={code}
      subtitle={isNew ? `${level.level} · unsaved` : level.level}
      onClose={onClose}
    >
      {editable ? (
        <div className="node-actions">
          <Button onClick={onEditGeometry}>Edit geometry</Button>
          <Button variant="danger" onClick={onRemove}>
            {level.removeVerb}
          </Button>
        </div>
      ) : (
        canEnter && (
          <div className="node-actions">
            <Button variant="primary" onClick={() => onEnter(code)}>
              Enter {code}
            </Button>
          </div>
        )
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

      {/* A staged-new box has no persisted history yet. */}
      {!isNew && <RevisionHistory kind={level.childKind} code={code} />}
    </Inspector>
  );
}
