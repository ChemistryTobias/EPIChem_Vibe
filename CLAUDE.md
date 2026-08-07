# EPIChem — repo notes for Claude Code

> **Start here if you have no memory of the previous sessions:**
> `PROJECT_MILESTONES.md` — the honest record of what's actually built vs. what the plan
> describes. The delivery path (container stack + GitLab CI) has been executed end-to-end and is
> green; the test suites, lint and typecheck are verified. Current work is **M2 — Device plane**:
> the topology flatten and metric lab canvas are built (ADRs 0007–0010); the Device-Management
> shell (Device Status + New-Device-first creation flow) and NetBox/CSV import are next.
> (The old `docs/SESSION_HANDOFF.md` was deleted 2026-08-07 — it had gone stale, pinned to a
> commit six commits behind `main`.)

Full spec: `project_plan/EPIChem_Project_Plan.md` (68K, read it before touching architecture —
§3 Non-Goals is binding: don't let this project grow an execution engine, a device driver layer,
an ELN, or a raw-data store; those are explicitly delegated elsewhere). Design/brand reference:
`project_plan/DESIGN.md`. Decision log: `docs/adr/` — read it before re-deciding something already
decided there. Milestone status: `PROJECT_MILESTONES.md` — the honest record of what's actually
built vs. what the plan describes; update it when scope changes, don't let it drift from reality.

## Working in this repo

- Backend: `backend/epichem/` (Python, FastAPI, SQLAlchemy 2.0, Pydantic v2). Venv at
  `backend/.venv` — `.venv/bin/pytest`, `.venv/bin/ruff check epichem tests`,
  `.venv/bin/epichem <command>`.
- No Postgres needed for local dev/tests: `epichem/db.py` falls back to a local sqlite file, and
  tests use an in-memory sqlite engine with `StaticPool` (required for in-memory sqlite —
  otherwise each connection gets its own empty database).
- Descriptor YAML lives in `descriptors/` at the repo root (topology/classes/devices) — an example
  virtual lab, importable via `epichem import-dir` (ADR 0004: the database is the versioned source
  of truth, not git; YAML is export/import interchange). It's also `test_cli.py`'s fixture; don't
  restructure it without checking that file.
- Frontend: `frontend/` (React 19, TypeScript, plain CSS, Vite). `npm run dev` (proxies `/api` to
  `:8000`, so no CORS setup), `npm run typecheck`, `npm run build`. Read `frontend/README.md`
  before adding a dependency — the absence of a router, data-fetching library, UI kit and codegen
  is deliberate and each one is argued there.
- Every module has a one-line docstring pointing back to the plan section it implements. Keep
  doing that — it's what makes "why does this field exist" answerable without re-reading the
  68K-word spec each time. The frontend does the same, in `/** */` headers.

## Conventions established so far

- **Topology is being reworked for M2 (ADRs 0007–0009) — the code below still ships M1's model.**
  The current `Site → Lab → Zone → Workcell → Bench → Station` + `StationDeviceBinding` schema is
  what's in the tree today; M2 flattens it to `Site → Lab → Zone(optional) → Station → Module →
  Device` (Station = a group of ≥1 device; `Workcell`/`Bench` dropped; grid geometry moves to
  `Lab`, execution fields to `Station`; `Module` folds into the `Device` containment tree). The
  UI section renames Topology → **Device Management** (Hierarchy / Device Status / Lab Layout).
  Read ADRs 0007–0009 before touching `models/topology.py`, `importer.py`, the descriptor schemas,
  or the frontend screens — don't rebuild against the old six-level model.
- Enumerated fields (environment_class, atmosphere, workcell state, ...) are plain strings
  validated at the pydantic descriptor layer, not DB enums — see the module docstring in
  `models/topology.py` for why.
- Registry mutation goes through `epichem/registry.py`'s `create_entity`/`update_entity`/
  `delete_entity` — the write API (`api/routers/`) and YAML import (`epichem/importer.py`) both
  call these, so every write records a `Revision` (ADR 0004) regardless of which path made it.
  Don't write directly to ORM rows outside tests.
- `Sample` is the one registry kind that is *not* descriptor YAML — it takes a plain JSON body
  (`schemas/sample.py`), has no import/export, and is absent from `Kind`/`SPEC_BY_KIND`/
  `TOPOLOGY_WRITE`/`KIND_CLI` on purpose. It's operational data, not configuration; see ADR 0005
  before "fixing" that inconsistency. Its writes still go through `registry.py`, so they're
  revisioned like everything else.
- The frontend hand-mirrors the API response schemas in `frontend/src/api/types.ts`. If you change
  a `*Out` model in `api/schemas.py`, change that file too — nothing checks it for you.
- The Descriptor->registry-row translation (`resolve_topology_values`, `device_values`,
  `capability_class_values`, the `TOPOLOGY_WRITE` table) lives once in `epichem/importer.py` and
  is imported by both the write API routers and the CLI/import path — don't add a second copy in
  a new call site.

## Process

- ADRs (`docs/adr/NNNN-title.md`) for any decision with real weight — see `docs/adr/0000-adr-process.md`
  for the format. Don't silently redecide something already in the log; supersede it explicitly if
  it needs to change.
- Commit and push at logical checkpoints, not one giant commit — this project is meant to be
  buildable incrementally and reviewable that way.
- A project-specific subagent, `karpathy-guidelines` (`.claude/agents/karpathy-guidelines.md`),
  encodes Andrej Karpathy's LLM-coding-pitfall guidelines (think before coding, simplicity first,
  surgical changes, goal-driven execution with verifiable success criteria). Prefer it for
  self-contained, testable features. It's a project-level agent file — if a session's Agent tool
  doesn't list it as an available `subagent_type`, agent definitions are loaded at session start,
  so it needs a fresh session to register; until then, inline its guidelines into a
  `general-purpose` agent's prompt instead (see how `registry.py` was delegated for a template).
