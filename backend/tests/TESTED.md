# What used to be tested here

`backend/tests/` targeted `epichem.*` (the old, now-deleted backend)
exclusively — 101 tests, sqlite + a real Postgres service in CI. Deleted
alongside `backend/epichem/`; this file is what's left, so a future test
suite for `backend/app/` knows what coverage to rebuild rather than
guessing from scratch.

- **`test_api.py` / `test_api_write.py`** — CRUD + PUT/DELETE over the
  registry kinds (Site/Lab/Zone/Station/Device/CapabilityClass) through the
  HTTP API, including that every write recorded a `Revision`.
- **`test_api_health.py`** — the health endpoint: 200 when the DB answers,
  open without a token, 503 when the DB is unreachable, reports the current
  schema/migration revision.
- **`test_api_samples.py`** — the flat-body Sample API (no envelope, unlike
  every other kind).
- **`test_auth.py`** — shared-token auth: reads open, writes need a bearer
  token only when `EPICHEM_API_TOKENS` was set, token label landed in
  `Revision.created_by`.
- **`test_cli.py`** — `epichem device list` / `sample list` CLI output.
- **`test_descriptor_loader.py`** — YAML descriptor directory loads into the
  right descriptor kinds/counts with no errors.
- **`test_integrity.py`** — regression tests for specific bugs that were
  real: SQLite FK enforcement actually on, deleting a device cascades its
  signals but not its station, `export_dir` not letting two rows with
  colliding slugs overwrite each other, `DeviceOut` exposing every column.
- **`test_migrations.py`** — the Alembic migration tree produces exactly the
  schema the SQLAlchemy models declare (catches migration/model drift).
- **`test_models.py`** — basic ORM relationship/persistence sanity
  (Site→Lab→... chain persists).
- **`test_pagination.py`** — limit/offset paging: `X-Total-Count` reports
  the pre-window total, offset walks the set without gaps, out-of-range
  params rejected, filters respected, topology lists deliberately unpaged.
- **`test_registry.py`** — the shared write service (`create_entity`/
  `update_entity`/`delete_entity`): revision-per-write, duplicate
  natural-key rejection, no-op update writes no revision, device creation
  resolving its capability class + station references.

None of this runs against `backend/app/` today — `backend/app/` has zero
tests. Rebuilding coverage there should probably start with: write API +
revision recording (now live, see `app/core/revisions/`), auth (now live,
see `app/core/access_control/`), and pagination (`app/core/pagination.py`
already matches the `X-Total-Count` convention above).
