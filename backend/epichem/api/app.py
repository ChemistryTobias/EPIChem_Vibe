import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from epichem.api.auth import TOKENS_ENV, warn_if_open
from epichem.api.errors import install_error_handlers
from epichem.api.routers import devices, health, samples, topology

#: Comma-separated list of browser origins allowed to call this API
#: cross-origin. Empty (the default) installs no CORS middleware at all.
#: The `frontend/` dev server does not need this — it proxies /api through
#: Vite, same-origin — so this is only for deployments that serve the
#: frontend from a different origin than the API. There is no auth on this
#: API yet (§12.1); don't widen it to "*" on anything reachable by others.
CORS_ORIGINS_ENV = "EPICHEM_CORS_ORIGINS"


def _cors_origins() -> list[str]:
    raw = os.environ.get(CORS_ORIGINS_ENV, "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app() -> FastAPI:
    app = FastAPI(
        title="EPIChem Registry API",
        description=(
            "Lab topology, device descriptors, capability classes and samples. "
            "The registry (Postgres) is the source of truth (ADR 0004) — reads "
            "and writes both go through this API, with every write recorded as "
            "a Revision.\n\n"
            f"**Writes** (POST/PUT/DELETE) require `Authorization: Bearer <token>` "
            f"when `{TOKENS_ENV}` is set; the token's label is recorded as the "
            "revision's `created_by`. Reads are open. With the variable unset, "
            "writes are unauthenticated — fine for localhost, not for anything "
            "reachable by anyone else."
        ),
        version="0.1.0",
    )
    install_error_handlers(app)
    warn_if_open()

    origins = _cors_origins()
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(topology.router)
    app.include_router(devices.router)
    app.include_router(samples.router)
    return app


app = create_app()
