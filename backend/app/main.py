"""Application entry point. Start everything with:

    .venv/bin/uvicorn app.main:app --reload

Composition root: creates the FastAPI app, registers the app-wide exception
handler, creates the database tables, and mounts each module's router.
"""

from app.core.database import Database, engine
from app.core.errors import install_exception_handlers
from app.modules.router import router as modules_router
from app.plugins.router import router as plugins_router
from fastapi import FastAPI

# Importing the routers above pulls in their models, registering them on
# Database.metadata — so create_all now sees every table.
Database.metadata.create_all(engine)

app = FastAPI()
install_exception_handlers(app)
app.include_router(modules_router)
app.include_router(plugins_router)
