"""Device-management aggregator router.

Groups every device-management module (site, and later lab, zone, station,
device, capability_class) under one router that main.py mounts. To add a
module: import its router and `include_router` it here.

`tags` groups all these endpoints under one heading in /docs. Add
`prefix="/dm"` to the APIRouter below if you also want the URLs namespaced
(e.g. /dm/sites instead of /sites).
"""

from fastapi import APIRouter

from app.modules.device_managment.site.api import router as site_router

router = APIRouter(tags=["device management"])
router.include_router(site_router)
