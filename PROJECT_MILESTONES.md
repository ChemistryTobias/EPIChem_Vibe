# PROJECT_MILESTONES.md

Tracks actual implementation status against the milestone table in
`project_plan/EPIChem_Project_Plan.md` §14. That document is the spec; this one is the honest
record of what exists. Update it whenever scope changes — don't let it drift from `git log`.

Full milestone table for reference: M0 (decisions) → M1 (topology & registry) → M2 (device plane)
→ M3 (procedure designer) → M4 (samples & provenance) → M5 (scheduler & scale) → M6 (depth).
Sequencing is deliberate per §14: "topology before devices, devices before procedures... inverting
any pair produces rework." This build follows that order and stops partway through M1.

---

## M0 — Decisions & spec

**Status: closed for this implementation pass.**

All ten §17 open questions answered in `docs/adr/0000`–`0003` (reconciler shape — since superseded,
see ADR 0004 — NetBox scope, workcell granularity, EPICS-only for now, xDL deferred, manual steps
in v1, single-tenant schema, calibration data location). Two remain genuinely open, by design, not
oversight:

- **JointJS+ vs. `@joint/core`** — a frontend now exists, but still nothing that needs a canvas:
  the Topology screen is a tree. Two related decisions were recorded in ADR 0003 Q1's update
  without answering this one: the M3 procedure editor will use **React Flow** (MIT), and the
  bundled HTML prototype's isometric floor plan turns out to use **only `@joint/core` APIs**
  (`dia.Graph`/`dia.Paper`/`Element.define`, hand-built polygon tiles) — so the free-tier path is
  already demonstrated for that view. Decide for real when the isometric layout is built.
- **ELN target (Chemotion / Kadi4Mat / both)** — needs an institutional decision this session
  can't make; deferred to M4.

## M1 — Topology & registry

**Status: core done, re-architected mid-pass (ADR 0004); a frontend now exists, but the
isometric layout — M1's actual exit criterion — does not.**

The registry was originally built git-YAML-as-desired-state (ADR 0001), reconciled into Postgres by
a one-way reconciler. Partway through M1, scope was explicitly revised: Postgres is now the
versioned source of truth for topology/device/capability-class config, not git — every write
(HTTP or CLI) records a full-snapshot `Revision`, and YAML becomes an export/import interchange
format instead. See `docs/adr/0004-database-is-source-of-truth-not-git.md` for the full rationale
(modeled on Kadi4Mat's resource-revision pattern). `reconciler.py` and its test suite were removed;
nothing in the current tree implements git-desired-state reconciliation or drift detection.

Built (all covered by the 39-test suite in `backend/tests/`, sqlite in-memory — **not yet
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
- [x] CLI: `epichem init-db`, `epichem import-dir`/`export-dir`, `epichem <kind> export|import`
  for all eight kinds, `epichem device list`
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
- [x] No mock data anywhere: every screen reads the real API, and says so plainly when the backend
  is unreachable. Dev server proxies `/api` to `:8000`, so local dev needs no CORS (the backend
  grew an opt-in `EPICHEM_CORS_ORIGINS` for other deployments; off by default).
- Deliberately not added: React Router (a ~30-line hash router instead), a data-fetching library
  (one `useAsync` hook), a UI kit or CSS framework, OpenAPI codegen (hand-written types).

Not built (still M1-scoped per the plan, but out of reach this pass):

- [ ] **Isometric layout viewer (read-only)** — the plan's actual M1 exit criterion is "a real lab
  room is modelled in git **and renders correctly**." The model half is done and there is now a
  frontend, but the Topology screen is a *tree*, not the isometric canvas §10 specifies. Still the
  single biggest gap between what's here and what M1 asks for. When it's picked up: the bundled
  prototype already demonstrates an isometric floor plan built on `@joint/core` alone — see
  ADR 0003 Q1's update.
- [ ] Frontend tests — there are none. The three screens were verified by rendering them headlessly
  against a seeded backend (real rows, zero console errors, inspectors populated on select) plus
  `tsc --noEmit` and a production build, but nothing runs in CI. `topologyTree.ts` is pure and is
  the obvious first thing to cover.
- [ ] Alembic migrations — deliberately deferred (not an ADR-level decision, just noted here):
  `epichem init-db` uses `Base.metadata.create_all`, fine while the schema is still finding its
  shape. Add real migrations once it stabilizes and a second deployment needs to upgrade in place.
- [ ] NetBox sync (deferred per ADR 0002)
- [ ] Auth/RBAC (§12.1) — **neither the read nor the write API has any authentication.** The write
  path's `Revision.created_by` is nullable and currently always null. Fine for local dev against
  the sqlite fallback; do not point it at anything reachable by anyone else.

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

## M5 — Scheduler & scale

**Status: not started.**

## M6 — Depth

**Status: not started.**

---

## Known gaps worth flagging explicitly

- **No auth anywhere.** Don't deploy this past localhost until §12.1 is addressed. Note this now
  covers sample records, not just config: anyone who can reach the API can register, re-state or
  delete a sample, and `Revision.created_by` is still always null.
- **`GET /api/v1/samples` has no pagination.** Fine for a lab being built out, not for a real
  sample population — fix before that.
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
.venv/bin/pytest              # 49 tests, sqlite in-memory, seconds
.venv/bin/ruff check epichem tests
.venv/bin/epichem init-db && .venv/bin/epichem import-dir --descriptors-dir ../descriptors \
  && .venv/bin/epichem device list && .venv/bin/epichem sample list
.venv/bin/uvicorn epichem.api.app:app --reload   # → /docs for interactive OpenAPI

cd ../frontend
npm install && npm run build   # tsc --noEmit + production bundle
npm run dev                    # → http://localhost:5173, proxies /api to :8000
```
