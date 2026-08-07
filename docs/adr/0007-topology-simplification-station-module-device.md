# ADR 0007: Flatten the topology — Station-as-device-group, optional Zone, recursive Module, Device as leaf

**Revises plan §5.1 and §4; answers plan §17 Q4 (workcell granularity).**

**Status:** Accepted (2026-08-07). Supersedes the six-level chain built in M1.

## Context

M1 shipped the plan's §5.1 topology verbatim: a six-level containment chain

```
Site → Lab → Zone → Workcell → Bench → Station → (Device via binding)
```

Two problems surfaced once we looked at a real lab's inventory (the MPG-FKF
NetBox export — one site `MPG-FKF`, one room `4M20`, one rack `SpinBot`
grouping a SCARA arm, two heating plates, a pipette, converters and relays):

1. **Four of the six levels were ceremony.** A real room has a lab, a handful
   of automated cells, and the instruments on them. `Workcell` and `Bench` were
   distinct rows that, in practice, always stood 1:1 with the thing above or
   below them. NetBox itself models this as `Site → Location → Rack → Device`,
   and the user's mental model matches: a *rack* (e.g. `SpinBot`) is one
   automated **station**, and the instruments on it are its devices.

2. **`Station` and `Device` were decoupled the wrong way.** M1 followed §5.1's
   "a station is an addressable grid slot, devices bind to it many-to-many."
   But the user's model is the inverse and simpler: **a station is a *group of
   one or more devices*** — a single-device station is just the degenerate case
   where the station wraps one device. The instruments below a station form a
   containment tree, not a binding table.

## Decision

The topology chain becomes:

```
(Organisation)            — auth/tenancy-derived, NOT a manually-created UI entity (see ADR 0009)
  Site
    Lab                   — owns the isometric grid (extent + cell size); a physical room
      Zone      (optional)— groups stations; declares human vs. robot area + shared conditions
        Station           — a group of ≥1 device; the placed, schedulable unit on the lab grid
          Module (optional, recursive)
            Device        — the controllable leaf (ophyd Device → Signals)
```

Concretely:

- **`Workcell` and `Bench` are removed as topology levels.** Their two real
  responsibilities move:
  - *Grid geometry* (was `Bench.grid_cols/grid_rows/height_mm`) moves **up to
    `Lab`** — the lab owns one isometric grid, and stations snap onto it
    (see plan §10, ADR 0009).
  - *Execution/scheduling identity* (was `Workcell.queueserver_endpoint`,
    `redis_namespace`, `state`, `owning_group`) is **no longer a fixed
    topology level** — see "Execution unit" below.

- **`Zone` is optional and flexible.** A `Station` may sit directly under a
  `Lab`, or inside a `Zone`. `Zone` and `Station` are therefore siblings under
  `Lab` (a station's parent is a lab *or* a zone). A zone's purpose is grouping
  for **safety** — principally declaring a **human area vs. a robot area** — and
  for shared physical conditions (atmosphere, pressure, hazard class), which it
  already carried.

- **Below the station is one recursive `Module` concept, with `Device` as the
  controllable leaf.** A `Module` is *"everything that is not directly a
  device"*: a grouping that can encompass several devices, a sub-assembly that
  contains sub-modules, or a **passive component** (a module with no driver at
  all — a manifold, a rack frame, a tip block). Modules are optional: a device
  may hang directly off a station. This deliberately does **not** introduce a
  separate NetBox-style "Component" table (a lighter interface/port entity);
  a passive component is modelled as a `Module` with no capability, reusing the
  ophyd-style containment tree the plan already describes in §6.1.

- **`Station` is a grouping abstraction, not a grid slot.** It replaces the M1
  `Station` + `StationDeviceBinding` pair. A station has a position on the lab
  grid and its own sub-layout onto which its modules/devices are placed
  (plan §10, ADR 0009).

### Execution unit (answers §17 Q4, deliberately left partly open)

The plan's §4 "the workcell is the unit of scaling and failure" survives as an
*execution* concept, but it is no longer a *topology* row. The user's model:

- Scheduling targets a **method** (a capability), which may run on a single
  `Station` **or span several stations**.
- A method decomposes into lower-level **driver methods**, each a Bluesky
  (sub)plan, mirroring the `Module → Device` containment tree. This capability
  composition is what optional sub-modules are *for*.
- The queueserver / RE Manager runtime namespace (`queueserver_endpoint`,
  `redis_namespace`, run `state`, `owning_group`) is an attribute of the
  **executing scope**, whose default home is the `Station`. Whether one RE
  Manager serves one station, a station group, or is marshalled per cross-station
  method is an **M2 design decision**, recorded as still-open here rather than
  baked into the schema now. The fields move onto `Station` as their default
  home; M2 may promote a subset to a separate execution-scope row if the
  cross-station case demands it.

## Consequences

- **Schema migration (M2 work, not yet built).** `workcells` and `benches`
  tables are dropped; `Lab` gains grid columns; `Station` gains a `zone_id`
  *or* `lab_id` parent, grid coordinates, and the execution fields; the
  `Device` containment tree (already `parent_id`-based, §6.1) absorbs the
  `Module` role via a `kind`/`role` discriminator (`module` vs. `device`),
  and `StationDeviceBinding` is removed in favour of a station-owned device
  subtree. The `descriptors/` example set and `test_cli.py`'s fixture change
  shape — expected, and part of the M2 slice.
- The `Device` descriptor's `spec.location` block loses `workcell` and `bench`
  keys (plan §6.1); `lab`, `zone`, `station` remain. Importers must tolerate the
  old keys during transition.
- This is a genuine model change, not a rename: existing M1 data would need a
  one-time transform. There is no production data yet, so the migration is a
  fresh-schema change, not a data migration.
- `Revision` history (ADR 0004) is unaffected in mechanism — the new kinds are
  revisioned exactly like the old ones.

## Alternatives considered

- **Keep `Workcell` as a hidden execution grouping** (not a visible level).
  Rejected as premature: with no cross-station scheduling built yet, a separate
  execution row is speculative. Defaulting the fields onto `Station` and
  revisiting in M2 keeps the schema honest to what exists.
- **A distinct `Component` entity** below `Device`. Rejected per the user's
  "module = everything that is not directly a device": one recursive `Module`
  with `Device` as the leaf covers passive parts, sub-assemblies and groupings
  without a second near-duplicate table.
