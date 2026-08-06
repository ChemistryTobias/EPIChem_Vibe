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

All ten §17 open questions answered in `docs/adr/0000`–`0003` (reconciler shape, NetBox scope,
workcell granularity, EPICS-only for now, xDL deferred, manual steps in v1, single-tenant schema,
calibration data location). Two remain genuinely open, by design, not oversight:

- **JointJS+ vs. `@joint/core`** — moot until frontend work starts; no frontend exists yet.
- **ELN target (Chemotion / Kadi4Mat / both)** — needs an institutional decision this session
  can't make; deferred to M4.

## M1 — Topology & registry

**Status: core done and verified against real Postgres; frontend half not started.**

Built (all covered by the 28-test suite in `backend/tests/`, plus a one-off manual verification
against a real `postgres:17` instance — schema creation, reconcile, idempotent re-run, and the API
all confirmed working through the `psycopg` v3 driver the project actually depends on, not just
the sqlite fallback used for fast test runs):

- [x] Registry schema (SQLAlchemy): `Site → Lab → Zone → Workcell → Bench → Station`, `Device`
  (containment tree via `parent_id`), `Signal` (table exists, nothing populates it yet — that's
  ophyd introspection, M2), `CapabilityClass`, `StationDeviceBinding` (the
  Station↔Device many-to-many with a role, replacing the prototype's `STATIONS[].deviceId`)
- [x] Descriptor YAML schemas (pydantic) for every topology kind plus `Device` and
  `CapabilityClass`, matching the plan's §6.1/§6.3 examples field-for-field
- [x] Loader: reads a descriptors directory, validates, collects errors per-file instead of
  aborting on the first bad one
- [x] Reconciler (`epichem/reconciler.py`): git-YAML desired state → Postgres observed state.
  Cross-reference validation before any write (unresolvable references skip only that descriptor,
  never block siblings), idempotent, reports drift, **never auto-deletes** — a deliberate
  constraint (deleting a device record because its file was momentarily absent would be dangerous
  in a real lab), not an oversight
- [x] Read API (FastAPI): topology + devices + device-classes + signals endpoints (§8.1 subset),
  filterable (`?lab=`, `?capability=`, `?capability_class=`, `?mode=`), RFC 9457 problem+json on
  404, lookup by UUID or short code
- [x] CLI: `epichem init-db`, `epichem reconcile --descriptors-dir`, `epichem device list`
- [x] Example "virtual lab" descriptor set (`descriptors/`) — 1 site → 1 lab → 1 zone → 1 workcell
  → 1 bench → 2 stations, 2 devices, 3 capability classes. Doubles as the reconciler's test
  fixture and a template for a real lab's descriptor set.
- [x] `docker compose up` on-ramp (Postgres + API container) — written to the standard Compose
  spec; **not exercised through Docker itself** in this sandbox (no Docker daemon available here).
  The underlying pieces it wires together (schema-on-Postgres, reconcile, API) are separately
  verified as above; the compose file's own correctness is not.

Not built (still M1-scoped per the plan, but out of reach this pass):

- [ ] **Isometric layout viewer (read-only)** — the plan's actual M1 exit criterion is "a real lab
  room is modelled in git **and renders correctly**." The "modelled in git" half is done; there is
  no frontend at all yet, so "renders" isn't. This is the single biggest gap between what's here
  and what M1 asks for.
- [ ] Alembic migrations — deliberately deferred (not an ADR-level decision, just noted here):
  `epichem init-db` uses `Base.metadata.create_all`, fine while the schema is still finding its
  shape. Add real migrations once it stabilizes and a second deployment needs to upgrade in place.
- [ ] NetBox sync (deferred per ADR 0002)
- [ ] Auth/RBAC (§12.1) — **the read API has no authentication at all.** Fine for local dev
  against the sqlite fallback; do not point it at anything reachable by anyone else.

## M2 — Device plane

**Status: not started.** No real devices behind IOCs, no queueserver, no `plans_allowed`/
`devices_allowed` introspection service (the palette-generation mechanism the plan calls "the
single highest-leverage integration in the project," §9.2), no MQTT state tree, no Devices screen,
no layout editor.

## M3 — Procedure designer

**Status: not started.** No IR schema, no DAG canvas, no validator, no `qserver` compile backend.

## M4 — Samples & provenance

**Status: not started.** No sample/batch/container/labware model, no lineage DAG, no ELN adapter
(blocked on the ELN-target decision above).

## M5 — Scheduler & scale

**Status: not started.**

## M6 — Depth

**Status: not started.**

---

## Known gaps worth flagging explicitly

- **No auth anywhere.** Don't deploy this past localhost until §12.1 is addressed.
- **No observability** (§12.3 OpenTelemetry) — nothing to debug a distributed run with yet, but
  there's also no distributed run yet, so this tracks M2+, not a current regression.
- Two small schema/spec mismatches the reconciler build surfaced and one was fixed, two weren't
  (all three are cosmetic, not correctness bugs):
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
.venv/bin/pytest              # 28 tests, sqlite in-memory, seconds
.venv/bin/ruff check epichem tests
.venv/bin/epichem init-db && .venv/bin/epichem reconcile --descriptors-dir ../descriptors \
  && .venv/bin/epichem device list
.venv/bin/uvicorn epichem.api.app:app --reload   # → /docs for interactive OpenAPI
```
