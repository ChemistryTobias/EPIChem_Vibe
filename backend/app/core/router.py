from fastapi import APIRouter

from app.core.file_storage.api import router as file_storage_router
# from app.core.access_control.router import router as access_control_router

router = APIRouter()
router.include_router(file_storage_router)
# router.include_router(access_control_router)
