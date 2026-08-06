# ADR 0004: The Postgres registry is the source of truth; git YAML becomes an import/export format, not desired state

**Supersedes the git-desired-state premise of ADR 0001 and plan §4.**

**Status:** Accepted — by explicit user direction, overriding the plan (see Context).

## Context

ADR 0001 and plan §4 established a Kubernetes-style control loop: descriptor YAML in git is
*desired state*, the Postgres registry is *observed state*, and a reconciler diffs the two. The
read API was deliberately mutation-free in M1 (see `CLAUDE.md`) because all writes were meant to
flow through that loop.

The project owner has explicitly asked to invert this, and confirmed this supersedes the plan:
the database becomes the source of truth for topology, device, and capability-class
configuration, edited directly (via API/CLI), with **every entity version-controlled inside the
database itself** — a full revision history per resource, not just a `created_at`/`updated_at`
pair. Git-backed YAML is still wanted, but repurposed as an **import/export interchange format**
(back up a resource to a file, hand-edit and re-import it, move config between environments) —
not as the thing a reconciler enforces against the DB.

This isn't a case of the plan simply being wrong — §4's git-first reasoning (reproducibility,
review-before-apply, `git diff`-able infra) is real and reasonable for something like Kubernetes
manifests. But the user's actual working model is closer to a research-data-management resource
registry — one editable by hand, changing continuously as a lab is built out — than to
infrequently-changing cluster infra. Kadi4Mat (an established research-data-management platform,
cited by the user as the reference pattern) is built exactly this way: **records are the source of
truth in the database, and every record carries a revision history** (implemented in
`kadi.lib.revisions.core` as full-column-snapshot revisions, one row per entity per revision,
created explicitly on each committed change — see the `Revision`/`create_revision()` design that
this ADR's schema below directly follows). YAML there is an export/interchange concern, not a
control-loop input.

Note on scope: §3 Non-Goals says EPIChem should not become the ELN / scientific record of
authority — that's Chemotion/Kadi4Mat's job. A revision history on *operational config*
(topology, devices, capability classes) is not that; it's closer to the "audit log" the plan
already lists as a wanted-but-unbuilt Admin-UI feature (§13) and the event-sourcing precedent
already used for sample location (§7.4: "never edited directly... derived from the event log").
This ADR extends that same audit-trail principle to the registry, rather than introducing a new
kind of system.

## Decision

1. **The registry (Postgres) is authoritative.** Topology, Device, and CapabilityClass rows are
   created/updated/deleted directly — via a write API and CLI — not derived from reconciling a git
   checkout. The read API's M1 "deliberately read-only" constraint (`CLAUDE.md`) is lifted.

2. **Every write is versioned.** A generic `Revision` table
   (`entity_type, entity_id, revision_number, action, snapshot, created_at, created_by`) records a
   full JSON snapshot of the entity on every create/update/delete, mirroring Kadi4Mat's
   full-snapshot-per-revision model rather than a diff/patch log — simpler to implement and to
   restore from, at the cost of some storage, which is fine at registry scale (hundreds to low
   thousands of rows, not sample-event volume). One shared table across all entity kinds (not
   Kadi4Mat's per-model dynamic tables) — this project has ~8 kinds today; a single table keeps
   "show me the history of any resource" a single query instead of eight near-identical ones. If a
   kind grows relationship-level revisioning needs later, this can be revisited.
   `revision_number` is a per-entity monotonic sequence starting at 1, so a client can render
   "v3 of DEV-HP-001" without needing the Revision table's own PK.

3. **YAML becomes export/import, not reconciliation.** The existing `Descriptor` envelope schema
   (`apiVersion/kind/metadata/spec`) and per-kind spec models in `schemas/descriptor.py` are kept
   — they're still the right shape for a YAML file — but repurposed:
   - `epichem <kind> export <code> [-o file.yaml]` serializes a DB row to that envelope.
   - `epichem <kind> import <file.yaml>` (or a directory) parses it back and applies it through the
     *same* create/update code path the write API uses, so an import is versioned exactly like an
     API write. Import is explicit and user-triggered — nothing watches a directory and applies
     changes automatically.
   - The old `epichem reconcile` command and its automatic-drift-against-git-desired-state
     behavior are removed; "drift" isn't a meaningful concept once the DB is canonical.

4. **No auth still applies.** `created_by` is nullable for now (no identity system exists yet);
   this is the same pre-existing gap already flagged for the read API, now inherited by the write
   API too. Do not point this at anything reachable by anyone else.

## Consequences

- Loses: `git diff`-able infra config as the enforcement mechanism, and the "can't drift because
  it's regenerated from git" guarantee ADR 0001 valued. A hand-edit via the API/CLI is now
  possible and won't be silently reverted by the next reconcile — because there is no next
  reconcile.
- Gains: a real write API/CLI (a capability the plan deferred to M2's layout editor is now needed
  earlier for topology, at least at the CRUD level — the *visual* layout editor is still M2), and
  a per-resource audit/revision history that the plan wanted eventually (§13) but hadn't scoped
  concretely.
- `reconciler.py`'s validation logic (capability-class resolution, station-lookup,
  parent-chain-cycle handling) is not thrown away — it's the same validation an import or a create
  call needs, so it moves into the shared write-path service rather than staying reconciler-only.
- This ADR is scoped to topology/Device/CapabilityClass (the M1 registry). Samples/batches (M4)
  were already planned as DB-only with their own event-sourced audit trail (§7.4) and are
  unaffected — this ADR doesn't change M4's design, it just gives M1 the analogous versioning
  property M4 already had.
