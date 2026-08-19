from fastapi import APIRouter

from app.core.file_storage.api import router as file_storage_router
# from app.core.auth.api import router as auth_router
# from app.core.users.api import router as users_router

router = APIRouter()
router.include_router(file_storage_router)
# router.include_router(auth_router)
# router.include_router(users_router)
