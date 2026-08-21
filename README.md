# EPIChem

Lab orchestration control plane for MPI-FKF — a versioned model of sites,
labs, stations and devices, with a web console over it. EPIChem administers
and dispatches; Bluesky/EPICS execute.

![EPIChem console — isometric lab layout](docs/src/layout.png)

## Run it

```bash
docker compose up
```

That brings up Postgres, the API on `:8000`, the console on `:5173`. The
database starts **empty** — see `scripts/README.md` for a local seed script,
or just create things through the console.

Open **<http://localhost:5173>**.

> The console still targets the old backend's API shape — Roadmap milestone
> 0.3 repoints it at the current backend. The API itself
> (`docker compose up api`, or just `curl localhost:8000/api/v1/health`)
> works today; the console doesn't yet.

```bash
docker compose logs -f api     # follow one service
docker compose down            # stop; the database volume survives
docker compose down -v         # stop and wipe the data, for a clean start
```

## More

- **[`docs/`](docs/index.md)** — start here for everything else: current
  roadmap, project history/decisions, API reference, design reference, and
  the full operations guide (`docs/HOST_SETUP.md`).
- **[`CLAUDE.md`](CLAUDE.md)** — working conventions for this repo.
