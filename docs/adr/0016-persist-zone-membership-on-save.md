# ADR 0016: Persist geometric zone membership to the hierarchy on Save

**Extends ADR 0015 (zones are 2D areas with *computed* membership). Membership is
still computed for display, but a **Save** in the Lab-layout editor now also
writes each station's containing lab-zone into `Station.zone_id`, so the
containment hierarchy reflects what's drawn.**

**Status:** Accepted (2026-08-10).

## Context

ADR 0015 made zone membership geometric and *computed on read* — a station
belongs to a lab-scoped zone when its footprint is fully inside the zone
rectangle — and deliberately left `Station.zone_id` untouched. That is right for
the live canvas (drag a station and its "In zones" line updates with no write),
but it means the **hierarchy** (the tree, the API, exports) never learns about a
membership the user established purely by drawing. The user asked that after
saving a layout, "if there are some stations inside a zone, the hierarchy should
be updated accordingly."

## Decision

**On Save, reconcile `Station.zone_id` with geometric membership.** After the
Lab-layout editor writes its staged geometry (creates / moves / resizes /
removes), it runs a membership pass over the level's boxes: for each station,
find the drawn lab-scoped zone whose rectangle fully contains the station's
*final* footprint (`rectContainsBox`, ADR 0015), and if that differs from the
station's current zone, write the station with the new `zone_id`. This is the
lab level only (`levels.ts` `syncZoneMembership`); the site and station levels
have no such pass.

Membership for **display** is unchanged — still computed live from the
draft-aware boxes (ADR 0015), so the inspector's "In zones" line and the zone
selection still update instantly, before any write.

## Scope and limits

- **Stations ↔ lab-zones only.** The hierarchy models zone membership as
  `Station.zone_id`; there is no `Lab.zone_id`. So labs sitting inside a
  *site-scoped* zone stay **display-only** — there is no field to persist them
  to, and inventing a lab→zone FK is out of scope (and would blur ADR 0007's
  "zone is a grouping under a lab"). Site-zone membership remains computed.
- **Newly-created stations** get their membership on the *next* Save. A station
  created in this Save doesn't have a persisted row to reconcile until the
  editor reloads; its zone is set the next time membership runs. This keeps the
  save path a single forward pass with no intermediate reload.
- A station that was both moved *and* changed zones costs one extra revision (the
  geometry write with its old zone, then the membership write with the new one).
  Revisions are cheap and reversible (ADR 0004), so the simpler code wins over
  folding the two writes together.

## Consequences

- The tree/API/export now agree with the drawing for station↔zone membership,
  which is what "update the hierarchy after saving" asks for.
- Writes still go through `reshapeStation` (the same full-replace placement PUT),
  so every membership change is a revision like everything else — no new
  endpoint, no direct ORM write.
- ADR 0015's "nothing is persisted" claim is narrowed: membership is computed for
  *display*, and *reconciled to the hierarchy on Save*. The two are consistent —
  Save simply makes the drawn membership durable.
