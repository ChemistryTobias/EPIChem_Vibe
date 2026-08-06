# EPIChem

Lab orchestration control plane for MPI-FKF. Full spec: `project_plan/EPIChem_Project_Plan.md`.
Decisions made to unblock implementation: `docs/adr/`. Progress against the plan's milestones:
`PROJECT_MILESTONES.md`.

This repo currently implements the **registry** — the topology + device + capability-class model
from plan §5/§6. The database (Postgres, sqlite fallback for local dev) is the versioned source of
truth (ADR 0004); YAML is an export/import interchange format, not desired state. It does not yet
run Bluesky, talk to real hardware, or have a frontend — see PROJECT_MILESTONES.md for what's next.

## Quick start (local, no Docker)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

# schema + example virtual lab, using the sqlite fallback (no Postgres needed)
.venv/bin/epichem init-db
.venv/bin/epichem import-dir --descriptors-dir ../descriptors
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

Brings up Postgres, runs `epichem init-db` + `epichem import-dir` against `./descriptors`, then
serves the API on `:8000`. (Written to the standard Compose spec; not exercised in the sandbox this
was built in — no Docker available there. Validate before relying on it.)

## Repository layout

```
backend/epichem/
  idgen.py           UUIDv7 generation
  db.py              SQLAlchemy engine/session (Postgres via DATABASE_URL, sqlite fallback)
  models/            ORM: topology (Site..Station), Device/Signal/StationDeviceBinding, CapabilityClass
  models/revision.py  Full-snapshot revision history, one row per entity write (ADR 0004)
  registry.py         Versioned write service layer: create/update/delete_entity, each recording
                       a Revision
  schemas/descriptor.py   Pydantic schemas for descriptor YAML — also the write API's request body
  descriptors/loader.py   Reads a descriptors directory into validated Descriptor objects
  importer.py          Descriptor -> registry-row translation, shared by the write API and YAML
                       import (epichem import-dir)
  exporter.py           Registry rows -> descriptor YAML (epichem <kind> export, export-dir)
  api/                FastAPI read + write endpoints (§8.1 subset) + RFC 9457 error responses
  cli.py              epichem init-db | import-dir | export-dir | <kind> export|import | device list

descriptors/          Example "virtual lab": one site/lab/zone/workcell/bench, two stations,
                       two devices, three capability classes — a template for a real lab's
                       descriptor set, importable via `epichem import-dir`.

docs/adr/              M0 decision log (plan §17) + ADR 0004 (DB as source of truth)
```

## Status

M1-scope only (topology & registry, plan §14). No auth, no NetBox sync, no ELN adapter, no
scheduler, no procedure designer, no Bluesky integration, no frontend. See
`PROJECT_MILESTONES.md` for the honest breakdown of what's built vs. deferred.
