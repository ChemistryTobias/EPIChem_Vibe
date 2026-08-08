# ADR 0015: Zones are 2D areas at site or lab scope, with geometric membership

**Extends ADR 0007 (Zone = an optional grouping under a lab, §12.2 safety
boundary) — a zone keeps its classification fields but gains a *drawn 2D area*
and can now be scoped to a Site as well as a Lab. Membership becomes geometric.**

**Status:** Accepted (2026-08-08).

## Context

ADR 0007 modelled a Zone as a lab-level grouping with a safety classification
(atmosphere, occupancy, …) and an explicit `Station.zone_id` FK. It had no
geometry and no existence above the lab.

The layout work wants zones you can *draw*: a walkable corridor, a keep-out
area, a robot cell — "walkable areas or anything" — laid out **on the site plan**
(a region of the building) or **on a lab plan** (a region of a room). And
membership should follow the drawing: a lab or station belongs to a zone when it
sits **completely inside** the zone's rectangle, rather than by a hand-set FK.

## Decision

**A Zone gains a 2D rectangle and a scope.**

- Geometry: `pos_x, pos_y, width_m, depth_m` (metres, floats, snap-but-not-bound
  like every other canvas coordinate — ADR 0010). No height: zones are flat 2D
  regions, drawn as translucent areas under the boxes, in both projections.
- `purpose`: a free string ("walkable", "keep-out", …) — the "or anything".
- Scope: a zone attaches to exactly one parent — a **Site** (`site_id`, a
  site-plan region) **or** a **Lab** (`lab_id`, a lab-plan region). `lab_id`
  therefore becomes nullable, and `site_id` is added (nullable). The existing
  `Station.zone_id` FK is left untouched for back-compatibility, but the new
  membership notion does not depend on it.

**Membership is geometric and computed, not stored.** A lab belongs to a
site-scoped zone when the lab's *site box* (`site_pos/site_size`, ADR 0012) is
fully contained in the zone rectangle; a station belongs to a lab-scoped zone
when its footprint is fully contained. "Fully contained" (⊆, not merely
overlapping) is the rule the users asked for. This is derived on read (the
frontend computes it for the inspector) — nothing is persisted, so moving a box
in or out of a zone needs no zone write.

## Round-trip and blast radius

Both scopes go through the **same generic descriptor path** — the only change is
that a Zone no longer has a single *required* parent. In `importer.py`'s
`TOPOLOGY_WRITE`, Zone's required-parent slot becomes `None` and `lab`/`site`
move to the *optional refs* list; `ZoneSpec`'s validator enforces exactly one of
them. So:

- The importer resolves whichever of `lab`/`site` a descriptor names, setting the
  matching FK and leaving the other NULL. The new geometry/`purpose` columns join
  the generic `attrs` list, so they round-trip for either scope.
- The exporter writes whichever ref is set (`lab:` or `site:`), so a site-scoped
  zone exports to a valid descriptor with no special case.

The migration (0005) mirrors the model columns exactly so `test_migrations.py`'s
model-vs-migration parity stays equal, and adds them non-null-with-default
(geometry `0`, `purpose` `'area'`) / nullable (`site_id`, and `lab_id` becomes
nullable) so the ALTER is safe on a populated table.

## Consequences

- Zones are now first-class on the canvas at two levels, with the same metric
  coordinate system as everything else — one more thing the generic layout code
  can draw.
- Membership is honest to the drawing and needs no bookkeeping, at the cost of
  being recomputed on read (cheap: a handful of rectangle-containment checks).
- The zone model now has two shapes (a classification *and* an area) and two
  scopes; the classification fields stay optional so a purely-spatial zone can
  leave them at their defaults.
