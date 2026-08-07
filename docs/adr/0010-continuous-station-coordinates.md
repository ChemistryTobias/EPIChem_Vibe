# ADR 0010: The lab is a metric canvas; stations are boxes placed on it in metres

**Refines ADR 0007 (grid moved onto `Lab`; `Station` gained a position) and
realises ADR 0009's "stations/zones as snap-but-not-bound tiles". Shapes the M2
lab-layout editor.**

**Status:** Accepted (2026-08-07).

## Context

ADR 0007 moved the isometric grid onto `Lab` and gave `Station` a position on
it. M1's implementation stored the lab grid as an integer **cell count**
(`Lab.grid_cols`, `grid_rows`) and the station position as integer **cell
indices** (`Station.grid_col`, `grid_row`) — a station *is* a cell, hard-bound to
the raster, and the lab has no physical size at all.

That is neither what a real floor is nor what ADR 0009's editor needs. A lab is a
room with metric dimensions; the editor the user asked for works like a
vector-graphics program — **you set the canvas size, then the grid size**, and
you drag boxes that *snap to the grid but aren't bound to it*. None of that is
expressible in dimensionless cell counts.

## Decision

**Everything in the lab layout is metres.**

- **`Lab` becomes a metric canvas.** `grid_cols`/`grid_rows` are replaced by:
  - `width_m: float` — floor width (metres, the canvas X extent),
  - `depth_m: float` — floor depth (metres, the canvas Y extent),
  - `grid_size_m: float` — the raster spacing (metres between grid lines).

  The number of guide cells is *derived* (`width_m / grid_size_m`), not stored —
  exactly the vector-editor model: canvas size and grid spacing are the inputs.

- **`Station` becomes a box placed on that canvas, in metres.**
  `grid_col`/`grid_row`/`stack_height` are replaced by:
  - `pos_x: float`, `pos_y: float` — the station's position on the floor, in
    metres from the lab origin. Continuous: the editor snaps `pos` to the nearest
    `grid_size_m` multiple by default, but any value is valid (snap-but-not-bound).
  - `size_x_m: float`, `size_y_m: float` — the station's footprint (metres) — the
    square the user draws.
  - `height_m: float` — the isometric box height (metres), a continuous drag
    handle (the netbox-map-style adjustable box height), not a discrete step.

- **Placement validation stays soft**, consistent with the rest of the topology
  model (ADR 0007: enums validated at the descriptor layer, not as DB
  constraints). A station outside the canvas, or overlapping another, is an
  editor *warning*, not a rejected write — the registry stores what it is told.

- **Zones keep classification only for now** (atmosphere/occupancy/hazard). Giving
  zones a drawable metric footprint is a follow-up on this same model, not part of
  this change.

## Consequences

- Fresh-schema change, no data migration (ADR 0007: there is no production data).
  The single initial Alembic migration is regenerated so
  `test_migrations_match_the_models` stays green; the new columns are `Float`.
- The descriptor interchange (`LabSpec`, `StationSpec`) and the API responses
  (`LabOut`, `StationOut`) change field names/types; the hand-mirrored
  `frontend/src/api/types.ts` follows (CLAUDE.md convention).
- The isometric geometry (`frontend/.../isometric.ts`) stops working in cell
  indices and works in metres: a metres→screen projection scaled by `grid_size_m`,
  with the raster drawn from `width_m`/`depth_m`/`grid_size_m`. Fractional metre
  positions render with no special-casing.
- **The example descriptor set is corrected to match ADR 0007's own example**
  (not a new decision — a fix): the two instrument-position "stations" (Hotplate
  Position, Stirrer Position) were a category error under ADR 0007, where *a
  station is a group of ≥1 device*. They collapse into one **Spincoating Robot**
  station (`SPINBOT`), and the hotplate and stirrer stay **devices**, reparented
  under it — the SpinBot rack grouping its instruments, exactly as ADR 0007
  described.
- This unblocks the layout-editor slice (metric canvas, grid-size control, free
  drag with soft snap, box-height handles, per-station device/module sub-layout)
  without a further schema change.

## Alternatives considered

- **Keep dimensionless cell counts, fake metres in the client.** Rejected: the
  registry is the source of truth (ADR 0004); a size the backend can't store is a
  size that doesn't survive a reload, and a lab genuinely *has* metric dimensions.
- **Store the derived cell counts alongside the metric size.** Rejected as
  redundant state that can drift — `width_m / grid_size_m` is cheap and always
  correct; the client derives it when it needs to draw the raster.
- **Give stations millimetre poses like devices already have (`pose.*_mm`).**
  Rejected: device pose is a fine-grained 3D placement *within* a station; the
  station's own floor position is a coarser 2D metre coordinate on the lab canvas.
  Different frames, kept distinct.
