# Host setup — the things that need a human, outside the dev container

## GitLab preparation

Browser work in `lotschgroup/automation-digitalisation/it-services/EPIChem`.
Needs **Maintainer** or **Owner**.

**Container registry** — Settings → General → Visibility, project features,
permissions → Container registry: on. Then Deploy → Container Registry to
find the real image-prefix hostname (don't guess it — `registry.gitlab.gwdg.de`
does not resolve on this instance). CI itself doesn't need this; it uses the
predefined `$CI_REGISTRY_IMAGE`. You need it for the production host below.

**CI/CD variables** — Settings → CI/CD → Variables. Only two, both for the
production deploy job, both **Protected**:

| Key | Value | Why |
|---|---|---|
| `EPICHEM_PROD_DIR` | absolute path to the checkout on the prod host | `deploy:prod` cds into it |
| `EPICHEM_PROD_URL` | e.g. `https://epichem.fkf.mpg.de` | shown on GitLab's environment page |

Don't create variables for registry credentials — GitLab injects
`$CI_REGISTRY`/`$CI_REGISTRY_USER`/`$CI_REGISTRY_PASSWORD` automatically,
scoped per-job. Nothing in this repo needs a production database password
stored in GitLab either; that lives in a `.env` on the production host only.

**Protected branches/tags** — Settings → Repository. `main` protected;
tags matching `v*` protected, maintainers-only. `deploy:prod` only runs on
tags, so this is what stops an arbitrary push from triggering a deploy.

**Registry cleanup policy** — Deploy → Container Registry → Cleanup
policies. Every pipeline pushes two SHA-tagged images; without a policy
they accumulate. Suggested: keep the 10 most recent tags, keep `v.*`
forever, remove untagged after 7 days.

## Runners

Two distinct configurations — don't conflate them:

| | Build runner | Production runner |
|---|---|---|
| Purpose | lint, build images, verify | `deploy:prod` only |
| Executor | `docker`, **privileged** | `shell` |
| Tag | none needed | **`epichem-prod`** |
| Runs where | anywhere with CPU | the production host itself |

**Build runner** — needed because `build`/`verify` run Docker-in-Docker,
which requires a privileged runner:

```bash
docker run -d --name gitlab-runner --restart always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v gitlab-runner-config:/etc/gitlab-runner \
  gitlab/gitlab-runner:latest

docker exec -it gitlab-runner gitlab-runner register \
  --non-interactive --url https://gitlab.gwdg.de/ --token "glrt-REPLACE_ME" \
  --executor docker --docker-image docker:27-cli \
  --docker-privileged --docker-volumes /certs/client
```

A privileged runner can escape its container and take over its host — put
it on a machine that does nothing else, never make it instance-wide.

**Production runner** — runs on the production host itself, shell executor,
because `deploy:prod` operates on a checkout and compose stack living on
that host's filesystem:

```bash
sudo gitlab-runner register \
  --non-interactive --url https://gitlab.gwdg.de/ --token "glrt-REPLACE_ME" \
  --executor shell --tag-list epichem-prod --run-untagged=false
sudo usermod -aG docker gitlab-runner && sudo systemctl restart gitlab-runner
```

`--run-untagged=false` is what keeps lint/build jobs off the production
machine.

## Production host

No toolchain, no Node, no build step — Docker and registry access only.

```bash
sudo mkdir -p /srv/epichem && cd /srv/epichem
git clone git@github.com:ChemistryTobias/EPIChem_Vibe.git .
docker login <registry-host> -u <deploy-token-user> -p <deploy-token>
```

Create `/srv/epichem/.env`:

```bash
EPICHEM_REGISTRY=<the prefix from the registry step above>
EPICHEM_VERSION=v0.1.0     # a release tag, never `latest`
POSTGRES_PASSWORD=<long random string>
WEB_PORT=8080
```

```bash
chmod 600 .env
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml ps
```

`compose.prod.yaml` refuses to start without `POSTGRES_PASSWORD` — no
default, deliberately.

**Before anyone else can reach it:**
- Put it behind the institute's reverse proxy, terminate TLS there. `web`
  speaks plain HTTP on 8080.
- Back up the database volume — `epichem-prod_db-data` is the only copy of
  everything:
  ```bash
  docker compose -f compose.prod.yaml exec -T db \
    pg_dump -U epichem epichem | gzip > epichem-$(date +%F).sql.gz
  ```
- **A fresh deployment starts empty.** No seed mechanism exists for
  production yet (old backend's YAML-import seed was deleted with it) —
  see the Roadmap's CLI section for the planned approach. `scripts/`
  has a local-dev-only seed script, not meant for production.

## Still open

1. **Kubernetes**: agent, or a runner with a kubeconfig? Not answered by
   FHI IT yet — the compose deploy above works meanwhile.
2. **Managed Postgres in production**, or in-compose (current)? Fine for
   one host, wrong for a cluster.
3. **A Python lockfile** — `pyproject.toml` pins no transitive
   dependencies, so two builds of the same commit can differ.
