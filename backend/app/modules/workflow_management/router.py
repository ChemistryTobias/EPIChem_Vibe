from fastapi import APIRouter

from app.modules.workflow_management.procedures.api import router as procedure_router
from app.modules.workflow_management.queueserver.api import router as execution_router
from app.modules.workflow_management.runs.api import router as run_router

router = APIRouter()
router.include_router(execution_router)
router.include_router(procedure_router)
router.include_router(run_router)
