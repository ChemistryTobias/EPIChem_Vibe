# EPIChem

Lab orchestration control plane for MPI-FKF. Full spec: `project_plan/EPIChem_Project_Plan.md`.
Decisions made to unblock implementation: `docs/adr/`. Progress against the plan's milestones:
`PROJECT_MILESTONES.md`.

This repo implements the **registry** — the topology + device + capability-class model
from plan §5/§6, plus a deliberately minimal sample model (ADR 0005) — and a **web console** over
it. The database (Postgres, sqlite fallback for local dev) is the versioned source of truth
(ADR 0004); YAML is an export/import interchange format, not desired state. The console has four
screens — an isometric lab layout, a topology tree, devices and samples — which completes M1. It
does not yet run Bluesky or talk to real hardware; see PROJECT_MILESTONES.md for what's next.

## Run it

```bash
docker compose up
```

That's the whole thing. Open **<http://localhost:5173>**.

You get Postgres, the schema migrated to head, the example virtual lab imported, three samples,
the API on `:8000` and the console on `:5173` — with hot reload on both halves, so editing
`backend/epichem/` or `frontend/src/` updates the running stack. No `.env`, no arguments, no
prerequisites beyond Docker. Copy `.env.example` to `.env` only if you need to change a port or
try the auth path.

The services come up in a fixed order, and the arrows are enforced rather than hoped for:

```
db  ->  migrate  ->  seed  ->  api  ->  web
```

`migrate` and `seed` are one-shot containers that must exit successfully before the next service
starts. That is what makes a single `docker compose up` land on a console with data in it instead
of on an empty database, or on an API serving 500s while migrations are still running.

```bash
docker compose logs -f api     # follow one service
docker compose down            # stop; the database volume survives
docker compose down -v         # stop and delete the data, for a clean start
```

> **Not yet verified.** The compose stack, both Dockerfiles and the CI pipeline were written
> without a Docker daemon available — see `docs/HOST_SETUP.md` §0 for exactly what has and hasn't
> been executed. The test suites, lint and typecheck are all green and *are* verified. If
> `docker compose up` doesn't work first try, that's the reason, and §2 of that document is the
> debugging checklist.

## Working on it without Docker

The container stack is the supported path, but everything runs directly too, which is faster for a
tight edit/test loop and is what CI does for lint and tests.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

.venv/bin/pytest                       # 95 tests, sqlite in-memory
.venv/bin/ruff check epichem tests

# schema + example lab, using the sqlite fallback — no Postgres needed
.venv/bin/epichem init-db
.venv/bin/epichem import-dir --descriptors-dir ../descriptors
.venv/bin/epichem device list

.venv/bin/uvicorn epichem.api.app:app --reload     # → :8000/docs
```

```bash
cd frontend
npm install
npm run typecheck && npm test          # 63 tests
npm run dev                            # → :5173, proxies /api to :8000
```

If you are using the dev container, `post-create.sh` has already done both installs.

## Deploying it

`compose.prod.yaml` runs the same stack from prebuilt images with no build step, no bind mounts
and no dev dependencies. Its secrets have no defaults — it refuses to start without a real
database password and API tokens, rather than quietly booting with `epichem`/`epichem` on a
machine other people can reach.

`.gitlab-ci.yml` builds and pushes both images, runs the suites (including one job against real
Postgres), brings the production images up together and drives the console in a headless browser
to prove they work, then deploys on a manual trigger from a release tag.

**`docs/HOST_SETUP.md` is the setup guide** — GitLab configuration, runner registration, the
production host, and what still needs a decision from FHI IT.

## Repository layout

```
backend/epichem/
  idgen.py           UUIDv7 generation
  db.py              SQLAlchemy engine/session (Postgres via DATABASE_URL, sqlite fallback)
  models/            ORM: topology (Site..Station), Device/Signal/StationDeviceBinding, CapabilityClass
  models/sample.py    Minimal Sample row — a deliberate slice of §7, see ADR 0005
  models/revision.py  Full-snapshot revision history, one row per entity write (ADR 0004)
  registry.py         Versioned write service layer: create/update/delete_entity, each recording
                       a Revision
  schemas/descriptor.py   Pydantic schemas for descriptor YAML — also the write API's request body
  descriptors/loader.py   Reads a descriptors directory into validated Descriptor objects
  importer.py          Descriptor -> registry-row translation, shared by the write API and YAML
                       import (epichem import-dir)
  exporter.py           Registry rows -> descriptor YAML (epichem <kind> export, export-dir)
  api/                FastAPI read + write endpoints (§8.1 subset) + RFC 9457 error responses
  api/routers/health.py   /api/v1/health — for container healthchecks and cluster probes, not users
  alembic/            Migration tree; ships inside the package so `epichem init-db` works anywhere
  cli.py              epichem init-db | db upgrade|downgrade|current | import-dir | export-dir
                       | <kind> export|import | device list | sample list|add

frontend/             React + TypeScript + plain CSS console (Vite). Four screens — Lab layout
                       (isometric, @joint/core), Topology (tree), Devices, Samples — all against
                       the real API. See frontend/README.md.

descriptors/          Example "virtual lab": one site/lab/zone/workcell/bench, two stations,
                       two devices, three capability classes — a template for a real lab's
                       descriptor set, importable via `epichem import-dir`.

deploy/               Delivery tooling, not application code: seed.sh (idempotent example-lab
                       seeding) and screenshots.mjs (Playwright console screenshots for CI).

compose.yaml          Development stack — the command at the top of this file.
compose.prod.yaml     Production stack, from prebuilt registry images.
.gitlab-ci.yml        lint -> test -> build -> verify -> deploy.

docs/adr/              M0 decision log (plan §17) + ADR 0004 (DB as source of truth)
                       + ADR 0005 (minimal Sample model) + ADR 0006 (no Redis until M2)
docs/HOST_SETUP.md     Everything that needs Docker, a browser, or another machine.
docs/MILESTONE_CI_CD.md  The CI/CD spec this pipeline implements, and what's still missing.
```

## Status

M1 complete (topology & registry + the isometric layout that is its exit criterion, plan §14),
plus a minimal sample model ahead of M4 (ADR 0005). Auth is a shared write token, not an identity
system. No NetBox sync, no ELN adapter, no scheduler, no procedure designer, no Bluesky
integration. CI/CD and the container stack are written but not yet exercised — see
`docs/HOST_SETUP.md` §0. Helm charts are specified and deliberately unbuilt, pending a decision
from FHI IT. See `PROJECT_MILESTONES.md` for the honest breakdown.
