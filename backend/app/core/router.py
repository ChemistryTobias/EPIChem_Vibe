from fastapi import APIRouter

from app.core.access_control.router import router as access_control_router
from app.core.file_storage.api import router as file_storage_router
from app.core.revisions.api import router as revisions_router

router = APIRouter()
router.include_router(file_storage_router)
router.include_router(access_control_router)
router.include_router(revisions_router)
