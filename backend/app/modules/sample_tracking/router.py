from fastapi import APIRouter

from app.modules.sample_tracking.samples.api import router as sample_router

router = APIRouter()
router.include_router(sample_router)
