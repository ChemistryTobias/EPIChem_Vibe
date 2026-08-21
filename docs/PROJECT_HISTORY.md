# Project history — decisions and milestones, condensed

This page replaces `docs/adr/` (17 files), the old `CLAUDE.md`'s
conventions narrative, `PROJECT_MILESTONES.md`, and `docs/MILESTONE_CI_CD.md`
— merged and shortened into one page. Full original text for anything below
is recoverable from `git log` if a decision's exact reasoning is ever needed
verbatim; this page keeps the *conclusion*, not the argument.

**Where things stand today:** all decisions below (ADR 0000–0016) were made
against `backend/epichem/`, the original registry-pattern backend. That
backend is being replaced by `backend/app/`, a vertical-slice rewrite — see
`docs/project_plan/EPIChem_Roadmap.md` for current, forward-looking status and
milestones. Treat this page as **history**: it explains *why* the topology
model, the write pattern, and the UI are shaped the way they are, which
still matters for the rewrite even though the code paths named below
(`registry.py`, `importer.py`, etc.) are old-backend-specific.

---

## Decisions (condensed ADR log)

**Reconciliation & source of truth**
- **0001 — in-app reconciler, not a k8s operator.** No CRDs, no cluster
  dependency; a plain Python diff function so `docker compose up` stays the
  on-ramp. *(Superseded in spirit by 0004 — see below.)*
- **0004 — the database is the source of truth, not git.** Reversed 0001's
  git-desired-state premise entirely, by explicit user direction (Kadi4Mat's
  full-snapshot revision model as the reference). Every write records a
  complete JSON snapshot (`Revision`: entity_type/entity_id/revision_number/
  action/snapshot/created_by); YAML becomes an export/import convenience,
  never something a reconciler enforces against the DB. This is the
  single most load-bearing decision in the old backend's design.

**Topology shape**
- **0007 — flatten the topology.** `Site → Lab → Zone(optional) → Station →
  Module → Device`, replacing the original six-level `Site → Lab → Zone →
  Workcell → Bench → Station(+binding)` chain. A Station is a *group of ≥1
  device* (not a grid slot devices bind to); Module is one recursive
  concept with Device as the controllable leaf; Workcell/Bench dropped,
  their grid geometry moved to Lab, their execution identity defaulted onto
  Station (left open which scope ultimately owns a queueserver).
- **0010 — the lab is a metric canvas.** Integer grid cells replaced by
  real metres: `Lab.width_m/depth_m/grid_size_m`, `Station.pos_x/y/
  size_x_m/y_m/height_m`. Snap-to-grid is a *guide*, not a constraint
  (soft placement, not a hard rule at this stage — tightened later by 0014).
- **0012 — geometry added above and below the lab.** `Site` becomes a
  metric canvas too (labs are boxes on it, `Lab.site_pos_*/site_size_*_m`);
  `Device` gains a footprint in **mm** (`size_*_mm`, matching its existing
  `pose_*_mm`) so the editor is one implementation over three levels, not
  three separate ones.
- **0013 — sites have floors, but only the layout knows.** `Site.floors` +
  `Lab.floor` are layout metadata, not a hierarchy level — never in the
  tree, the API tree, or the importer. Purely which floor's labs the site
  plan currently draws.
- **0015 — zones become 2D drawn areas, at site or lab scope.** A Zone
  gains a rectangle (`pos_x/y/width_m/depth_m`) and an optional `site_id`
  (alongside the existing `lab_id` — exactly one is set). Membership is
  **geometric and computed on read** (fully-contained-in-rectangle), not a
  stored FK — moving a box in or out of a zone needs no zone write.
- **0016 — zone membership persists to the hierarchy on Save.** Extends
  0015: a lab-layout Save reconciles each station's `zone_id` with its
  drawn geometric membership, so the tree/API/export agree with what was
  drawn. Site-scoped (lab-in-zone) membership stays display-only — there's
  no `Lab.zone_id` to write it to.
- **0011 — a `virtual` flag soft-hides, rather than deletes.** Canvas
  "delete" on a Station/Device sets `virtual=True` (filtered from the
  canvas, still in the registry, still revisioned, reversible); the
  Hierarchy screen's delete stays a real hard `DELETE`. Two different verbs
  on two different surfaces, deliberately.
- **0014 — the layout editor stages edits.** Every drag/resize used to be
  an immediate write (a hundred revisions to lay out one lab). Edits now
  accumulate in a client-side draft; nothing writes until **Save**; Cancel
  discards. Placement became a hard constraint at the same time
  (`clampToFloor` + overlap rejection), not just a warning.

**Devices, capabilities, network**
- **0002 → 0008 — NetBox: optional import, never authoritative.** 0002
  originally kept `Device` network fields NetBox-shaped for a future
  one-way authoritative sync; 0008 explicitly reversed the *authoritative*
  half — EPIChem holds and edits topology/devices itself, NetBox (or its
  CSV export) is at most an idempotent import source, never a system that
  overwrites EPIChem-side edits.
- **0003 — scope defaults for the remaining M0 questions**, batched:
  `@joint/core`-only for the isometric canvas (license-driven — the MPL-2.0
  requirement rules out JointJS+), React Flow (MIT) for the later
  procedure/workflow DAG, EPICS-only transport for M1–M2 (field stays an
  open string for later Tango/REST/SiLA2), no xDL yet, manual steps
  in scope from v1, one deployment per group (no tenant isolation),
  calibration metadata lives on `Device.operational.calibration` as a
  pointer to the ELN record, not the document itself.
- **0006 — no Redis yet.** Nothing built so far earns a cache/session
  store; it belongs to the device plane (queueserver's own Redis, live MQTT
  state), not the registry, which is small enough that a plain index beats
  a cache with no invalidation story yet.

