# PROJECT_MILESTONES.md

Tracks actual implementation status against the milestone table in
`project_plan/EPIChem_Project_Plan.md` §14. That document is the spec; this one is the honest
record of what exists. Update it whenever scope changes — don't let it drift from `git log`.

Full milestone table for reference: M0 (decisions) → M1 (topology & registry) → M2 (device plane)
→ M3 (procedure designer) → M4 (samples & provenance) → M5 (scheduler & scale) → M6 (depth).
Sequencing is deliberate per §14: "topology before devices, devices before procedures... inverting
any pair produces rework." This build follows that order: M1 is complete, M2 onward is not.

---

## M0 — Decisions & spec

**Status: closed for this implementation pass.**

All ten §17 open questions answered in `docs/adr/0000`–`0003` (reconciler shape — since superseded,
see ADR 0004 — NetBox scope, workcell granularity, EPICS-only for now, xDL deferred, manual steps
in v1, single-tenant schema, calibration data location). Two remain genuinely open, by design, not
oversight:

- **JointJS+ vs. `@joint/core`** — **answered by building it.** The isometric layout ships on
  `@joint/core` (MPL-2.0) alone, with a React-side inspector in place of the commercial Inspector
  component — exactly plan §10.2's recommendation, and the only option compatible with the
  binding "MUST be open source, end to end" condition. No JointJS+ component is used or needed.
  Separately recorded in ADR 0003 Q1: the M3 procedure editor will use **React Flow** (MIT).
- **ELN target (Chemotion / Kadi4Mat / both)** — needs an institutional decision this session
  can't make; deferred to M4.

## M1 — Topology & registry

**Status: done.** Re-architected mid-pass (ADR 0004), then completed: registry, write API, CLI,
frontend, and the isometric layout that is M1's stated exit criterion.

