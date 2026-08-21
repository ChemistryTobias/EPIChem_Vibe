# EPIChem docs

Lab orchestration control plane for MPI-FKF — the layer that knows what the
lab physically is, what each device can promise, and (eventually) how a
procedure becomes a validated, executable plan. EPIChem never runs
experiments itself; it administers and dispatches to Bluesky/EPICS, which do.

![EPIChem console — isometric lab layout](src/layout.png)

## Start here

- **[Roadmap](project_plan/EPIChem_Roadmap.md)** — current milestones and
  what's being built next. Read this first for "where are we."
- **[Project history](PROJECT_HISTORY.md)** — condensed decision log and
  milestone record for everything already built. Read this for "why is it
  built this way."
- **[API reference](API.md)** — the backend's endpoints, plainly listed.

## Reference

- **[Design reference](project_plan/DESIGN.md)** — MPG brand colors,
  type, component rules, and the current frontend's actual token values.
  Any UI rewrite should match this, not reinvent it.
- **[Original project plan](project_plan/project_plan_outdated.md)** —
  the full original specification (architecture, data model, non-goals).
  Superseded in sequencing by the Roadmap above, but still the detailed
  reference for anything the Roadmap points back to by section number.
- **[Host setup](HOST_SETUP.md)** — everything that needs a human: Docker,
  GitLab CI/CD configuration, production deployment.

## Run it

```bash
docker compose up   # → http://localhost:5173
```

Starts empty — see [`../scripts/README.md`](../scripts/README.md) for a
local-dev seed script. See the repo root [`README.md`](../README.md) for the
short version, or `HOST_SETUP.md` above for the full operational picture.

## Historical reference

- **[`descriptors_old/`](descriptors_old/)** — the old backend's YAML
  fixture set. Not used by anything today; kept for reference only.
