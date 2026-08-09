/**
 * Detail panel for the selected box — generic across all three levels (ADRs
 * 0012/0014). It shows the *same* registry record the Hierarchy inspector shows
 * (`NodeDetails`), so a lab/station/device reads identically wherever you select
 * it — no thinner "layout" panel, and no "Enter" button (drilling is a click on
 * the box's label). In edit mode it adds the staged affordances on top: edit
 * geometry and remove, both recorded in the draft and not written until Save.
 * This is plan §10.2's "React-side inspector" — the reason the canvas can stay
 * on `@joint/core` alone.
 */

import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { NodeDetails } from "../topology/registryDetails";
import type { ZoneShape } from "./isometric";
import type { BoxGeometry, LevelConfig } from "./levels";

interface LayoutInspectorProps {
  level: LevelConfig;
  code: string | null;
  /** Effective (draft-aware) geometry of the selected box, or null if none. */
  geom: BoxGeometry | null;
  /** Effective zones (draft-aware membership), for the "in zones" summary. */
  zones: ZoneShape[];
  /** True for a box that only exists in the draft (created, not yet saved). */
  isNew: boolean;
  editable: boolean;
  onEditGeometry: () => void;
  onRemove: () => void;
  onClose: () => void;
}

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;

export function LayoutInspector({
  level,
  code,
  geom,
  zones,
  isNew,
  editable,
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
            : `Select a ${level.childLabel} to see its record, or click its label to enter.`
        }
      />
    );
  }

  const row = level.rowOf(code);
  // Zones the box is geometrically inside (ADR 0015 / req #7) — membership is
  // computed from the footprint, so a zone drawn around a box lists it here as
  // soon as it fully encloses it, no wiring needed.
  const inZones = zones.filter((z) => z.members.includes(code)).map((z) => z.code);

  return (
    <Inspector
      kind={`${level.childLabel} inspector`}
      title={code}
      subtitle={isNew ? `${level.level} · unsaved` : level.level}
      onClose={onClose}
    >
      {editable && (
        <div className="node-actions">
          <Button onClick={onEditGeometry}>Edit geometry</Button>
          <Button variant="danger" onClick={onRemove}>
            {level.removeVerb}
          </Button>
        </div>
      )}

      {/* A saved box shows the same full registry record as the Hierarchy screen.
          A staged-new box has no row yet. Either way the placement is shown below,
          so every level — devices included (req #6) — carries its geometry. */}
      {row && <NodeDetails kind={level.childKind} row={row} childrenCodes={level.childCodesOf(code)} />}

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
        {level.zonesEnabled && (
          <Field label="In zones" mono>
            {inZones.length > 0 ? inZones.join(", ") : "—"}
          </Field>
        )}
      </FieldGroup>
    </Inspector>
  );
}
