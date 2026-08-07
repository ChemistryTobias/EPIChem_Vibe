# Milestone: GitLab CI/CD, containers, Helm, and automated UI screenshots

**Status: §1, §2, §3 and §5 are written and committed but have never been executed. §4 (Helm) is
deliberately not built.**

This started as a pure specification. Most of it now exists as files — `compose.yaml`,
`compose.prod.yaml`, both `Dockerfile`s, `.gitlab-ci.yml`, `deploy/screenshots.mjs` — but "exists
as files" is the whole of the claim: there was no Docker daemon and no GitLab runner in the
environment they were written in, so nothing here has run. `docs/HOST_SETUP.md` is the checklist
for making it real, and its §0 is the honest ledger of what is and isn't verified.

It sits outside the plan's M0–M6 numbering because it's delivery infrastructure rather than
product scope, but it blocks anything that involves a second machine.

Update this file as pieces are *verified*, not as they are written, and move the finished parts
into `PROJECT_MILESTONES.md`.

## Why it's after 1 & 3, not before

The isometric layout is M1's own exit criterion, and a pipeline that ships an incomplete M1 just
ships it faster. The hardening pass had to come first for a blunter reason: **CI/CD makes a
deployment reachable by other people**, and until this session the API had no authentication, no
migrations, and no pagination. Automating deployment of that would have been automating a mistake.
Those three are done (`docs/adr/0005`, `api/auth.py`, `epichem/alembic/`,
`api/pagination.py`), so the remaining blocker is genuinely just the layout view.

## Scope

### 1. Container images

Two images, built from this repo:

- **`epichem-backend`** — Python 3.13 slim base, `pip install .` (not `-e`), non-root user,
  `uvicorn epichem.api.app:app` as the entrypoint. Must run `epichem db upgrade` on start or via a
  separate init container/Job — never `create_all`, which no longer exists (ADR-less, see
  `epichem/migrations.py`).
- **`epichem-frontend`** — multi-stage: `node:20` to `npm ci && npm run build`, then a static
  server (nginx or Caddy) serving `dist/`. The dev-time Vite proxy does not exist in production, so
  the image needs an nginx rule proxying `/api` to the backend service, **or** the backend needs
  `EPICHEM_CORS_ORIGINS` set to the frontend's origin (`api/app.py` already supports this). Pick
  the proxy: it keeps the browser on one origin and avoids CORS entirely, matching dev.

Both tagged with the commit SHA and, on tags, the semver. Pushed to the GitLab container registry.

### 2. Full `docker compose`

`docker-compose.yml` today brings up Postgres and the backend only. Extend it to a complete local
stack:

- `db` (postgres:17) with a named volume and a healthcheck
- `migrate` — a one-shot `epichem db upgrade head` that the API waits on (`depends_on:
  condition: service_completed_successfully`)
- `api` — the backend image, `DATABASE_URL` pointing at `db`, `EPICHEM_API_TOKENS` from `.env`
- `web` — the frontend image, proxying `/api` to `api`
- `seed` (optional profile) — `epichem import-dir --descriptors-dir /descriptors` plus a couple of
  `epichem sample add` calls, so a fresh stack has something to show

Success criterion: `docker compose up` on a clean machine gives a working console at
`localhost:8080` with the example lab in it. That is §G8's "a single-cell lab should run from one
`docker compose up` with defaults", which the current compose file only half satisfies. Note the
existing file has **never been exercised against a real Docker daemon** — see
`PROJECT_MILESTONES.md` — so treat it as unverified, not as a working base.

### 3. GitLab CI pipeline

`.gitlab-ci.yml`, stages in order:

| Stage | What runs |
|---|---|
| `lint` | `ruff check epichem tests`; `npm run typecheck` |
| `test` | `pytest` (sqlite); `vitest run`. Both must publish JUnit XML so GitLab shows failures inline |
| `test:postgres` | the same pytest suite against a real `postgres:17` service — the suite has only ever run on sqlite, and `PROJECT_MILESTONES.md` flags that the ADR 0004 write path was never re-verified against Postgres |
| `build` | both images, tagged with `$CI_COMMIT_SHA`, pushed to the registry |
| `verify` | bring the compose stack up in CI, wait for health, run the screenshot job below against it — a smoke test that the images actually work together, not just that they build |
| `deploy:test` | `helm upgrade --install` to the test cluster, automatic on `main` |
| `deploy:prod` | same chart, prod values, **manual trigger only**, tags only |

