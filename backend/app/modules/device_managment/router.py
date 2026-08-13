"""Device-management aggregator router.

Groups every device-management module (site, lab, zone, station, device)
under one router that main.py mounts. To add a module: import its router
and `include_router` it here.

`tags` groups all these endpoints under one heading in /docs. Add
`prefix="/dm"` to the APIRouter below if you also want the URLs namespaced
(e.g. /dm/sites instead of /sites).
"""

from fastapi import APIRouter

from app.modules.device_managment.devices.api import router as device_router
from app.modules.device_managment.lab.api import router as lab_router
from app.modules.device_managment.site.api import router as site_router
from app.modules.device_managment.station.api import router as station_router
from app.modules.device_managment.zone.api import router as zone_router

router = APIRouter(tags=["device management"])
router.include_router(site_router)
router.include_router(lab_router)
router.include_router(zone_router)
router.include_router(station_router)
router.include_router(device_router)
