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

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { TextField } from "../topology/formFields";
import type { BoxGeometry, FloorGeometry } from "./levels";

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function GeometryForm({
  code,
  initial,
  showHeight,
  onStage,
  onDone,
  onCancel,
}: {
  code: string;
  initial: BoxGeometry;
  showHeight: boolean;
  /** Validate + stage the geometry; return an error to show, or null on success. */
  onStage: (geom: BoxGeometry) => string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [posX, setPosX] = useState(String(initial.pos.x));
  const [posY, setPosY] = useState(String(initial.pos.y));
  const [sizeX, setSizeX] = useState(String(initial.size.x));
  const [sizeY, setSizeY] = useState(String(initial.size.y));
  const [height, setHeight] = useState(String(initial.height));
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = onStage({
      pos: { x: num(posX, initial.pos.x), y: num(posY, initial.pos.y) },
      size: { x: num(sizeX, initial.size.x), y: num(sizeY, initial.size.y) },
      height: num(height, initial.height),
    });
    if (problem) {
      setError(problem);
      return;
    }
    onDone();
  }

  return (
    <Inspector
      kind="Edit geometry"
      title={code}
      subtitle="Position, footprint, height — staged until you Save"
      onClose={onCancel}
    >
      <form className="create-form" onSubmit={submit}>
        <TextField label="Position X (m)" value={posX} onChange={setPosX} type="number" step="any" />
        <TextField label="Position Y (m)" value={posY} onChange={setPosY} type="number" step="any" />
        <TextField label="Footprint X (m)" value={sizeX} onChange={setSizeX} type="number" step="any" />
        <TextField label="Footprint Y (m)" value={sizeY} onChange={setSizeY} type="number" step="any" />
        {showHeight && (
          <TextField label="Height (m)" value={height} onChange={setHeight} type="number" step="any" />
        )}
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