**Samples & sample UX**
- **0005 — a minimal, deliberately incomplete Sample model ahead of full
  sample management.** One flat row (state/substance/amount/location/owner/
  notes) instead of the full eventual Substance/Batch/Container/lineage
  graph — by explicit user direction, so the Samples screen has something
  real to read without building the eight-entity model before anything
  consumes it. No descriptor-YAML envelope (samples are operational data,
  not lab config); writes still go through the same revisioned write path
  as everything else.

**Frontend information architecture**
- **0009 — "Device Management" replaces "Topology" as the top nav
  section**, with three mutually-reflecting subsections: Hierarchy (the
  nested list, kept as-is), Device Status (live state, stubbed until the
  device plane exists), Lab Layout (the isometric editor). New-Device-first
  creation flow: one `New Device` action, one `+ Add` menu, guided
  scaffolding (Site→Lab→Station) on a blank slate that collapses to a
  picker once scaffolding exists.

**Process**
- **0000 — the ADR format itself.** One file per decision, numbered,
  Status/Context/Decision/Consequences; never edited to reverse a
  decision — a later ADR supersedes and says so.

**`backend/app` rewrite (current)**
- **No Alembic yet, on purpose.** `Database.metadata.create_all()` covers
  both SQLite and Postgres identically and is deliberately kept while the
  core entities (`Device` especially, per Roadmap 1.3) are still actively
  gaining/reshaping fields — writing migrations for a schema that's about to
  change again is pure overhead with no payoff yet. Introduce Alembic once
  the entities stabilize, ideally right before the first production deploy
  with data worth preserving across upgrades.
- **`backend/epichem/` deleted outright**, not kept as a parallel reference
  tree, once `backend/app/` reached parity + real auth + revisions. Its
  design decisions stay documented above; its 101 tests' coverage is
  summarized in `backend/tests/TESTED.md` rather than kept as dead code.
  `compose.yaml`/`compose.prod.yaml`/`.gitlab-ci.yml` updated to build/run
  `app/` — no `migrate` step (no Alembic yet) and no `seed` step (nothing
  writes example data into a fresh deployment yet, see `scripts/README.md`
  for the local-dev-only stand-in).
- **Docs are plain Markdown, no static site.** GitLab Pages + Zensical
  (`zensical.toml`, the `pages`/`docs:openapi` CI jobs) were tried, then
  dropped in favor of Markdown files viewable directly in GitLab, entered
  through the repo root `README.md`. `docs/API.md` is a hand-written static
  snapshot of the endpoints now, not a live `openapi.json` fetch.

---

## Milestone history (condensed)

- **M0 (decisions)** — closed for the original implementation pass; all
  ten of the original plan's §17 open questions answered above (ADRs
  0001–0003), except ELN target (Chemotion vs. Kadi4Mat) and the
  JointJS+/`@joint/core` licensing call, both deliberately left as
  standing defaults rather than forced decisions.
- **M1 (topology & registry, old backend)** — shipped complete: registry
  schema, descriptor YAML schemas reused as the write API's request body,
  the versioned write service (ADR 0004), read+write API with RFC 9457
  errors, YAML import/export, a CLI, an example descriptor set, and a
  four-screen frontend (Topology tree, Devices, Samples, isometric Lab
  Layout) — all against real data, no mocks. Hardening pass added Alembic
  migrations, shared-token auth, pagination on `/devices`/`/samples`, and
  fixed four backend defects (undeletable bound devices, sqlite FKs
  unenforced, `export-dir` overwrite bug, two columns missing from
  API/revisions).
- **M2 (device plane, old backend, in progress when superseded)** — the
  topology flatten (ADR 0007), the metric lab canvas (ADRs 0010/0012/0013),
  the Device-Management shell + creation flow (ADR 0009), the full staged
  three-level layout editor (ADR 0014) and 2D zones (ADRs 0015/0016) all
  shipped. **Not reached**: real devices behind IOCs, the
  `plans_allowed`/`devices_allowed` introspection service, live MQTT
  device state — this is where the old backend's M2 stopped, and where
  `backend/app/`'s rewrite now needs to catch up per the current Roadmap.
- **Delivery (CI/CD)** — verified end-to-end (old backend): `docker compose
  up` reaches a seeded console; the GitLab pipeline (lint → test incl. real
  Postgres → build/push → verify-in-headless-browser → manual prod deploy)
  went green on `main`. Two fixes were needed to get there: an auth-token
  env var leaking into test jobs, and TLS docker-in-docker not being
  available on the shared runner (switched to plaintext dind). Helm charts
  were deliberately not built (blocked on whether the institute runs a
  GitLab Kubernetes agent — ask FHI IT before building); no Python
  lockfile yet, so image builds aren't byte-reproducible.
- **M3 (procedure designer) / M4 (samples & provenance) / M5 (scheduler) /
  M6 (depth, incl. NetBox import)** — not started on the old backend. See
  `docs/project_plan/EPIChem_Roadmap.md` for how these map onto the current
  0/1/2/3 milestone numbering going forward.

---

## Known gaps carried forward

- **Auth was a shared bearer token, never real identity** (old backend);
  the new backend (`backend/app/`) now has real per-user auth (0.2, done),
  but no access-*level* logic yet — any valid token grants full access to
  everything, see `app/core/access_control/README.md`.
- **No observability** in either backend yet — nothing to debug a
  distributed run with, but there's also no distributed run yet.
- A few cosmetic (non-correctness) schema/spec mismatches were found and
  partly fixed in the old backend (`CapabilityClass.iri` round-trip fixed;
  `TransportSpec.quality` accepted by the loader but never stored; `Signal`
  rows never populated — all pre-`backend/app/` issues, not necessarily
  still relevant).
