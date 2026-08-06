from fastapi import FastAPI

from epichem.api.errors import install_error_handlers
from epichem.api.routers import devices, topology


def create_app() -> FastAPI:
    app = FastAPI(
        title="EPIChem Registry API",
        description="Lab topology, device descriptors and capability classes (read-only in M1).",
        version="0.1.0",
    )
    install_error_handlers(app)
    app.include_router(topology.router)
    app.include_router(devices.router)
    return app


app = create_app()
