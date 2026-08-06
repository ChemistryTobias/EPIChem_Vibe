"""RFC 9457 ("Problem Details for HTTP APIs") error responses, per §8.1.

Scoped to the one error case the read API actually produces right now — a
lookup that finds nothing. FastAPI's own request-validation errors (422) are
left in their default shape; wrapping every possible error path in
problem+json before there's a second one to compare against would be
speculative.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

PROBLEM_MEDIA_TYPE = "application/problem+json"


class NotFoundProblem(Exception):
    def __init__(self, title: str, detail: str):
        self.title = title
        self.detail = detail


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundProblem)
    async def _handle_not_found(request: Request, exc: NotFoundProblem) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            media_type=PROBLEM_MEDIA_TYPE,
            content={
                "type": "about:blank",
                "title": exc.title,
                "status": 404,
                "detail": exc.detail,
                "instance": str(request.url),
            },
        )
