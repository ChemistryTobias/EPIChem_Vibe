"""Tests for the health endpoint (api/routers/health.py).

This route exists for infrastructure — compose healthchecks, the CI verify
stage, Kubernetes probes — which means its contract is a status code, not a
body shape. The tests are written around that: what a probe would key on.

Follows test_api_samples.py's TestClient + in-memory-sqlite fixture pattern.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def test_health_returns_200_when_the_database_answers(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "ok"


def test_health_is_open_without_a_token(client, monkeypatch):
    """A probe has no credentials. If this ever needed one, every container
    healthcheck and readiness probe would fail closed and take the service
    down — so gating it would be actively harmful, not merely inconvenient."""
    monkeypatch.setenv("EPICHEM_API_TOKENS", "ci:secret-token")

    assert client.get("/api/v1/health").status_code == 200


def test_health_reports_503_when_the_database_is_unreachable(client):
    """The point of the endpoint: a live process with a dead database must not
    report itself ready, or a rolling deploy will happily route traffic to it."""

    class DeadSession:
        def execute(self, *_args, **_kwargs):
            raise RuntimeError("connection refused")

    # dependency_overrides, not monkeypatch: the router does
    # `from epichem.api.deps import get_session` at import time, so the
    # function object is already captured in the route's Depends() default and
    # rebinding the module attribute would have no effect. FastAPI keys the
    # override off that same object, so it does.
    from epichem.api.app import create_app
    from epichem.api.deps import get_session

    app = create_app()
    app.dependency_overrides[get_session] = lambda: DeadSession()

    dead_client = TestClient(app)
    response = dead_client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert response.json()["database"] == "error"


def test_health_reports_the_schema_revision(client):
    """Rolling deploys fail most often as new code against an old schema, and
    that failure is invisible to a process-only check."""
    body = client.get("/api/v1/health").json()

    assert "schema_revision" in body
    assert "schema_head" in body
    assert "schema_current" in body
