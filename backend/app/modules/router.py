"""Aggregates every domain-module router under one router that main.py mounts.

Add a domain by importing its router and including it here.
"""

from fastapi import APIRouter

from app.modules.device_managment.router import router as device_management_router

router = APIRouter()
router.include_router(device_management_router)

# When they exist, add their aggregator routers the same way:
# from app.modules.sample_tracking.router import router as sample_tracking_router
# router.include_router(sample_tracking_router)
# from app.modules.workflow_designer.router import router as workflow_designer_router
# router.include_router(workflow_designer_router)
