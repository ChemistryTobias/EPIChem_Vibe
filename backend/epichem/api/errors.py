"""RFC 9457 ("Problem Details for HTTP APIs") error responses, per §8.1.

Four cases: `UnauthorizedProblem` (401 — a write without a valid bearer
token, see `api/auth.py`), `NotFoundProblem` (404 — a lookup found nothing),
`ConflictProblem` (409 — a natural-key already exists on create, or a delete
is blocked by a row still referencing this one), `UnprocessableProblem`
(422 — a cross-reference in the request body doesn't resolve, e.g. an
unknown capability or station code). FastAPI's own request-validation errors
(422 for a malformed body) are left in their default shape; only errors this
API raises itself go through problem+json.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

PROBLEM_MEDIA_TYPE = "application/problem+json"


class UnauthorizedProblem(Exception):
    def __init__(self, title: str, detail: str):
        self.title = title
        self.detail = detail


class NotFoundProblem(Exception):
    def __init__(self, title: str, detail: str):
        self.title = title
        self.detail = detail


class ConflictProblem(Exception):
    def __init__(self, title: str, detail: str):
        self.title = title
        self.detail = detail


class UnprocessableProblem(Exception):
    def __init__(self, title: str, detail: str):
        self.title = title
        self.detail = detail


def _problem_response(status_code: int, request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        media_type=PROBLEM_MEDIA_TYPE,
        content={
            "type": "about:blank",
            "title": exc.title,
            "status": status_code,
            "detail": exc.detail,
            "instance": str(request.url),
        },
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(UnauthorizedProblem)
    async def _handle_unauthorized(request: Request, exc: UnauthorizedProblem) -> JSONResponse:
        response = _problem_response(401, request, exc)
        # RFC 9110 §11.6.1: a 401 must say how to authenticate.
        response.headers["WWW-Authenticate"] = "Bearer"
        return response

    @app.exception_handler(NotFoundProblem)
    async def _handle_not_found(request: Request, exc: NotFoundProblem) -> JSONResponse:
        return _problem_response(404, request, exc)

    @app.exception_handler(ConflictProblem)
    async def _handle_conflict(request: Request, exc: ConflictProblem) -> JSONResponse:
        return _problem_response(409, request, exc)

    @app.exception_handler(UnprocessableProblem)
    async def _handle_unprocessable(request: Request, exc: UnprocessableProblem) -> JSONResponse:
        return _problem_response(422, request, exc)
