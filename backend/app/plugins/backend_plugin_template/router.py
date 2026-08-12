"""Entry point the plugin loader looks for: a module-level `router`.

Namespaced under /plugins/template and tagged so its endpoints group in /docs.
For a real plugin, change the prefix and tags (and include your api router).
"""

from fastapi import APIRouter

from .api import router as api_router

router = APIRouter(prefix="/plugins/template", tags=["plugin: template"])
router.include_router(api_router)
