# ADR 0014: The layout editor stages edits and constrains placement

**Refines ADR 0010 (§10.3 "the canvas holds no authoritative state; each edit is
written immediately and the reload commits it") for the editor's *edit mode*.**

**Status:** Accepted (2026-08-08).

## Context

ADR 0010 made every drag/resize/create/delete an immediate full-replace write:
the canvas reports geometry, the screen PUTs it, refetches, and the redraw
commits. That is simple and keeps the canvas stateless, but it means:

- there is no "try some changes, then decide" — every nudge hits the database
  and lands in the revision history, so laying out a lab is a hundred revisions;
- "Add" persists a real row instantly, so a mis-click leaves a stray station;
- nothing stops a box being dragged, resized, or *typed* off its floor or on top
  of another box — placement was a soft warning (`boxProblems`), not a rule.

The users want an editor that behaves like a drawing tool: make changes freely,
**Save** to commit them all, **Cancel** to throw them away — and placement that
can't produce an invalid layout in the first place.

## Decision

**Edit mode is staged.** While editing, add/move/resize/remove and floor changes
accumulate in a **draft** held in React state (not in the canvas — the canvas
stays stateless, rendering an *effective model* = fetched data + draft). Nothing
is written until **Save**, which replays the draft through the same per-level
write endpoints ADR 0010 defined (`create`/`setGeometry`/`remove`/`resizeFloor`
in `levels.ts`) and then refetches. **Cancel**, or any attempt to leave edit mode
with a dirty draft, prompts a confirm offering Save or Discard. A created box
carries its real future code from the moment it's added, so Save is one POST per
new box (geometry included) rather than create-then-place.

**Level changes are inspect-mode only.** Drilling into a box or using the
breadcrumb is a navigation action; allowing it mid-edit would strand a draft
scoped to one level. In edit mode the breadcrumb is locked and explains itself
via a dismissible banner. Inspect mode keeps the immediate, write-free
navigation; a click on a box's **label** drills into its sublevel.

**Placement is constrained, not just warned.** Every committing edit — drag,
handle-resize, and numeric entry alike — runs through `clampToFloor` (footprint
no larger than the floor; position so the whole box fits) and an overlap check
(`overlapsAny`); an overlapping result is rejected and the box snaps back. A new
box is placed by `placeNextSlot`, which scans the floor grid row by row for the
first free slot, so children tile left-to-right, top-to-bottom instead of
stacking at the origin; when nothing fits, the add is refused with a warning.
This is the isometric-diagram demo's "keep it inside the diagram" rule, made to
also forbid overlap. The soft `boxProblems` warnings remain as a backstop for
data that arrives invalid from elsewhere (e.g. a shrunk floor).

## Consequences

- The write path is unchanged — Save calls exactly the ADR 0010/0012 endpoints,
  so the revision history, full-replace contract and soft-hide (ADR 0011) all
  behave as before; there are just far fewer, more intentional writes.
- The canvas is still authoritative-state-free (§10.3 holds): a rejected drag
  snaps back because the effective model didn't change, and a forced redraw
  (a bump counter) repaints it — the same "reload is the commit" idea, with the
  draft standing in for the server between Save points.
- The constraint helpers (`clampToFloor`, `rectsOverlap`, `overlapsAny`,
  `placeNextSlot`) are pure and unit-tested in `isometric.test.ts`; the staging
  buffer lives entirely in `LayoutScreen`, so `levels.ts` stays the only
  per-level code and the canvas hook stays generic.
- A consequence to accept: a draft is discarded on Cancel/mode-switch and is not
  persisted anywhere, so a lost tab loses unsaved work — acceptable for a layout
  editor, and the same as any unsaved document.
