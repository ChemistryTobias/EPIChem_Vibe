# EPIChem — repo notes for Claude Code

> **Start here on a cold start:** [`docs/index.md`](docs/index.md), then
> [`docs/project_plan/EPIChem_Roadmap.md`](docs/project_plan/EPIChem_Roadmap.md) for
> current milestones/status, then
> [`docs/PROJECT_HISTORY.md`](docs/PROJECT_HISTORY.md) for *why* things are
> built the way they are (condensed decision log + milestone history).

Full original spec: [`docs/project_plan/project_plan_outdated.md`](docs/project_plan/project_plan_outdated.md)
— still the binding reference for architecture, the canonical data model,
and §3's Non-Goals, except where the Roadmap explicitly re-sequences
something. Design reference: [`docs/project_plan/DESIGN.md`](docs/project_plan/DESIGN.md)
(brand rules **and** the current frontend's actual token values — match
this on any UI work, don't re-derive it from the brand manual). API
reference: [`docs/API.md`](docs/API.md).

## Two backends, one active

- **`backend/app/`** — the active, in-progress rewrite. Vertical-slice:
  one file per concern per entity (`modules/device_managment/<entity>/
  {schema,api,logic}.py`), shared code in `app/core/` (`object` — id/name/
  description mixins; `geometry` — `GeometryDescriptor` + the
  `get_default_geometry` collision-free-placement pattern; `file_storage`;
  `pagination`). **New backend work happens here.**
- **`backend/epichem/`** — the original registry-pattern backend (models/
  schemas/api split, YAML descriptor import/export, a versioned `Revision`
  write service). Kept for reference — its design decisions are documented
  in `docs/PROJECT_HISTORY.md`. Don't add new features here.
- **`frontend/`** still targets the *old* API today. Repointing it at
  `backend/app/` (flat bodies, PATCH instead of full-replace PUT) is
  Roadmap milestone 0.3 — don't assume the frontend and `backend/app/`
  are wired together yet.

## Working in this repo

- **`backend/app/`** (active): `backend/.venv/bin/pytest`,
  `.venv/bin/ruff check app`. No Postgres needed for local dev — falls back
  to a local sqlite file.
- **`backend/epichem/`** (reference): `.venv/bin/pytest`, `.venv/bin/ruff
  check epichem tests`, `.venv/bin/epichem <command>`. Descriptor YAML in
  `descriptors/` at the repo root is this backend's import fixture and
  `test_cli.py`'s fixture — don't restructure without checking that file.
- **`frontend/`**: `npm run dev` (proxies `/api` to `:8000`), `npm run
  typecheck`, `npm run build`. Read `frontend/README.md` before adding a
  dependency — no router/data-fetching-library/UI-kit/codegen is deliberate,
  and each is argued there.
- Every module gets a one-line docstring pointing at the plan section or
  Roadmap milestone it implements. Keep doing that — it's what makes "why
  does this field exist" answerable without re-reading the full plan.

## Conventions

- **Registry mutation goes through a write service, not direct ORM writes**
  — `backend/epichem/registry.py`'s `create_entity`/`update_entity`/
  `delete_entity` record a `Revision` on every write (see
  `docs/PROJECT_HISTORY.md`'s "database is the source of truth" decision).
  `backend/app/` doesn't have a revision system yet — that's Roadmap 0.2,
  still an open design question, not yet a locked pattern to follow.
- **`backend/app/`'s geometry defaults**: each `Create*` schema's
  `object_geometry` field uses a Pydantic `default_factory` that opens its
  own short-lived DB session (Pydantic doesn't give a factory access to the
  request's session) to find a collision-free slot near the parent's
  existing children (`find_free_slot_2d`). See any `<entity>/logic.py`'s
  `get_default_geometry` for the pattern; keep new entities consistent
  with it rather than inventing a second placement mechanism.
- **The frontend hand-mirrors backend response schemas** in
  `frontend/src/api/types.ts`. If a backend `*Out`/response model changes,
  update that file too — nothing checks it for you.
- Enumerated fields (environment_class, atmosphere, operational mode, …)
  are plain validated strings, not DB enums, in both backends — see the
  module docstring in whichever `models`/`schema` file for why.

## Process

- **Commit in small, logical checkpoints**, not one giant commit. Push
  directly to `main` — this repo has no branch/MR workflow.
- **Record a new decision with real architectural weight** as a short new
  bullet under `docs/PROJECT_HISTORY.md`'s "Decisions" section (same
  condensed style as what's already there) rather than reviving a
  per-file ADR system — don't silently re-decide something already
  recorded there; note explicitly that it supersedes the earlier entry.
- **Keep `docs/project_plan/EPIChem_Roadmap.md` honest** — update status markers
  as milestones actually complete, don't let it drift from what's built.
- A project-specific subagent, `karpathy-guidelines`
  (`.claude/agents/karpathy-guidelines.md`, also loadable mid-session via
  the `karpathy-guidelines` skill), encodes Andrej Karpathy's
  LLM-coding-pitfall guidelines (think before coding, simplicity first,
  surgical changes, goal-driven execution with verifiable success
  criteria). Prefer it for self-contained, testable features.
