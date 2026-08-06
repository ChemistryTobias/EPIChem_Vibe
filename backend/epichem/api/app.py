from fastapi import FastAPI

from epichem.api.errors import install_error_handlers
from epichem.api.routers import devices, topology


def create_app() -> FastAPI:
    app = FastAPI(
        title="EPIChem Registry API",
        description=(
            "Lab topology, device descriptors and capability classes. The registry "
            "(Postgres) is the source of truth (ADR 0004) — reads and writes both go "
            "through this API, with every write recorded as a Revision."
        ),
        version="0.1.0",
    )
    install_error_handlers(app)
    app.include_router(topology.router)
    app.include_router(devices.router)
    return app


app = create_app()
