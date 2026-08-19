from fastapi import FastAPI

from app.core.database import Database, engine
from app.core.errors import install_exception_handlers
from app.core.router import router as core_router
from app.modules.router import router as modules_router
# from app.plugins.router import router as plugins_router

# Importing routers (see above) pulls in their table schemas as well
Database.metadata.create_all(engine)

# Creates the FastAPI aplication 
app = FastAPI()

# Adds endpoints/routes and HTTP exception handlers
install_exception_handlers(app)
app.include_router(modules_router)
app.include_router(core_router)
# app.include_router(plugins_router)
