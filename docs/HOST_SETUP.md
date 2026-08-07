# Host setup — the things that can only be done from outside the sandbox

Everything in this file needs either a Docker daemon, a browser logged into
GitLab, or a machine that isn't the development container. None of it can be
done by an assistant working inside that container, so it is written as a
checklist for a human.

Work through it in order. §1 and §2 make the project runnable; §3 and §4 make
CI work; §5 is production. Each section says what to run and, more usefully,
**how to tell whether it worked**.

---

## §0. What has and has not been verified

Being blunt about this up front, because it changes how much you should trust
the rest of the repo.

**Verified, by execution:**

| Thing | How |
|---|---|
| Backend suite — 95 tests | `pytest`, on sqlite **and** real postgres:17 |
| Frontend suite — 63 tests | `vitest run` |
| Lint / typecheck | `ruff check`, `tsc --noEmit` |
| Every YAML and shell file added here | parsed / `sh -n` |
| The GitLab remote after the group transfer | `git ls-remote` — see §0.1 |
| Dev container builds and docker-in-docker starts | `docker version` inside it, see §1.1 |
| Claude Code login persistence | migrated + confirmed live, see §1.1 |
| `compose.yaml` — the full dev stack | `docker compose up` in the container, seeded console reached; seed idempotent on re-run; Vite `/api` proxy reaches `api:8000` |
| `backend/Dockerfile`, `frontend/Dockerfile` | built (both `dev` and `runtime` targets) |
| `compose.prod.yaml` + the runtime images | brought up by the CI `verify:stack` job with real Postgres, seeded, health-checked |
| `.gitlab-ci.yml` — the whole pipeline | green end-to-end on `main` (pipeline #835582): lint → test (incl. `test:postgres`) → build+push → verify |
| `deploy/screenshots.mjs` | drove the console in a real headless browser in `verify:stack` |

**The first green pipeline happened (2026-08-07, #835582).** Two fixes were
needed to get there, both now in `main`:

1. The pipeline's global `variables:` set `EPICHEM_API_TOKENS` (for the
   prod-compose `verify` stage) so it leaked into `test:backend`/`test:postgres`
   and made every write 401. Moved it onto `verify:stack` alone, and made the
   test suite hermetic against an ambient value (`backend/tests/conftest.py`).
2. The `build` jobs used TLS docker-in-docker, which needs the runner to share
   `/certs/client`; GWDG's shared runner doesn't. Switched to plaintext dind on
   port 2375. See the `.docker` template comment for how to switch back.

`test:postgres` is now a **blocking** job (was `allow_failure: true`).

### §0.1 The remote after the group transfer — it works

You asked whether the transferred project still authenticates. It does:

```
$ git ls-remote --heads origin
d4d9d050da81599054f7af5cc866fe64e7b106a5  refs/heads/main

$ ssh -T git@gitlab.gwdg.de
Welcome to GitLab, @tobias.thurner!
```

Remote is `git@gitlab.gwdg.de:lotschgroup/automation-digitalisation/it-services/EPIChem.git`,
and remote `main` matched local `main` exactly. Nothing to fix.

Two things worth knowing about *how* it authenticates:

1. **There is no key file in the container.** `~/.ssh/` contains only
   `known_hosts`. Authentication happens through the **forwarded SSH agent**
   from your machine. If the agent isn't running on the host, or you use this
   repo somewhere without agent forwarding, git will fail with a permission
   error and nothing in the container will be broken — the key simply isn't
   there.

2. **The repo carried a stale override.** `.git/config` had
   `core.sshCommand = ssh -i ~/.ssh/id_ed25519_gitlab ...`, pointing at a key
   file that does not exist here; it printed
   `Warning: Identity file ... not accessible` on every fetch. Auth worked
   anyway because the agent answered first. `post-create.sh` now removes that
   override, since the agent needs no `-i`. Nothing for you to do.

---

## §1. Rebuild the dev container

This fixes the "I have to log in again every time" problem **and** gives the
container a Docker daemon. Both come from the same rebuild.

### What was wrong

Three independent causes, all now fixed in `.devcontainer/devcontainer.json`:

1. **The config volume name could silently change.** It was
   `claude-code-config-${devcontainerId}`. That id is derived from the
   container's identifying labels, so it changes if the workspace is opened by
   a different path or the container is recreated from scratch — and when it
   changes, Docker doesn't error, it just **mounts a brand-new empty volume**.
   Your old one is still on disk, orphaned. It is now a fixed literal name,
   `epichem-claude-config`, which cannot drift.

2. **An empty auth variable was being injected.** The config forwarded
   `${localEnv:CLAUDE_CODE_OAUTH_TOKEN}`. When a variable is unset on the
   host, that expression resolves to an **empty string** rather than being
   omitted — so the container got `CLAUDE_CODE_OAUTH_TOKEN=""`, defined but
   useless, which can take precedence over the credentials stored in the
   volume. Removed. If you ever want token auth, set the variable on your
   machine first and uncomment the block.

3. **Shell history had no volume at all**, so it died with every rebuild.

### Do this

1. Commit or stash anything uncommitted — a rebuild recreates the container
   filesystem. Your repo is a bind mount and is safe; `/home/node` outside the
   volumes listed above is not.

2. **Command Palette → "Dev Containers: Rebuild Container"**.
   Use plain *Rebuild*, not *Rebuild Without Cache*, unless you have a reason.

3. The rebuild pulls the docker-in-docker and Python features, so the first
   one takes a few minutes. `post-create.sh` then creates `backend/.venv` and
   installs both dependency sets.

### Check it worked

```bash
docker version                 # a daemon, not "command not found"
docker run --rm hello-world    # it can actually run something
python3 --version              # 3.13.x
ls /commandhistory             # .bash_history — the history volume
```

Then rebuild **a second time** and confirm you are still logged into Claude
Code and that `history` still shows your old commands. One successful rebuild
proves nothing; the bug was specifically about state not surviving one.

### §1.1 What actually happened here, 2026-08-07

The pinned-volume fix (`69aa945`) was correct but incomplete: it changed
where the container *looks* for config, but nobody had run
`preserve-claude-state.sh` to actually move the old data there. Every rebuild
mounted the new `epichem-claude-config` volume, found it empty, and asked to
log in again — the exact symptom the fix was supposed to solve. `docker
volume ls` showed both volumes existed the whole time; the old one,
`claude-code-config-177m86mlann63cgq426iictpqga63dq45efgff62m5g7uhk0v78l`,
still had the real `.credentials.json`.

Also found: `moby:true` in the docker-in-docker feature was failing to start
a nested daemon on this host (see the comment in `devcontainer.json`) —
`moby:false` fixed it, verified with `docker version` inside a running
container.

Fixed, from the host, without a rebuild (volumes are visible live to a
running container):

```bash
bash .devcontainer/preserve-claude-state.sh   # copies old volume -> epichem-claude-config
docker exec -u node <container> ls -la /home/node/.claude   # confirms .credentials.json present
```

Still worth doing once: rebuild the container for real and confirm login
survives it, per the paragraph above. That has not been done — only the live
volume copy has been verified.

### Why docker-in-docker and not the lighter option

The usual advice is `docker-outside-of-docker`, which shares your machine's
daemon and is faster. It would break this repo. `compose.yaml` bind-mounts
`./backend` and `./frontend` for hot reload, and those paths exist at
`/workspaces/EPIChem` **only inside the dev container**. Handing them to a
daemon running on your host would resolve them against the host's filesystem,
find nothing, and mount empty directories — you would get a stack that starts
cleanly and serves nothing, which is a much worse afternoon than a slower
build. A nested daemon sees the same filesystem this container does.

The cost: images are stored in the `epichem-docker-data` volume rather than
shared with your machine's Docker, so they're pulled once per dev container.
The volume means "once", not "once per rebuild".

---

## §2. Verify the dev stack

This is the part I most need you to run, because it is the largest piece of
unverified work in the repo.

```bash
docker compose up --build
```

Expected sequence — the ordering is enforced by `depends_on`, so a failure at
any step stops the ones after it:

```
db        healthy
migrate   runs alembic to head, exits 0
seed      imports descriptors/, adds 3 samples, exits 0
api       healthy  (curl on /api/v1/health)
web       Vite listening on 5173
```

Then open **<http://localhost:5173>** — the console, with the example lab
already in it. Four screens: Lab layout, Topology, Devices, Samples.

### Then check the parts most likely to be wrong

```bash
# 1. Idempotency. This is the one I most suspect, and the failure is nasty:
#    `epichem sample add` exits 1 on a duplicate code, which would block the
#    api service behind it. deploy/seed.sh guards each sample, but that guard
#    has never run.
docker compose down && docker compose up

# 2. Hot reload, backend. Edit a docstring in backend/epichem/api/app.py —
#    uvicorn should reload. If it does not, the editable install is not
#    resolving through the bind mount.
# 3. Hot reload, frontend. Edit frontend/src/App.tsx — the browser should
#    update without a manual refresh.

# 4. A clean start, which is what a new colleague gets:
docker compose down -v && docker compose up --build
```

### If something breaks

```bash
docker compose logs api        # or migrate / seed / web
docker compose ps              # who is actually up
docker compose exec db psql -U epichem -d epichem -c '\dt'
```

Known-fragile spots, in the order I would suspect them:

- **`seed` fails on a second run** → the guard in `deploy/seed.sh` doesn't
  match `epichem sample list`'s actual output format. Fix the grep.
- **`api` never becomes healthy** → `curl` missing from the image, or the
  health route not reachable. Check with
  `docker compose exec api curl -v localhost:8000/api/v1/health`.
- **Frontend shows a blank page** → the Vite proxy isn't reaching `api:8000`.
  Check `docker compose exec web wget -qO- http://api:8000/api/v1/health`.
- **Frontend edits don't reload** → the `web-node-modules` volume is shadowing
  something it shouldn't, or polling is off. After changing
  `frontend/package.json` you must `docker compose down -v`; the named volume
  is only populated once.

Tell me what breaks and paste the log — that is a normal debugging loop, not a
setback.

---

## §3. GitLab preparation

All of this is browser work in
`lotschgroup/automation-digitalisation/it-services/EPIChem`. You need
**Maintainer** or **Owner**.

### 3.1 Enable the container registry — and find its real hostname

**Settings → General → Visibility, project features, permissions →
Container registry: on.**

Then go to **Deploy → Container Registry** and **copy the image prefix it
shows you**. This matters more than it looks:

> I probed `registry.gitlab.gwdg.de` from the container and **it does not
> resolve**. So the obvious guess for a GitLab at `gitlab.gwdg.de` is wrong,
> and I have deliberately left the registry hostname out of `compose.prod.yaml`
> rather than hardcoding something that would fail confusingly later. It is a
> required variable there.

CI itself doesn't need you to know it — `.gitlab-ci.yml` uses the predefined
`$CI_REGISTRY_IMAGE`. You need it only for §5, the production host.

If the registry feature is not available on this instance at all, that changes
the plan and is worth knowing early — tell me and I'll rework §5 to build on
the production host instead of pulling.

### 3.2 CI/CD variables

**Settings → CI/CD → Variables.** The pipeline as written needs only two, and
both are for the production deploy job:

| Key | Value | Flags | Why |
|---|---|---|---|
| `EPICHEM_PROD_DIR` | absolute path to the checkout on the prod host, e.g. `/srv/epichem` | Protected | `deploy:prod` cds into it |
| `EPICHEM_PROD_URL` | e.g. `https://epichem.fkf.mpg.de` | Protected | shown on GitLab's environment page |

Set **Protected** on both, and make sure your release tags are protected
(§3.3) or protected variables won't be exposed to the job.

Do **not** create variables for the registry credentials. GitLab injects
`$CI_REGISTRY`, `$CI_REGISTRY_USER` and `$CI_REGISTRY_PASSWORD` into every
job automatically, scoped to that job, and they expire when it ends. A
long-lived token you manage yourself is strictly worse.

**Nothing in this repo needs a production database password stored in GitLab.**
That lives in a `.env` on the production host (§5) and is never sent to CI.
Keeping it out of GitLab means a compromised pipeline cannot read it.

### 3.3 Protect the branch and the tags

**Settings → Repository → Protected branches** — `main`, maintainers can push
(or no-one, MRs only).

**Settings → Repository → Protected tags** — pattern `v*`, maintainers can
create. `deploy:prod` only runs on tags, so this is what stops an arbitrary
developer from triggering a production deploy by pushing a tag.

### 3.4 Registry cleanup policy — do this now, not later

**Deploy → Container Registry → Cleanup policies.** Every pipeline pushes two
SHA-tagged images; without a policy they accumulate until someone gets a quota
email. Suggested: keep the 10 most recent tags matching `.*`, keep anything
matching `v.*` (releases) forever, remove untagged after 7 days.

This is open question 4 in `docs/MILESTONE_CI_CD.md`, and it is much cheaper to
answer before there are 400 images than after.

---

## §4. Runners

You mentioned wanting a dedicated project runner. You actually want **two
distinct runner configurations**, and conflating them is the most common way
this setup goes wrong — they need different executors for different reasons.

| | Build runner | Production runner |
|---|---|---|
| Purpose | lint, test, build images, verify | `deploy:prod` only |
| Executor | `docker`, **privileged** | `shell` |
| Tag | none needed (or `epichem`) | **`epichem-prod`** |
| Runs where | anywhere with CPU | **the production host itself** |
| Privileged | yes — dind needs it | no |

### 4.1 Build runner

Needed because the `build` and `verify` stages run Docker-in-Docker, which
requires a privileged runner. GWDG's shared runners may or may not allow that;
if `build:backend` fails with a permission or "cannot connect to the Docker
daemon" error, that is why, and a project runner is the fix.

On a machine with Docker:

```bash
# 1. Settings -> CI/CD -> Runners -> New project runner.
#    Leave "Run untagged jobs" ON, so the untagged lint/test/build jobs land
#    on it. GitLab gives you a token starting with glrt-.

docker run -d --name gitlab-runner --restart always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v gitlab-runner-config:/etc/gitlab-runner \
  gitlab/gitlab-runner:latest

docker exec -it gitlab-runner gitlab-runner register \
  --non-interactive \
  --url https://gitlab.gwdg.de/ \
  --token "glrt-REPLACE_ME" \
  --executor docker \
  --docker-image docker:27-cli \
  --docker-privileged \
  --docker-volumes /certs/client
```

`--docker-privileged` and the `/certs/client` volume are both required by
docker-in-docker; without them the `build` stage cannot start a daemon.

> **Understand what privileged means before you run this.** A privileged
> runner can escape its container and take over its host. Put it on a machine
> that does nothing else, and never make it a *shared* (instance-wide) runner
> — a project runner is only reachable by pipelines in this project, which is
> exactly the boundary you want.

If you would rather not run a privileged runner at all, the alternative is to
build images with Kaniko or Buildah instead of dind. That is a rewrite of the
two `build:` jobs. Say the word and I'll do it — it is genuinely the safer
option, just less standard.

### 4.2 Production runner

This one runs **on the production host** with the **shell** executor, because
`deploy:prod` operates on a checkout and a compose stack that live on that
host's filesystem. In a container, `$EPICHEM_PROD_DIR` would resolve inside the
container, the deploy would "succeed", and the stack it started would vanish
with the job. `.gitlab-ci.yml` therefore has no `image:` on that job.

```bash
# On the production host. Register with the epichem-prod tag and
# "Run untagged jobs" OFF, so ONLY the deploy job can land here.
sudo gitlab-runner register \
  --non-interactive \
  --url https://gitlab.gwdg.de/ \
  --token "glrt-REPLACE_ME" \
  --executor shell \
  --tag-list epichem-prod \
  --run-untagged=false

# The runner's own user must be able to talk to Docker.
sudo usermod -aG docker gitlab-runner
sudo systemctl restart gitlab-runner
```

Getting **"Run untagged jobs" off** right is what keeps `pytest` and image
builds from executing on your production machine.

---

## §5. Production host

A host running the whole stack from prebuilt images. No toolchain, no Node, no
build step — Docker and network access to the registry.

```bash
sudo mkdir -p /srv/epichem && cd /srv/epichem

# compose.prod.yaml and the descriptors are all it needs. A full clone is
# fine and makes the deploy job simpler; that is what EPICHEM_PROD_DIR points at.
git clone git@gitlab.gwdg.de:lotschgroup/automation-digitalisation/it-services/EPIChem.git .

# Log in to the registry once. A read-only deploy token is the right
# credential here: Settings -> Repository -> Deploy tokens, scope read_registry
# only. Do NOT put a personal access token on a shared machine.
docker login <registry-host-from-§3.1> -u <deploy-token-user> -p <deploy-token>
```

Create `/srv/epichem/.env`:

```bash
EPICHEM_REGISTRY=<the prefix from §3.1>
EPICHEM_VERSION=v0.1.0            # a release tag, never `latest`, so a
                                  # restart can't silently change versions
POSTGRES_PASSWORD=<long random string>
EPICHEM_API_TOKENS=console:<long random string>,scripts:<another one>
WEB_PORT=8080
```

```bash
chmod 600 .env      # it holds the database password
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml ps
```

`compose.prod.yaml` **refuses to start** without `POSTGRES_PASSWORD` and
`EPICHEM_API_TOKENS` — no defaults, deliberately. A production stack that
silently booted with password `epichem` would be worse than one that failed.

### Before anyone else can reach it

- **Put it behind the institute's reverse proxy and terminate TLS there.**
  The `web` container speaks plain HTTP on 8080. The API tokens are bearer
  tokens in an `Authorization` header — over plain HTTP they are readable by
  anyone on the network path. If the proxy is on the same host, change the
  port mapping to `127.0.0.1:8080:8080` so nothing else can reach it directly.
- **Back up the database volume.** `epichem-prod_db-data` is the source of
  truth (ADR 0004) and nothing else in this repo holds a copy. The registry
  is not reconstructible from `descriptors/` — that directory is an example
  lab, and revision history exists only in Postgres.
  ```bash
  docker compose -f compose.prod.yaml exec -T db \
    pg_dump -U epichem epichem | gzip > epichem-$(date +%F).sql.gz
  ```
- **Know that auth is a shared token, not identities.** Every write is
  recorded with the token's *label* as `created_by`, so you can tell "the
  console" from "the import script", but not one person from another. That is
  §12.1 and it is a real limitation, not an oversight — see
  `PROJECT_MILESTONES.md`.

---

## §6. Still open

Two of these block work; the other two only need an answer before the relevant
piece gets built.

1. **Kubernetes: agent, or a runner with a kubeconfig?** (ask FHI IT) — Helm
   charts are specified in `docs/MILESTONE_CI_CD.md` §4 but deliberately not
   built, because the answer changes their shape. The compose deploy in §5
   works meanwhile and may be all this ever needs.
2. **Managed Postgres in production, or in-cluster/in-compose?** §5 runs it in
   compose, which is fine for one host and wrong for a cluster.
3. **A Python lockfile.** `pyproject.toml` pins no transitive dependencies, so
   two builds of the same commit can differ. `uv` or `pip-tools` — worth doing
   before the first real deployment, not after.
4. **Registry retention** — §3.4. Decide now.

Answer 1 and I'll build the Helm charts. Answer 3 and I'll add the lockfile
and wire it into the image builds and the CI cache.
