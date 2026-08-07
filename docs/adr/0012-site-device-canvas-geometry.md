# ADR 0012: Site and device gain canvas geometry, so the editor has three levels

**Extends ADR 0010 (the lab is a metric canvas; stations are boxes on it) to
the level above and the level below.**

**Status:** Accepted (2026-08-07).

## Context

ADR 0010 made the Lab a metric canvas and the Station a box placed on it. The
layout editor now wants the *same* direct-manipulation surface at two more
levels of the hierarchy (ADR 0007: Site → Lab → Zone → Station → Device):

- a **Site** canvas whose boxes are its **labs**, and
- a **Station** canvas whose boxes are its **devices/modules**.

The blocker is purely data: a Lab has its own floor (`width_m`/`depth_m`) but no
position *on a site*, and a Device has a point pose (`pose_x_mm`/`y_mm`) but no
footprint — so neither level has anything to write a box to. The editor is meant
to be **one implementation** driven by data (see the layout screen), so the only
thing standing between "one level works" and "three levels work" is these
columns.

## Decision

Add the missing geometry, reusing ADR 0010's box model (position + footprint,
snap-but-not-bound) at each level, in the unit natural to that level:

- **`Site` becomes a metric canvas** — `width_m` (40.0), `depth_m` (40.0),
  `grid_size_m` (1.0), exactly like `Lab`. Bigger default extent because a site
  holds several 10 m labs.
- **`Lab` gains a box on the site canvas** — `site_pos_x`, `site_pos_y`,
  `site_size_x_m` (10.0), `site_size_y_m` (10.0), in metres. Deliberately
  *distinct* from `width_m`/`depth_m`: those are the lab's **own** floor, these
  are the rectangle the lab occupies **on the site**. Non-null with defaults, so
  a newly created lab appears at the site origin at the standard 10×10 m size.
- **`Device` gains a footprint** — `size_x_mm`, `size_y_mm`, `size_z_mm`, in
  **mm** to match its existing `pose_x_mm/y_mm` position within the station.
  **Nullable**, like the pose: an unplaced node renders at a standard
  0.1 × 0.1 × 0.1 m on the Station canvas, and hand-written device YAML doesn't
  gain three size fields it doesn't need. The Station canvas divides mm by 1000
  to share ADR 0010's metre projection.

Placement stays **soft** (ADR 0010): a box off its canvas or overlapping another
is an editor warning, not a rejected write. Zones still carry no drawable
footprint — they classify, they aren't placed (deferred, as in ADR 0010).

## Consequences

- Additive migration `0003_site_device_geometry.py`. Site/Lab columns are
  `Float NOT NULL` with a server default matching the model; device footprint is
  nullable. `test_migrations_match_the_models` stays green.
- The descriptor interchange grows: `SiteSpec`/`LabSpec` gain the fields (always
  exported, like the lab's own canvas already is), and `Device`'s `location`
  gains an optional `footprint` block (`FootprintSpec`), pruned from YAML when
  empty just like `pose`.
- The frontend can now treat all three levels as the same "boxes on a metric
  floor" model and render them through one canvas component; the level only
  chooses which rows become boxes and which write endpoint a drag calls.
- Units are intentionally mixed (site/lab in m, device in mm) to match each
  level's existing convention rather than force one unit; the canvas normalises
  to metres at the single point it projects to screen.
