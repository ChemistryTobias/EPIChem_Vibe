"""Auto-discovers and mounts backend plugin routers.

Any *subpackage* of app/plugins/ that provides a `router.py` exposing an
`APIRouter` named `router` is mounted automatically. Drop a plugin folder in
(copy `backend_plugin_template`) and it appears in the API — no wiring here.
"""

import importlib
import pkgutil
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

_plugins_dir = Path(__file__).parent

for _info in pkgutil.iter_modules([str(_plugins_dir)]):
    if not _info.ispkg:
        continue  # skip plain modules like this one (router.py)
    try:
        _mod = importlib.import_module(f"app.plugins.{_info.name}.router")
    except ModuleNotFoundError:
        continue  # a subpackage without a router.py is not a mountable plugin
    _plugin_router = getattr(_mod, "router", None)
    if _plugin_router is not None:
        router.include_router(_plugin_router)
