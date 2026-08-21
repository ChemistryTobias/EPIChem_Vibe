from fastapi import APIRouter

from app.core.access_control.auth.api import router as auth_router
from app.core.access_control.groups.api import router as groups_router
from app.core.access_control.users.api import router as users_router

router = APIRouter(tags=["access control"])
router.include_router(users_router)
router.include_router(groups_router)
router.include_router(auth_router)
