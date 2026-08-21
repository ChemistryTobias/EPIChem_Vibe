# scripts

Standalone local-dev helpers, run manually — not part of `docker compose up`.

## generate_seed.py

Seeds a fresh dev database via the real API (not a direct DB write — same
auth path a human would use): creates an admin user (`admin`/`12345678` —
`CreateUser` enforces an 8-char minimum, so plain `admin` doesn't validate),
logs in, then creates one site, two labs (one holding a station).

```bash
API_BASE_URL=http://localhost:8000 backend/.venv/bin/python scripts/generate_seed.py
```

Or via compose (see the commented-out `seed` service in `compose.yaml` —
uncomment and run `docker compose run --rm seed`).

**Abort condition**: refuses to run if a user named `admin` already exists
(`POST /users` returns `409`). This is a simple, currently-honest check —
there's no real admin/role flag on `User` yet, so "a user literally named
admin" is the closest available signal. Its real weakness: if the script
dies *after* creating the admin user but *before* finishing the
site/labs/station, a rerun sees the admin user, aborts immediately, and
never finishes seeding — a silently half-seeded stack with no way to detect
it from this check alone. A more robust version would make each step
idempotent (create-if-missing by name, the way the old backend's seed
script did) rather than a single hard abort at the start. Not built that
way here because it's more code for a script that's meant to run once on a
fresh stack; worth revisiting if this gets reused for anything less
predictable than local dev.