The registry was originally built git-YAML-as-desired-state (ADR 0001), reconciled into Postgres by
a one-way reconciler. Partway through M1, scope was explicitly revised: Postgres is now the
versioned source of truth for topology/device/capability-class config, not git — every write
(HTTP or CLI) records a full-snapshot `Revision`, and YAML becomes an export/import interchange
format instead. See `docs/adr/0004-database-is-source-of-truth-not-git.md` for the full rationale
(modeled on Kadi4Mat's resource-revision pattern). `reconciler.py` and its test suite were removed;
nothing in the current tree implements git-desired-state reconciliation or drift detection.

Built (all covered by the 91-test suite in `backend/tests/`, sqlite in-memory — **not yet
re-verified against a real Postgres instance since the ADR 0004 rewrite**; the prior pass's
`postgres:17` verification covered the retired reconciler/read-only-API shape, not the current
write/import path):

- [x] Registry schema (SQLAlchemy): `Site → Lab → Zone → Workcell → Bench → Station`, `Device`
  (containment tree via `parent_id`), `Signal` (table exists, nothing populates it yet — that's
  ophyd introspection, M2), `CapabilityClass`, `StationDeviceBinding` (the
  Station↔Device many-to-many with a role, replacing the prototype's `STATIONS[].deviceId`),
  `Revision` (one shared table across all kinds, full JSON snapshot per write, ADR 0004 §2)
- [x] Descriptor YAML schemas (pydantic) for every topology kind plus `Device` and
  `CapabilityClass`, matching the plan's §6.1/§6.3 examples field-for-field — reused as-is for the
  write API's request body (ADR 0004 §3), not just YAML
- [x] Loader: reads a descriptors directory, validates, collects errors per-file instead of
  aborting on the first bad one
- [x] Versioned write service layer (`epichem/registry.py`): `create_entity`/`update_entity`/
  `delete_entity`, each recording a `Revision`; hard-delete with the pre-delete snapshot preserved
  permanently in the Revision row
- [x] Write API (FastAPI): POST/PUT/DELETE + `GET .../revisions` for all six topology kinds plus
  `Device` and `CapabilityClass`, RFC 9457 problem+json (404/409/422)
- [x] Read API (FastAPI): topology + devices + device-classes + signals endpoints (§8.1 subset),
  filterable (`?lab=`, `?capability=`, `?capability_class=`, `?mode=`), lookup by UUID or short code
- [x] YAML import/export (`epichem/importer.py`, `epichem/exporter.py`): descriptor↔registry-row
  translation shared by the write API and the CLI, so there is exactly one copy of that logic, not
  one per caller. Bulk import is an idempotent upsert (create-or-update per descriptor, per-item
  failure isolation), not drift detection; a Device whose `parent` is another device in the *same*
  import batch is not cascade-resolved (a documented scope cut from the old reconciler's fixed-point
  batching — no current descriptor set exercises device-to-device parenting)
- [x] CLI: `epichem init-db`, `epichem db upgrade|downgrade|current`, `epichem import-dir`/
  `export-dir`, `epichem <kind> export|import` for all eight descriptor kinds, `epichem device
  list`, `epichem sample list|add`
- [x] Example "virtual lab" descriptor set (`descriptors/`) — 1 site → 1 lab → 1 zone → 1 workcell
  → 1 bench → 2 stations, 2 devices, 3 capability classes. Doubles as `test_cli.py`'s fixture and a
  template for a real lab's descriptor set, importable via `epichem import-dir`.
- [x] `docker compose up` on-ramp (Postgres + API container) — written to the standard Compose
  spec; **not exercised through Docker itself** in this sandbox (no Docker daemon available here).
  The underlying pieces it wires together (schema-on-Postgres, import-dir, API) are separately
  verified against sqlite as above; neither the compose file nor real Postgres is.

Frontend (`frontend/` — React + TypeScript + plain CSS on Vite, added after the ADR 0004 pivot):

- [x] App shell — sidebar nav, screen header, list + right-hand inspector two-pane layout, taking
  its visual language from the approved standalone HTML prototype and its colors/type from
  `project_plan/DESIGN.md` (transcribed into `src/styles/tokens.css`). Fonts fall back to
  system-ui/Arial rather than linking Google's CDN (DESIGN.md §3, GDPR); drop self-hosted Roboto
  into `public/fonts/` to get the real face.
- [x] **Topology screen** — the containment hierarchy as an expandable tree with a per-node
  inspector, over the six topology list endpoints. Rows whose parent is missing from the registry
  are surfaced in a callout rather than silently dropped.
- [x] **Devices screen** — summary strip + card grid + inspector, filtered through the query
  parameters `GET /api/v1/devices` already supports (`lab`, `capability_class`, `mode`).
- [x] **Samples screen** — a plain table over the new samples endpoint, plus a register form,
  state changes and delete.
- [x] **Lab layout screen (isometric)** — plan §10's floor plan, on `@joint/core` (MPL-2.0) only:
  no JointJS+ component anywhere. Projection is §10.3's formulas as pure, unit-tested functions
  (`isometric.ts`), including the inverse that makes drag-to-move snap to a cell. Click a station
  to inspect it; in edit mode, drag it to a new cell and the move is PUT to the registry. The
  canvas holds no authoritative state (§10.3), so a rejected write snaps the tile back. Stations
  outside their bench grid, or sharing a cell, are called out rather than drawn wrong. Lazy-loaded,
  since JointJS is ~435 kB and the other three screens don't need it.
  **This closes M1's exit criterion**: a real lab room is modelled and renders correctly.
  Not built from §10: multi-bench rooms, zone drawing, station create/delete, bench resize,
  multi-select, align/distribute, copy-paste, undo/redo, and every layer that needs live state.
- [x] No mock data anywhere: every screen reads the real API, and says so plainly when the backend
  is unreachable. Dev server proxies `/api` to `:8000`, so local dev needs no CORS (the backend
  grew an opt-in `EPICHEM_CORS_ORIGINS` for other deployments; off by default).
- Deliberately not added: React Router (a ~30-line hash router instead), a data-fetching library
  (one `useAsync` hook), a UI kit or CSS framework, OpenAPI codegen (hand-written types).

Not built (M1-adjacent, deferred):

- [ ] Nothing runs in CI. There is no pipeline at all — see the Delivery section below.
- [ ] NetBox sync (deferred per ADR 0002)
- [ ] Full auth/RBAC (§12.1). A shared-token gate on writes now exists (see Known gaps); real
  per-user identity, roles and SSO do not.

Hardening done in a later pass (see `git log`):

- [x] **Alembic migrations** — `epichem init-db` is `alembic upgrade head`, so creating and
  upgrading a schema are the same path. `epichem db upgrade|downgrade|current` alongside it, and
  a test asserting the migration tree produces exactly the schema the models declare.
- [x] **Shared-token auth on writes** + `Revision.created_by`, which was nullable and always null.
- [x] **Pagination** on `/samples` and `/devices` (`limit`/`offset` + `X-Total-Count`), with the
  frontend pager to match. Topology lists are deliberately unpaged.
- [x] **Four backend defects found and fixed** in a read-through: devices with a station binding
  could never be deleted (or, on sqlite, left orphaned rows); sqlite ran with foreign keys
  unenforced, so the test suite couldn't catch integrity bugs at all; `export-dir` could silently
  overwrite one topology row with another; and two real columns were missing from the API and from
  revision snapshots.
- [x] **Frontend tests** (Vitest) — 42 covering the tree builder, the API client's error handling,
  and the pager.
- [x] **ADR 0006**: no Redis until M2, with the reasoning written down.

## M2 — Device plane

**Status: not started.** No real devices behind IOCs, no queueserver, no `plans_allowed`/
`devices_allowed` introspection service (the palette-generation mechanism the plan calls "the
single highest-leverage integration in the project," §9.2), no MQTT state tree, no Devices screen,
no layout editor.

## M3 — Procedure designer

**Status: not started.** No IR schema, no DAG canvas, no validator, no `qserver` compile backend.
One decision recorded ahead of time (ADR 0003 Q1 update): the canvas will use **React Flow** (MIT),
not JointJS — §10.2 lists it as the sanctioned alternative for the procedure DAG specifically.
Nothing to build against yet.

## M4 — Samples & provenance

**Status: not started, with one deliberate exception.** A *minimal* `Sample` row exists — flat
fields, no composition list, no containers, no event log, no lineage — so the Samples screen has
something real to read. See `docs/adr/0005-minimal-sample-model-ahead-of-m4.md` for exactly what is
in and out, and `backend/epichem/models/sample.py` for the per-field deferrals. Sample writes reuse
the ADR 0004 revision machinery, so they're audited like every other kind.

Still not built: `Substance`/`Batch`/`Container`/`Labware`/`Slot`, §7.2 composition with `pint`
units, §7.3's `SampleEvent` log (so lifecycle transitions are unvalidated and `location` is an
editable string rather than derived), §7.4 lineage DAG + PROV-O, §7.5 DataMatrix marking, and the
ELN adapter (blocked on the ELN-target decision above). Two forward migrations are known and
accepted: `substance` and `location` become foreign keys.

## Delivery — CI/CD, containers, Helm, screenshots

**Status: not started, specified.** Outside the plan's M0–M6 numbering because it's delivery
infrastructure rather than product scope, but it blocks anything involving a second machine — a
developer's laptop is currently the only supported way to run EPIChem.

Full specification: `docs/MILESTONE_CI_CD.md`. In short: backend + frontend Docker images, a
`docker compose` that actually brings up the whole stack (the current one covers Postgres and the
API only, and has never been run against a real Docker daemon), a GitLab pipeline with lint/test/
build/deploy stages including a run of the suite against real Postgres, Helm charts for a test and
a production cluster with migrations as a pre-upgrade hook, and automated UI screenshots via
Playwright.

Sequenced deliberately *after* the isometric layout and the hardening pass: CI/CD makes a
deployment reachable by other people, and until this pass the API had no auth, no migrations and
no pagination. Two of the three prerequisites are now done; the layout view is the remaining one.

## M5 — Scheduler & scale

**Status: not started.**

## M6 — Depth

**Status: not started.**

---

## Known gaps worth flagging explicitly

- **Auth is a shared token, not an identity system.** Writes require a bearer token from
  `EPICHEM_API_TOKENS` and the token's label lands in `Revision.created_by` (`api/auth.py`) —
  so the audit trail says *which token*, not *which person*. Reads are open. With the variable
  unset, writes are unauthenticated and the API says so at startup. §12.1's OIDC/RBAC design is
  still owed, and `api/auth.py::require_write_token` is the seam it replaces.
- **Postgres is still unverified since the ADR 0004 rewrite.** The whole suite runs on sqlite.
  A `test:postgres` CI stage is specified in `docs/MILESTONE_CI_CD.md` precisely for this.
- **No observability** (§12.3 OpenTelemetry) — nothing to debug a distributed run with yet, but
  there's also no distributed run yet, so this tracks M2+, not a current regression.
- Two small schema/spec mismatches the original reconciler build surfaced (still present — the
  ADR 0004 rewrite reused the same descriptor schemas) and one was fixed, two weren't (all three
  are cosmetic, not correctness bugs):
  - `CapabilityClass.iri` now round-trips from `metadata.iri` in the YAML (fixed, verified against
    Postgres) — it didn't originally, because the pydantic `Metadata` schema had no `iri` field
    even though the plan's own §6.3 example includes one.
  - `TransportSpec.quality` (`nominal`/`degraded`, §6.2's flag for a degraded vendor-bridge
    onboarding path) is accepted by the loader but the `Device` ORM model has no column for it —
    silently discarded. Low priority: nothing sets it to `"degraded"` in the current example set.
  - `Signal` rows are never populated by anything yet (by design — that's M2's introspection
    service), so `GET /api/v1/devices/{id}/signals` always returns `[]` today.

## How to verify current state

```bash
cd backend
.venv/bin/pytest              # 91 tests, sqlite in-memory, seconds
.venv/bin/ruff check epichem tests
.venv/bin/epichem init-db && .venv/bin/epichem import-dir --descriptors-dir ../descriptors \
  && .venv/bin/epichem device list && .venv/bin/epichem sample list
.venv/bin/uvicorn epichem.api.app:app --reload   # → /docs for interactive OpenAPI

cd ../frontend
npm install && npm run build   # tsc --noEmit + production bundle
npm run dev                    # → http://localhost:5173, proxies /api to :8000
```
