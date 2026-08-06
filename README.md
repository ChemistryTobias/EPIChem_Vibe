# EPIChem

Lab orchestration control plane for MPI-FKF. Full spec: `project_plan/EPIChem_Project_Plan.md`.
Decisions made to unblock implementation: `docs/adr/`. Progress against the plan's milestones:
`PROJECT_MILESTONES.md`.

This repo currently implements the **registry** — the topology + device + capability-class model
from plan §5/§6, backed by git YAML descriptors and a reconciler, with a read API. It does not yet
run Bluesky, talk to real hardware, or have a frontend — see PROJECT_MILESTONES.md for what's next.

## Quick start (local, no Docker)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

# schema + example virtual lab, using the sqlite fallback (no Postgres needed)
.venv/bin/epichem init-db
.venv/bin/epichem reconcile --descriptors-dir ../descriptors
.venv/bin/epichem device list

# API
.venv/bin/uvicorn epichem.api.app:app --reload
# → http://127.0.0.1:8000/docs

# tests
.venv/bin/pytest
```

## Quick start (Docker Compose — Postgres-backed)

```bash
docker compose up --build
```

Brings up Postgres, runs `epichem init-db` + `epichem reconcile` against `./descriptors`, then
serves the API on `:8000`. (Written to the standard Compose spec; not exercised in the sandbox this
was built in — no Docker available there. Validate before relying on it.)

## Repository layout

```
backend/epichem/
  idgen.py           UUIDv7 generation
  db.py              SQLAlchemy engine/session (Postgres via DATABASE_URL, sqlite fallback)
  models/            ORM: topology (Site..Station), Device/Signal/StationDeviceBinding, CapabilityClass
  schemas/descriptor.py   Pydantic schemas for the git-backed descriptor YAML
  descriptors/loader.py   Reads a descriptors directory into validated Descriptor objects
  reconciler.py       Desired state (descriptors) → observed state (DB), reports drift
  api/                FastAPI read endpoints (§8.1 subset) + RFC 9457 error responses
  cli.py              epichem init-db | reconcile | device list

descriptors/          Example "virtual lab": one site/lab/zone/workcell/bench, two stations,
                       two devices, three capability classes — the reconciler's test fixture and
                       a template for a real lab's descriptor set.

docs/adr/              M0 decision log (plan §17)
```

## Status

M1-scope only (topology & registry, plan §14). No auth, no NetBox sync, no ELN adapter, no
scheduler, no procedure designer, no Bluesky integration, no frontend. See
`PROJECT_MILESTONES.md` for the honest breakdown of what's built vs. deferred.
