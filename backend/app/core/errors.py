"""App-wide exception handlers.

Handlers can only be registered on the FastAPI app instance (not on an
APIRouter), so they live here as a function that main.py calls with the app.
Add more handlers inside `install_exception_handlers` as the API grows.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


def install_exception_handlers(app: FastAPI) -> None:
    
    @app.exception_handler(IntegrityError)
    def handle_integrity_error(request: Request, exc: IntegrityError):
        return JSONResponse(status_code=409, content={"detail": "A conflict occured."})