Caching: `pip` and `npm` caches keyed on the lockfiles. The frontend has a `package-lock.json`;
the backend has no lockfile yet — decide whether to add one (`pip-tools`/`uv`) as part of this
work, because reproducible image builds want one.

### 4. Helm charts

`deploy/helm/epichem/`, one chart with both components as subcharts or as templates behind a
values flag:

- Deployments for `api` and `web`, Services, an Ingress with TLS
- A `Job` (or `initContainer`) running `epichem db upgrade head`, with a Helm hook so it runs
  before the new pods take traffic. Migrations must never race two replicas — one Job, then roll.
- Postgres as a dependency chart for `test`, and **external/managed** for `prod` — a production
  database should not be owned by the app's release lifecycle
- Secrets: `EPICHEM_API_TOKENS` and `DATABASE_URL` from a `Secret`, never from `values.yaml`
- `values-test.yaml` / `values-prod.yaml` differing in replica counts, ingress host, resource
  limits, and whether Postgres is in-chart

Open question for whoever picks this up: does the institute already run a GitLab agent for
Kubernetes, or is this `helm` from a CI runner with a kubeconfig? That changes the deploy stage
shape considerably. Ask FHI IT before building it (same posture as ADR 0002 on NetBox).

### 5. Automated UI screenshots

A CI job that boots the stack, drives a headless browser over the console, and commits/publishes
the resulting images — so the README and the design review always show what the app currently
looks like rather than what it looked like months ago.

- **Playwright** over Puppeteer: multi-browser, first-class CI story, and its own container image
  with browsers preinstalled, which removes the "install Chrome in CI" step entirely.
- Deterministic input is the hard part and the important part: seed from `descriptors/` plus a
  fixed set of samples so the screenshots don't churn on every run. A screenshot diff that changes
  because sample IDs are random is a screenshot diff nobody reads.
- Shots to take: Topology (tree expanded), Devices (grid + inspector open), Samples (table +
  inspector open), and the isometric layout once it exists. Deterministic viewport, and mask or
  freeze anything time-dependent (`created_at` columns) so unrelated runs produce identical bytes.
- Output to `docs/screenshots/`, published as a CI artifact; optionally fail the job on a visual
  diff once the UI has stopped moving. Not before — visual regression gates on a UI under active
  development are pure friction.

There's a working precedent in this repo's history for the mechanics: this session verified all
three screens by rendering them in jsdom against a seeded backend and asserting on the resulting
DOM. That approach is cheaper than Playwright and catches render errors, but it can't produce an
image — hence the browser for this job specifically.

## Definition of done

Nothing is checked, on purpose: every box below is an *executed* outcome, and the code that would
satisfy them has only been written. Written-but-unrun is what the status header records; ticking
these would claim something different.

- [ ] `docker compose up` on a clean machine serves a working console with the example lab
      — written (`compose.yaml`), see `docs/HOST_SETUP.md` §2
- [ ] Every push runs lint + tests for both halves, and the suite has run green against real
      Postgres at least once in CI — written (`.gitlab-ci.yml`, `test:postgres`), currently
      `allow_failure: true` until its first green run
- [ ] Images build and push on `main`, tagged by SHA — written (`build:backend`,
      `build:frontend`); needs a privileged runner, `docs/HOST_SETUP.md` §4.1
- [ ] `helm upgrade --install` deploys to the test cluster from CI, with migrations as a
      pre-upgrade hook and secrets out of `values.yaml` — **not built**, blocked on open
      question 1
- [ ] Production deploy exists and is manual-only — written as a compose deploy
      (`deploy:prod`, tag-only + manual) rather than Helm; needs the shell-executor runner from
      `docs/HOST_SETUP.md` §4.2
- [ ] Screenshots regenerate automatically and are current in the README — written
      (`deploy/screenshots.mjs`, `verify:stack`); they are published as CI artifacts and are
      **not** yet committed back into the repo or embedded in the README

## Things to decide before starting

1. GitLab Kubernetes agent, or CI runner with a kubeconfig? (ask FHI IT)
2. Managed Postgres in prod, or in-cluster? (this doc assumes managed)
3. A Python lockfile — `uv`, `pip-tools`, or accept unpinned transitive deps in images?
4. Registry retention: SHA-tagged images accumulate fast; set a cleanup policy up front.
