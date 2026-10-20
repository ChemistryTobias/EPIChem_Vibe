from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.database import Database, engine
from app.core.errors import install_exception_handlers
from app.core.router import router as core_router
from app.modules.router import router as modules_router
# from app.plugins.router import router as plugins_router

# Importing routers (see above) pulls in their table schemas as well
Database.metadata.create_all(engine)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Runs advance in the background (Roadmap 2.2's dispatch layer).
    from app.modules.workflow_management.runs import orchestrator

    orchestrator.start()
    yield


# Creates the FastAPI aplication
app = FastAPI(lifespan=lifespan)

# Adds endpoints/routes and HTTP exception handlers
install_exception_handlers(app)


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


app.include_router(modules_router, prefix="/api/v1")
app.include_router(core_router, prefix="/api/v1")
# app.include_router(plugins_router, prefix="/api/v1")
