# Contributing to EPIChem

This is the working guide: how to run it while you change it, how the repo is laid out, and the
conventions the code already follows. The [README](README.md) is the one-minute version; the full
rationale for the architecture is in [`project_plan/EPIChem_Project_Plan.md`](project_plan/EPIChem_Project_Plan.md)
and the decision log in [`docs/adr/`](docs/adr/).

## Seeing your changes live

There are two loops. Use the second one when you want a fast edit/reload cycle on one half.

### The whole stack, with hot reload

```bash
docker compose up          # → http://localhost:5173
```

`compose.yaml` bind-mounts `backend/epichem/` and `frontend/src/` into the running containers, so
editing either updates the live stack — uvicorn `--reload` restarts the API, and Vite hot-replaces
the frontend in the browser. This is the supported path and needs nothing but Docker.

### One half at a time (tightest loop)

Faster to start, and what CI does for lint and tests. No Postgres required — the backend falls
back to a local sqlite file.

**Backend** (from `backend/`):

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

.venv/bin/epichem init-db                                    # schema, sqlite fallback
.venv/bin/epichem import-dir --descriptors-dir ../descriptors  # example lab
.venv/bin/uvicorn epichem.api.app:app --reload               # → http://localhost:8000/docs
```

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev                # → http://localhost:5173, proxies /api to :8000
```

The Vite dev server proxies `/api` to the backend, so the browser talks to one origin and **no
CORS setup is needed** ([`frontend/vite.config.ts`](frontend/vite.config.ts)). Point it elsewhere
with `EPICHEM_API_URL=http://host:port npm run dev`.

If you're in the dev container, `post-create.sh` has already done both installs.

### Before you push

The pipeline runs all of these; run them locally first so you don't burn a CI cycle.

```bash
# backend, from backend/
.venv/bin/pytest                       # 95 tests, sqlite in-memory
.venv/bin/ruff check epichem tests

# frontend, from frontend/
npm run typecheck                      # tsc --noEmit
npm test                               # 63 tests
npm run build                          # typecheck + production bundle
```

## Project structure

```
backend/epichem/          Python — FastAPI, SQLAlchemy 2.0, Pydantic v2
  db.py                   Engine/session; Postgres via DATABASE_URL, sqlite fallback
  idgen.py                UUIDv7 generation
  models/                 ORM: topology (Site..Station), Device/Signal, CapabilityClass,
                          sample.py (minimal §7 slice, ADR 0005), revision.py (write history, ADR 0004)
  registry.py             Versioned write layer — create/update/delete_entity, each records a Revision.
                          ALL writes go through here (API and YAML import both call it).
  schemas/                Pydantic descriptor schemas — also the write API's request bodies
  descriptors/loader.py   Reads a descriptors dir into validated Descriptor objects
  importer.py             Descriptor → registry-row translation, shared by the write API and import
  exporter.py             Registry rows → descriptor YAML
  api/                    FastAPI read + write endpoints (§8.1 subset), RFC 9457 error responses
    routers/health.py     /api/v1/health — for container/cluster probes
  alembic/                Migration tree; ships inside the package
  cli.py                  epichem init-db | db upgrade|... | import-dir | export-dir | <kind> export|import
                          | device list | sample list|add

frontend/                 React 19 + TypeScript + plain CSS (Vite). Four screens, all against the real
                          API — see frontend/README.md for its internal layout and design choices.

descriptors/              Example "virtual lab" — a template descriptor set, importable via import-dir.
                          Also test_cli.py's fixture; don't restructure without checking that file.

deploy/                   Delivery tooling (not app code): seed.sh (idempotent seeding),
                          screenshots.mjs (Playwright console shots — the README image + a CI smoke test)

compose.yaml              Dev stack (the command above)      compose.prod.yaml   Production stack
.gitlab-ci.yml            lint → test → build → verify → deploy

docs/adr/                 Decision log (read before re-deciding anything)
docs/HOST_SETUP.md        Everything needing Docker, a browser, or another machine
docs/MILESTONE_CI_CD.md   The CI/CD spec this pipeline implements
project_plan/             Full spec + DESIGN.md brand reference
PROJECT_MILESTONES.md     Honest record of what's built vs. what the plan describes
```

## Conventions worth knowing

> **Heads-up before you build topology:** the model was flattened for M2 (built and merged).
> ADRs 0007–0010 replaced M1's `Site → Lab → Zone → Workcell → Bench → Station` with
> `Site → Lab → Zone(optional) → Station → Module → Device` (a Station is a group of ≥1 device;
> `Workcell`/`Bench` and `StationDeviceBinding` are gone; layout geometry is metric on `Lab`,
> ADR 0010), demoted NetBox to an optional late-stage import (ADR 0008), and renamed the Topology
> screen to **Device Management** (Hierarchy / Device Status / Lab Layout) with a New-Device-first
> creation flow. Read those ADRs before changing `models/topology.py`, `importer.py`, the
> descriptor schemas or the topology screens — don't reintroduce the six-level model.

These are the ones that bite if you don't know them; the rest are documented inline (every module
has a one-line docstring pointing at the plan section it implements — keep doing that).

- **Never write ORM rows directly** outside tests. Go through `registry.py` so every write records
  a `Revision` (ADR 0004).
- **The Descriptor → registry-row translation lives once** in `importer.py`, imported by both the
  API routers and the CLI. Don't add a second copy at a new call site.
- **`Sample` is deliberately not descriptor YAML** — it's operational data with a plain JSON body,
  absent from the descriptor machinery on purpose (ADR 0005). Its writes are still revisioned.
- **The frontend hand-mirrors the API schemas** in `frontend/src/api/types.ts`. If you change a
  `*Out` model in `api/schemas.py`, change that file too — nothing checks it for you.
- **Enumerated fields are validated strings, not DB enums** (see the docstring in
  `models/topology.py` for why).

## Process

- **Commit in small, logical checkpoints**, not one giant commit — this project is meant to be
  buildable and reviewable incrementally. Commit and push directly to `main`.
- **Write an ADR** (`docs/adr/NNNN-title.md`, format in `0000-adr-process.md`) for any decision
  with real weight, and don't silently redecide something already in the log — supersede it
  explicitly.
- **Keep `PROJECT_MILESTONES.md` honest** — update it when scope changes; don't let it drift from
  what actually runs.
</content>
