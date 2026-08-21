# EPIChem backend image (backend/app — the active backend).
#
# Two targets from one file:
#   --target dev      editable install + dev deps, for compose.yaml (hot reload)
#   --target runtime  non-editable, non-root, no dev deps — what CI pushes
#
# `runtime` is the default, so a bare `docker build ./backend` gives the
# production image rather than accidentally shipping pytest.

# ---------------------------------------------------------------- base
FROM python:3.13-slim AS base

# PYTHONUNBUFFERED: without it, uvicorn's startup log sits in a pipe buffer and
# `docker compose logs` looks like the container hung.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl is here for the healthcheck in compose.yaml, nothing else. psycopg is
# installed as [binary], so no libpq-dev / build toolchain is needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- dev
FROM base AS dev

# Copy only the metadata first so this layer caches across source edits.
COPY pyproject.toml ./
# setuptools needs the package present to resolve the editable install.
COPY app ./app
RUN pip install -e ".[dev]"

# compose.yaml bind-mounts ./backend over /app. The editable install writes a
# path finder into site-packages that points back at /app, so the mounted
# source is what actually gets imported — that is what makes --reload work.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---------------------------------------------------------------- runtime
FROM base AS runtime

COPY pyproject.toml ./
COPY app ./app
RUN pip install .

# Non-root. Do this after the install so pip still writes to system paths.
# chown /app too: the sqlite fallback (no DATABASE_URL set) writes its file
# there, and it's root-owned from the COPY/pip steps above otherwise.
RUN useradd --create-home --uid 10001 epichem \
 && chown epichem:epichem /app
USER epichem

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
