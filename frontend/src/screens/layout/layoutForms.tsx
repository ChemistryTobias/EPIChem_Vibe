/**
 * The two numeric forms in the layout inspector column (ADRs 0010/0012),
 * generic over the level:
 * - `GeometryForm` — the selected box's position, footprint and height, saved
 *   through `level.setGeometry` (the same write the drag and handles use).
 * - `FloorForm` — the level's own floor size and grid, saved through
 *   `level.resizeFloor`.
 *
 * Both sit in the inspector column and reuse the shared `.create-form` styles.
 * Numbers are metres in every level (the station level converts mm↔m at its
 * adapter boundary), so the labels are uniform.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { TextField } from "../topology/formFields";
import type { LevelConfig } from "./levels";

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function GeometryForm({
  level,
  code,
  onDone,
  onCancel,
}: {
  level: LevelConfig;
  code: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initial = level.geometryOf(code) ?? { pos: { x: 0, y: 0 }, size: { x: 1, y: 1 }, height: 0.5 };
  const [posX, setPosX] = useState(String(initial.pos.x));
  const [posY, setPosY] = useState(String(initial.pos.y));
  const [sizeX, setSizeX] = useState(String(initial.size.x));
  const [sizeY, setSizeY] = useState(String(initial.size.y));
  const [height, setHeight] = useState(String(initial.height));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await level.setGeometry(code, {
        pos: { x: num(posX, initial.pos.x), y: num(posY, initial.pos.y) },
        size: { x: num(sizeX, initial.size.x), y: num(sizeY, initial.size.y) },
        height: num(height, initial.height),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <Inspector kind="Edit geometry" title={code} subtitle="Position, footprint, height — press Save" onClose={onCancel}>
      <form className="create-form" onSubmit={submit}>
        <TextField label="Position X (m)" value={posX} onChange={setPosX} type="number" />
        <TextField label="Position Y (m)" value={posY} onChange={setPosY} type="number" />
        <TextField label="Footprint X (m)" value={sizeX} onChange={setSizeX} type="number" />
        <TextField label="Footprint Y (m)" value={sizeY} onChange={setSizeY} type="number" />
        {level.level !== "site" && (
          <TextField label="Height (m)" value={height} onChange={setHeight} type="number" />
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

export function FloorForm({
  level,
  onDone,
  onCancel,
}: {
  level: LevelConfig;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [width, setWidth] = useState(String(level.floor.widthU));
  const [depth, setDepth] = useState(String(level.floor.depthU));
  const [grid, setGrid] = useState(String(level.floor.gridU));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await level.resizeFloor({
        widthU: num(width, level.floor.widthU),
        depthU: num(depth, level.floor.depthU),
        gridU: num(grid, level.floor.gridU),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <Inspector kind={`Edit ${level.level} floor`} title="Canvas & grid" subtitle="Press Save" onClose={onCancel}>
      <form className="create-form" onSubmit={submit}>
        <TextField label="Floor width (m)" value={width} onChange={setWidth} type="number" />
        <TextField label="Floor depth (m)" value={depth} onChange={setDepth} type="number" />
        <TextField label="Grid size (m)" value={grid} onChange={setGrid} type="number" />
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
