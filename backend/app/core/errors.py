# Registered on the app instance, not an APIRouter -- FastAPI requires that.
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(IntegrityError)
    def handle_integrity_error(request: Request, exc: IntegrityError):
        return JSONResponse(status_code=409, content={"detail": "A conflict occured."})
