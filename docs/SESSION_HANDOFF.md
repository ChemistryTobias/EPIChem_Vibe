# Session handoff — 2026-08-07

Written deliberately into the repo rather than into Claude Code's own storage, because the dev
container rebuild that this document is about **renames the volume that storage lives on**, so
anything saved there would be orphaned. See §5.

Read this together with `docs/HOST_SETUP.md`, which is the actual instruction manual. This file
only records *where we stopped and why*, so a session with no memory of the conversation can pick
up without re-deriving it.

---

## 1. Where the code is

`main` at `1bd2739`, pushed to
`git@gitlab.gwdg.de:lotschgroup/automation-digitalisation/it-services/EPIChem.git`. Local and
remote were confirmed identical.

The last five commits are one unit of work — making the project runnable and deployable:

| Commit | What |
|---|---|
| `69aa945` | Dev container state loss on rebuild — three causes, all fixed |
| `4a0cb8e` | `/api/v1/health`, for container healthchecks and cluster probes |
| `aad5776` | `docker compose up` as the whole dev environment |
| `93dd28b` | The GitLab CI/CD pipeline |
| `1bd2739` | README rewrite + `docs/HOST_SETUP.md` |

Before that, `d4d9d05` completed M1 (the isometric lab layout) and the hardening pass
(Alembic, shared-token auth, pagination, frontend tests).

## 2. The one thing that matters most

**The container stack and the pipeline have never been executed.** There was no Docker daemon and
no GitLab runner in the environment they were written in.

Verified, by running it:

- Backend: **95 tests** pass (`backend/.venv/bin/pytest`), sqlite in-memory
- Frontend: **63 tests** pass (`npm test`), plus `tsc --noEmit` clean
- `ruff check epichem tests` clean
- Every YAML added parses; every shell script passes `sh -n`
- The GitLab remote authenticates and is in sync

Not verified, at all:

- `compose.yaml`, `compose.prod.yaml` — never run
- `backend/Dockerfile`, `frontend/Dockerfile` — never built
- `.gitlab-ci.yml` — never executed by a runner
- `deploy/screenshots.mjs` — has never driven a browser

`docs/HOST_SETUP.md` §0 is the authoritative version of this ledger. Do not mark any of it done
until it has actually run.

## 3. The immediate next step

The user was about to **rebuild the dev container** (`Dev Containers: Rebuild Container`). That
rebuild is what gives the environment a Docker daemon — via docker-in-docker, chosen over
docker-outside-of-docker because `compose.yaml` bind-mounts `./backend` and `./frontend`, paths
that exist only inside the dev container.

After the rebuild, the work is **`docs/HOST_SETUP.md` §2**: run `docker compose up` and fix
whatever breaks. Expected failure points, in the order to suspect them:

1. **`seed` fails on the second `up`.** `epichem sample add` exits 1 on a duplicate code;
   `deploy/seed.sh` guards each sample with `epichem sample list | grep`. That guard has never
   run — if the CLI's output format doesn't match, this is where it shows.
2. **`api` never becomes healthy** — `curl` missing from the image, or the health route
   unreachable. `docker compose exec api curl -v localhost:8000/api/v1/health`.
3. **Blank frontend** — the Vite proxy isn't reaching `api:8000`.
4. **Frontend edits don't hot-reload** — the `web-node-modules` named volume is stale. It is only
   populated once, so `docker compose down -v` is required after any `package.json` change.

## 4. Decisions already made — do not silently redo these

- **Postgres/sqlite is the source of truth, not git** (ADR 0004). Every write records a
  full-snapshot `Revision`, and all writes go through `epichem/registry.py`.
- **No Redis until M2** (ADR 0006). Nothing built yet earns it.
- **Helm is deliberately NOT built.** It is specified in `docs/MILESTONE_CI_CD.md` §4 and blocked
  on an unanswered question — GitLab Kubernetes agent, or a runner with a kubeconfig? Building
  against a guess would be worse than not building. `deploy:prod` covers the single-host case.
- **`test:postgres` is `allow_failure: true` on purpose**, because that code path has never
  executed. Flip it to blocking the moment it goes green once; a permanently non-blocking test
  job is theatre.
- **The registry hostname is unknown.** `registry.gitlab.gwdg.de` does not resolve — I probed it.
  `EPICHEM_REGISTRY` is therefore required with no default. The real value comes from
  GitLab → Deploy → Container Registry.
- **Auth is a shared write token, not identities.** `Revision.created_by` records the token's
  *label*, so the audit trail says which token, not which person. §12.1's OIDC work is still owed.

## 5. Why this file is in the repo and not in Claude's memory

The dev container mounted its config volume as `claude-code-config-${devcontainerId}`. That id is
derived from the container's identifying labels, so it changes when the workspace is opened by a
different path or the container is recreated — and when it changes, Docker does not error, it
mounts **a new empty volume**. That is one of the three causes of the "I have to log in again
every time" problem (`69aa945`).

The fix pins the name to a literal, `epichem-claude-config`. But that means **the first rebuild
after this commit switches to a different volume**, and the old one — holding the login, the
conversation transcripts and the memory files — is left behind, intact but unmounted.

To carry it across, run this **on the host machine**, not in a VS Code terminal inside the
container (the nested daemon cannot see the host's volumes):

```bash
docker volume create epichem-claude-config

docker run --rm \
  -v claude-code-config-177m86mlann63cgq426iictpqga63dq45efgff62m5g7uhk0v78l:/from:ro \
  -v epichem-claude-config:/to \
  alpine sh -c 'cp -a /from/. /to/'
```

`.devcontainer/preserve-claude-state.sh` does exactly this, with the volume name already filled
in. Run it before rebuilding.

If you skip it, nothing here is lost — this file and `docs/HOST_SETUP.md` are the state that
matters. You will just log in once more and start with no memory of the conversation, which is
what this document exists for.

**Update, 2026-08-07:** this script existed but nobody had run it — that's why login kept
vanishing on every rebuild despite `69aa945` being merged. Run from the host (not the container),
it copies live into the volume a running container already has mounted, no rebuild required. Done
once; login confirmed present in the running container afterward. Full account in
`docs/HOST_SETUP.md` §1.1, including a second, unrelated fix (`moby:false` for docker-in-docker to
actually start on this host). Still outstanding: a real rebuild to confirm the state survives one,
per §1's own check.

## 6. Still open, needs a human

1. **Kubernetes: GitLab agent, or a runner with a kubeconfig?** (ask FHI IT) — blocks the Helm
   charts.
2. **Managed Postgres in production, or in-compose?** `compose.prod.yaml` runs it in compose,
   which is right for one host and wrong for a cluster.
3. **A Python lockfile** (`uv` or `pip-tools`) — image builds are not reproducible without one.
4. **Registry retention policy** — cheaper to set before there are 400 images.
5. **Is a privileged CI runner acceptable to GWDG/FHI IT?** The `build` stage uses
   docker-in-docker. If not, the two `build:` jobs need rewriting for Kaniko or Buildah, which is
   genuinely the safer option.
