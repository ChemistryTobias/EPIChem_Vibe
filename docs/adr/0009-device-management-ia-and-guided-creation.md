# ADR 0009: "Device Management" as the top section — nested list + status + layout, with a New-Device-first creation flow

**Revises plan §13 (UI spec) and shapes the M2 frontend slice. Builds on
ADR 0007 (topology) and ADR 0008 (NetBox import).**

**Status:** Accepted (2026-08-07).

## Context

M1 shipped four flat sidebar screens — Topology, Devices, Samples, Lab Layout —
each an independent list. Two things are wrong with that for where the project
is going:

- **"Topology" is the wrong name and the wrong seam.** The thing users manage is
  their *devices*; the site/lab/zone/station hierarchy exists to *place* those
  devices. The three views that concern the physical plant — the nested
  hierarchy list, live device status, and the isometric layout — are facets of
  one thing and **influence each other** (place a station in the layout → it
  appears in the list; a device goes offline → both the list and the layout show
  it). They should live together, not as three peers in a flat rail.
- **Creation has no on-ramp.** A fresh EPIChem is a blank slate. There is no
  guided path from "nothing" to "a device I can use," even though devices can't
  exist until a site, lab and station do (ADR 0007).

## Decision

### Information architecture

**`Device Management` is a top-level section** (replacing `Topology`), with three
mutually-influencing subsections:

1. **Hierarchy** — the nested containment list built in M1 (`Site → Lab → Zone →
   Station → Module → Device`). **Keep this exactly** — the expandable nested
   list with a per-node inspector is well-liked and stays the primary way to see
   and edit the tree.
2. **Device Status** — a live view of device operational state (mode, health,
   last-seen, envelope excursions). New; populated by the M2 device plane
   (MQTT state tree, §8.2/§12.3). Until M2 wires live state, it renders the
   static registry state and says so.
3. **Lab Layout** — the isometric editor (plan §10): per-lab grid, box heights,
   stations/zones as snap-but-not-bound tiles, per-station device sub-layout.

These three read the same underlying model and reflect each other's changes.

### Creation flow — New-Device-first, blank-slate aware

The guiding principle: **adding a device is the important, frequent action; the
scaffolding around it (site, lab, zone, station) is set up rarely and should get
out of the way.** Concretely:

- A prominent, always-one-click **`New Device`** primary action. Everything else
  is created through a single **`+` (Add)** affordance — one click to the common
  targets (station, device), at most two for rarely-created ones (site, zone).
  The screen must not sprout a button per entity type.
- **Blank-slate guidance.** On an empty EPIChem, clicking `New Device` walks the
  user through the prerequisites in order — create a **Site**, then a **Lab**,
  then a **Station** (a Zone is optional and skippable) — and only then the
  device. Once the scaffolding exists it is reused (sites/labs are shared across
  many devices), so the guided steps collapse to a simple picker and `New Device`
  is genuinely one click.
- A **Station is a group of ≥1 device**; a single-device station is the
  degenerate case. So "add a device" and "add a station that happens to hold one
  device" are the same short path, not two different flows.
- **Organisation does not appear in this flow.** It is auth/tenancy-derived
  (arrives with the identity/RBAC work, §12.1) and is never a manual creation
  step here.
- **`+ Add` also offers "Import from NetBox / CSV"** (ADR 0008) at the site/
  station level — the bulk on-ramp that creates a station and its devices in one
  go.

## Consequences

- Plan §13's nav gains a `Device Management` section grouping
  Hierarchy / Device Status / Lab Layout; the standalone `Devices` and `Lab
  Layout` entries fold into it. The other sections (Samples, Procedures, Queue,
  Runs, Data, Admin) are unchanged.
- The M2 frontend slice is: **the Device-Management shell (three subsections) +
  the New-Device/`+` creation flow + NetBox/CSV import**, on top of the ADR 0007
  model change. The layout-editor upgrades (floorplan upload, drag-to-create-lab,
  box-height editing, station sub-layouts) are documented in §10 as the vision
  and land after this slice.
- The M1 hierarchy list and inspector are **preserved**, not rebuilt — this is an
  additive re-section, not a frontend rewrite.
- `frontend/src/api/types.ts` and the screens change with the ADR 0007 schema;
  the hand-mirrored-types convention (CLAUDE.md) applies.
