# ADR 0013: Sites have floors, but only the layout knows

**Status:** Accepted (2026-08-08).

## Context

A real site is a building with storeys. When several labs sit in one building,
placing them all on a single site plan is wrong — a lab on the third floor and a
lab on the ground floor are not near each other, however close their boxes land.
The Lab-layout editor (ADR 0012 made the site a canvas of lab boxes) needs a way
to say *which floor am I looking at* and to show only that floor's labs.

The tension is that a floor is **not** part of the containment hierarchy (§5.1,
ADR 0007). A lab's identity is its site, its room, its access group — not which
storey it happens to occupy. Threading a floor level through the Site → Lab →
Zone → Station → Device tree (a new node kind, breadcrumbs, the importer,
revisions) would be a lot of structure for what is, in the end, a way of
grouping boxes on a plan. The tree already flattened once (ADR 0007); we are not
adding a level back.

## Decision

Model the floor as **layout metadata on the existing rows**, read by nothing but
the layout editor:

- **`Site.floors`** (int, default `1`) — how many storeys the building has. `1`
  means single-floor and the layout's floor selector never appears.
- **`Lab.floor`** (int, default `0`, 0-based) — which storey a lab sits on. The
  site-level canvas filters its lab boxes to the selected floor.

That is the whole change. Specifically, a floor is **not**:

- a node in the containment hierarchy — it never appears in the Hierarchy tree,
  the topology API tree, or the descriptor parent chain;
- a thing you can put a device or a zone "in" — labs carry the floor, nothing
  below them does;
- addressable — there is no `Floor` entity, code, or revision stream. The
  layout breadcrumb's `[N]` floor chip is a *view control*, not navigation into
  a new level.

The selector is shown only when `Site.floors > 1`; otherwise the site plan is
just its labs, exactly as before this ADR.

## Consequences

- Additive migration `0004_site_floors.py`: `sites.floors` and `labs.floor` are
  `Integer NOT NULL` with server defaults matching the models
  (`test_migrations_match_the_models` stays green).
- `SiteSpec`/`LabSpec`, `SiteOut`/`LabOut`, and the importer `TOPOLOGY_WRITE`
  attrs gain the fields; they round-trip through the full-replace PUT and export
  like the other always-present numeric fields.
- The frontend mirrors `floors`/`floor` in `types.ts`, preserves them in the
  lab/site spec builders (a dropped field is silent data loss on save), and the
  site level filters its lab boxes by the current floor.
- Because floors live on rows the tree already has, a single-floor site pays
  nothing: no extra rows, no extra API surface, no hierarchy change. A
  multi-floor site is a layout affordance and stops there — which is the point.
