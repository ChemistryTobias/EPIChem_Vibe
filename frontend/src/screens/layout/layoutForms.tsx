/**
 * The two numeric forms in the layout inspector column (ADRs 0010/0012/0014),
 * generic over the level:
 * - `GeometryForm` — the selected box's position, footprint and height.
 * - `FloorForm` — the level's own floor size and grid.
 *
 * In the staged editor (ADR 0014) neither form writes to the API: each hands its
 * numbers to `onStage`, which validates + records them in the draft (returning an
 * error string to show, or null on success). The actual write happens later, on
 * Save. Numbers are metres at every level (the station level converts mm↔m at its
 * adapter boundary), so the labels are uniform.
 */

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { TextField } from "../topology/formFields";
import type { BoxGeometry, FloorGeometry } from "./levels";

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Trim float noise for display to at most 3 decimals (req: max precision 3),
 * without hiding real off-grid values. */
const show = (v: number) => String(Math.round(v * 1e3) / 1e3);

/**
 * The live geometry editor (req #5). It opens automatically when a box is dragged
 * or handle-resized and its fields **follow the drag** — `live` is the box's
 * current geometry and `syncVersion` bumps whenever a drag pushes new numbers in,
 * which is when the fields resync (so typing between drags isn't clobbered).
 * **Apply** keeps the staged change; **Cancel** reverts this box only.
 */
export function GeometryForm({
  code,
  live,
  syncVersion,
  showHeight,
  staged,
  onStage,
  onApply,
  onCancel,
}: {
  code: string;
  live: BoxGeometry;
  syncVersion: number;
  showHeight: boolean;
  /** Whether this box already has a staged change (a drag/resize) — so Apply is
   * enabled even before the fields are touched. Combined with local edits. */
  staged: boolean;
  /** Validate + stage the geometry; return an error to show, or null on success. */
  onStage: (geom: BoxGeometry) => string | null;
  onApply: () => void;
  onCancel: () => void;
}) {
  const [posX, setPosX] = useState(show(live.pos.x));
  const [posY, setPosY] = useState(show(live.pos.y));
  const [sizeX, setSizeX] = useState(show(live.size.x));
  const [sizeY, setSizeY] = useState(show(live.size.y));
  const [height, setHeight] = useState(show(live.height));
  const [error, setError] = useState<string | null>(null);
  // Whether the fields have been typed since the last resync — so Apply can grey
  // out until something actually changed (req: like the Save-all button).
  const [touched, setTouched] = useState(false);

  // Resync the fields to the live geometry when a drag/resize pushes new values
  // (syncVersion bumps). Typing doesn't bump it, so manual edits survive.
  useEffect(() => {
    setPosX(show(live.pos.x));
    setPosY(show(live.pos.y));
    setSizeX(show(live.size.x));
    setSizeY(show(live.size.y));
    setHeight(show(live.height));
    setError(null);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  // Field setter that also flags the form as touched.
  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setTouched(true);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = onStage({
      pos: { x: num(posX, live.pos.x), y: num(posY, live.pos.y) },
      size: { x: num(sizeX, live.size.x), y: num(sizeY, live.size.y) },
      height: num(height, live.height),
    });
    if (problem) {
      setError(problem);
      return;
    }
    onApply();
  }

  return (
    <Inspector
      kind="Edit geometry"
      title={code}
      subtitle="Follows the drag — Apply keeps it, Cancel reverts this box"
      onClose={onCancel}
    >
      <form className="create-form" onSubmit={submit}>
        <TextField label="Position X (m)" value={posX} onChange={edit(setPosX)} type="number" step="any" />
        <TextField label="Position Y (m)" value={posY} onChange={edit(setPosY)} type="number" step="any" />
        <TextField label="Footprint X (m)" value={sizeX} onChange={edit(setSizeX)} type="number" step="any" />
        <TextField label="Footprint Y (m)" value={sizeY} onChange={edit(setSizeY)} type="number" step="any" />
        {showHeight && (
          <TextField label="Height (m)" value={height} onChange={edit(setHeight)} type="number" step="any" />
        )}
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

export function FloorForm({
  levelName,
  initial,
  onStage,
  onDone,
  onCancel,
}: {
  levelName: string;
  initial: FloorGeometry;
  onStage: (floor: FloorGeometry) => string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [width, setWidth] = useState(String(initial.widthU));
  const [depth, setDepth] = useState(String(initial.depthU));
  const [grid, setGrid] = useState(String(initial.gridU));
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = onStage({
      widthU: num(width, initial.widthU),
      depthU: num(depth, initial.depthU),
      gridU: num(grid, initial.gridU),
    });
    if (problem) {
      setError(problem);
      return;
    }
    onDone();
  }

  return (
    <Inspector
      kind={`Edit ${levelName}`}
      title="Canvas & grid"
      subtitle="Floor size and grid — staged until you Save"
      onClose={onCancel}
    >
      <form className="create-form" onSubmit={submit}>
        <TextField label="Floor width (m)" value={width} onChange={setWidth} type="number" step="any" />
        <TextField label="Floor depth (m)" value={depth} onChange={setDepth} type="number" step="any" />
        <TextField label="Grid size (m)" value={grid} onChange={setGrid} type="number" step="any" />
        {error && (
          <p className="create-form__error" role="alert">
            {error}
          </p>
        )}
        <div className="create-form__actions">
          <Button type="submit" variant="primary">
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
