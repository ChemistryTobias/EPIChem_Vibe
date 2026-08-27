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

## The backend

`backend/app/` is the only backend — a vertical slice per entity, one file
per concern (`modules/device_managment/<entity>/{schema,api,logic}.py`),
shared code in `app/core/`: `shared_schema` (`object` — id/name/description
mixins; `geometry` — `GeometryDescriptor` + the `get_default_geometry`
collision-free-placement pattern), `access_control` (auth/users/groups),
`revisions` (audit trail, one row per write), `file_storage`, `pagination`.

The original registry-pattern backend (`backend/epichem/`) was deleted once
`app/` reached parity + auth + revisions — its design decisions are still
documented in `docs/PROJECT_HISTORY.md`, and what its 101 tests covered is
noted in `backend/tests/TESTED.md`.

**`frontend/` still targets that old, now-deleted API shape** (envelope
bodies, full-replace `PUT`). Repointing it at `backend/app/`'s flat
bodies/`PATCH` is Roadmap milestone 0.3 — don't assume the frontend and
`backend/app/` are wired together yet; running `docker compose up` today
gives you a working API and a console that errors against it.

## Working in this repo

- **Backend**: `backend/.venv/bin/pytest`, `.venv/bin/ruff check app`. No
  Postgres needed for local dev — falls back to an in-memory sqlite DB
  (`DATABASE_URL` env var to point at real Postgres). Note the in-memory DB is
  wiped on every restart, taking users and auth tokens with it, so the console
  signs you out each time; for a session that survives restarts run
  `docker compose up -d db` and set `DATABASE_URL` — see `.env.example`.
- **`frontend/`**: `npm run dev` (proxies `/api` to `:8000`), `npm run
  typecheck`, `npm run build`. Read `frontend/README.md` before adding a
  dependency — no router/data-fetching-library/UI-kit/codegen is deliberate,
  and each is argued there.
- Every module gets a one-line docstring pointing at the plan section or
  Roadmap milestone it implements. Keep doing that — it's what makes "why
  does this field exist" answerable without re-reading the full plan.

## Conventions

- **Every create/update/delete records a `Revision`** (`app/core/revisions/`)
  — full JSON snapshot + acting user, queryable via `GET /revisions`. Follow
  the pattern already in every `device_managment` entity's `api.py` rather
  than inventing a second write path.
- **Every endpoint requires a bearer token** (`app/core/access_control/`)
  except `POST /auth/login` and `POST /users` (bootstrap). No access
  *level* logic yet — see `app/core/access_control/README.md` for the
  options on the table.
- **Geometry defaults**: each `Create*` schema's `object_geometry` field
  uses a Pydantic `default_factory` that opens its own short-lived DB
  session (Pydantic doesn't give a factory access to the request's session)
  to find a collision-free slot near the parent's existing children
  (`find_free_slot_2d`). See any `<entity>/logic.py`'s `get_default_geometry`
  for the pattern; keep new entities consistent with it.
- **The frontend hand-mirrors backend response schemas** in
  `frontend/src/api/types.ts`. If a backend `*Out`/response model changes,
  update that file too — nothing checks it for you.
- Enumerated fields (environment_class, atmosphere, operational mode, …)
  are plain validated strings, not DB enums — see the module docstring in
  whichever `schema.py` for why.
- **No Alembic yet, on purpose** — `Database.metadata.create_all()` covers
  both sqlite and Postgres while the core entities are still actively
  gaining fields. See `docs/PROJECT_HISTORY.md`'s decision log.

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
