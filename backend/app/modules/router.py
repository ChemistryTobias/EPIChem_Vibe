from fastapi import APIRouter

from app.modules.device_managment.router import router as device_management_router
from app.modules.sample_tracking.router import router as sample_tracking_router
from app.modules.workflow_management.router import router as workflow_management_router

router = APIRouter()
router.include_router(device_management_router)
router.include_router(workflow_management_router)
router.include_router(sample_tracking_router)
