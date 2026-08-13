"""App-wide exception handlers.

Handlers can only be registered on the FastAPI app instance (not on an
APIRouter), so they live here as a function that main.py calls with the app.
Add more handlers inside `install_exception_handlers` as the API grows.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class NotFoundError(Exception):
    """Raised by an endpoint when a requested resource does not exist → 404."""

    def __init__(self, detail: str = "Resource not found."):
        self.detail = detail


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(IntegrityError)
    def handle_integrity_error(request: Request, exc: IntegrityError):
        return JSONResponse(status_code=409, content={"detail": "A conflict occured."})

    @app.exception_handler(NotFoundError)
    def handle_not_found_error(request: Request, exc: NotFoundError):
        return JSONResponse(status_code=404, content={"detail": exc.detail})
