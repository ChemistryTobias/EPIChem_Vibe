# ADR 0011: A `virtual` flag soft-hides stations and devices from the canvas

**Extends ADR 0009 (Device-Management IA) and ADR 0010 (metric lab canvas).
Shapes delete semantics in the M2 layout editor.**

**Status:** Accepted (2026-08-07).

## Context

The layout editor (ADRs 0009/0010) lets you place stations on a lab canvas and,
now, labs on a site canvas and devices on a station canvas. It also offers a
"delete" affordance on the selected box.

A hard delete is the wrong default there. Two reasons:

- **Reversibility.** A canvas is a fast, direct-manipulation surface — an
  accidental delete of a station that holds real device configuration should be
  a single undo, not a re-creation from scratch. ADR 0004 already records a
  full snapshot on every write, so the data survives a hard delete, but nothing
  brings the row *back* on the canvas.
- **Referential safety.** A station that still holds devices can't be
  hard-deleted (the FK raises → 409). On a canvas you often want it *off the
  picture* without first re-homing everything under it.

What the editor actually wants is "hide this from the picture", not "destroy
it" — a soft-hide the registry keeps and can reverse.

## Decision

**Add a boolean `virtual` column to `Station` and `Device`, defaulting False.**
(`Device` covers modules — a module is a `Device` with `node_kind="module"`,
ADR 0007.) A virtual row:

- still exists in the registry, still lists through the read API, still records
  revisions — it is not deleted;
- is **filtered out of every layout canvas** (site, lab, station) by the
  frontend;
- flips back to visible by setting `virtual=False`, and every flip is a
  revisioned write (ADR 0004), so the history *is* the undo trail.

**The canvas "delete" sets `virtual=True`** via the normal full-replace PUT.
The **Hierarchy** screen keeps its existing hard `DELETE` — that surface is for
genuinely removing a row, and its two-step confirm + 409-on-children behaviour
is unchanged. The two deletes are deliberately different verbs on different
surfaces.

`virtual` is a plain column threaded through the standard write path
(`StationSpec`/`DeviceSpec` → `StationOut`/`DeviceOut` → `TOPOLOGY_WRITE.attrs`
/`device_values` → the hand-mirrored `types.ts`), like every other descriptor
field. It is **not** a DB-level filter or a soft-delete framework — the registry
returns virtual rows like any other; only the canvas chooses to hide them.

## Consequences

- Additive migration (`0002_virtual_flag.py`): one `Boolean NOT NULL server
  default false` column per table. `test_migrations_match_the_models` stays green
  (it compares names/types/nullability, and the model's Python-side `default=False`
  produces the same NOT NULL boolean).
- The exporter omits `virtual` when False (like `node_kind`/`quality`), so
  existing descriptor YAML is unchanged and a soft-hidden row round-trips.
- Read consumers that should ignore hidden rows must filter `virtual` themselves
  — today that's only the layout canvas. The Hierarchy tree and Device Status
  list still show them (a hidden station is still a real thing you can inspect
  and un-hide); if that turns out to be confusing, a later ADR can add a
  "show hidden" toggle rather than a server-side filter.
- Not applied to `Site`/`Lab`/`Zone`: you don't soft-hide a whole site from its
  own canvas, and the request was specifically stations, devices and modules.
