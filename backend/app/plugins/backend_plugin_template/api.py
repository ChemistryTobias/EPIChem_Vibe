"""Example endpoints for the plugin template. Same shape as a module's api.py:
an APIRouter with the plugin's routes.
"""

from fastapi import APIRouter

from .schema import Pong

router = APIRouter()


@router.get("/ping", response_model=Pong)
def ping():
    """Health check for the template plugin."""
    return Pong(plugin="backend_plugin_template")
