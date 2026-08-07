/**
 * Edit the lab's metric canvas from the Lab Layout editor (ADR 0010): the floor
 * size (width_m × depth_m) and the grid spacing (grid_size_m). Saved with a
 * full-replace PUT via `resizeLabCanvas`, which preserves the lab's descriptive
 * fields (room, environment class, access group) off the row.
 *
 * Sits in the inspector column; reuses the shared form primitives.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { resizeLabCanvas } from "../../api/topology";
import type { Lab } from "../../api/types";
import { Button } from "../../components/Button";
import { Inspector } from "../../components/Inspector";
import { TextField } from "../topology/formFields";

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function LabCanvasForm({
  lab,
  siteCode,
  onDone,
  onCancel,
}: {
  lab: Lab;
  /** The lab's site code — the row only carries site_id. */
  siteCode: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [width, setWidth] = useState(String(lab.width_m));
  const [depth, setDepth] = useState(String(lab.depth_m));
  const [grid, setGrid] = useState(String(lab.grid_size_m));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resizeLabCanvas(lab, siteCode, {
        width_m: num(width, lab.width_m),
        depth_m: num(depth, lab.depth_m),
        grid_size_m: num(grid, lab.grid_size_m),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <Inspector kind="Edit lab" title={lab.code} subtitle="Canvas & grid — press Save" onClose={onCancel}>
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
