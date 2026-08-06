"""Shared-token auth on the write API (epichem/api/auth.py).

Reads stay open; writes need a bearer token *when EPICHEM_API_TOKENS is
set*, and the token's label lands in Revision.created_by.
"""

import pytest
from fastapi.testclient import TestClient

from epichem.api.auth import TOKENS_ENV, configured_tokens

TOKENS = "ci:ci-secret,tobias:hunter2"
AUTH = {"Authorization": "Bearer ci-secret"}


@pytest.fixture
def make_client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    def _make():
        from epichem.api.app import create_app

        return TestClient(create_app())

    return _make


@pytest.fixture
def open_client(make_client, monkeypatch):
    monkeypatch.delenv(TOKENS_ENV, raising=False)
    return make_client()


@pytest.fixture
def secured_client(make_client, monkeypatch):
    monkeypatch.setenv(TOKENS_ENV, TOKENS)
    return make_client()


def _site(code="SITE-A"):
    return {
        "apiVersion": "epichem.dev/v1",
        "kind": "Site",
        "metadata": {"code": code, "name": "Site A"},
        "spec": {},
    }


def _sample(code="SMP-1"):
    return {"code": code, "name": "Sample", "state": "registered"}


def test_tokens_parse_from_the_environment(monkeypatch):
    monkeypatch.setenv(TOKENS_ENV, TOKENS)
    assert configured_tokens() == {"ci-secret": "ci", "hunter2": "tobias"}


def test_malformed_token_entries_are_ignored(monkeypatch):
    monkeypatch.setenv(TOKENS_ENV, "no-colon-here, ci:ci-secret ,")
    assert configured_tokens() == {"ci-secret": "ci"}


def test_writes_are_open_when_the_variable_is_unset(open_client):
    assert open_client.post("/api/v1/sites", json=_site()).status_code == 201
    assert open_client.post("/api/v1/samples", json=_sample()).status_code == 201


def test_write_without_a_token_is_401_problem_json(secured_client):
    r = secured_client.post("/api/v1/sites", json=_site())

    assert r.status_code == 401
    assert r.headers["content-type"] == "application/problem+json"
    assert r.headers["www-authenticate"] == "Bearer"
    assert r.json()["title"] == "Not authenticated"


def test_write_with_a_wrong_token_is_401(secured_client):
    r = secured_client.post(
        "/api/v1/sites", json=_site(), headers={"Authorization": "Bearer nope"}
    )
    assert r.status_code == 401


def test_write_with_a_valid_token_succeeds(secured_client):
    assert secured_client.post("/api/v1/sites", json=_site(), headers=AUTH).status_code == 201


def test_reads_never_need_a_token(secured_client):
    secured_client.post("/api/v1/sites", json=_site(), headers=AUTH)

    assert secured_client.get("/api/v1/sites").status_code == 200
    assert secured_client.get("/api/v1/sites/SITE-A").status_code == 200
    assert secured_client.get("/api/v1/sites/SITE-A/revisions").status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/v1/sites", _site("SITE-X")),
        ("put", "/api/v1/sites/SITE-A", _site()),
        ("delete", "/api/v1/sites/SITE-A", None),
        ("post", "/api/v1/device-classes", None),
        ("post", "/api/v1/devices", None),
        ("post", "/api/v1/samples", _sample("SMP-X")),
        ("put", "/api/v1/samples/SMP-1", _sample()),
        ("delete", "/api/v1/samples/SMP-1", None),
    ],
)
def test_every_write_route_is_gated(secured_client, method, path, body):
    """Guards against a new write endpoint being added without the
    dependency — the failure mode that makes a half-applied auth layer worse
    than none, because it looks protected."""
    request = getattr(secured_client, method)
    response = request(path, json=body) if body is not None else request(path)
    assert response.status_code == 401, f"{method.upper()} {path} was not gated"


def test_revision_created_by_records_the_token_label(secured_client):
    secured_client.post(
        "/api/v1/sites", json=_site("SITE-WHO"), headers={"Authorization": "Bearer hunter2"}
    )

    revisions = secured_client.get("/api/v1/sites/SITE-WHO/revisions").json()
    assert [r["created_by"] for r in revisions] == ["tobias"]


def test_created_by_is_null_when_auth_is_disabled(open_client):
    open_client.post("/api/v1/sites", json=_site("SITE-ANON"))

    revisions = open_client.get("/api/v1/sites/SITE-ANON/revisions").json()
    assert [r["created_by"] for r in revisions] == [None]


def test_cli_writes_have_no_actor(session, monkeypatch, capsys):
    """The CLI has no identity to record; created_by stays null there even
    when the API is secured."""
    monkeypatch.setenv(TOKENS_ENV, TOKENS)
    from sqlalchemy import select

    from epichem import cli
    from epichem.models import Revision

    monkeypatch.setattr(cli, "SessionLocal", lambda: session)
    cli.main(["sample", "add", "SMP-CLI", "From the CLI"])

    revision = session.execute(select(Revision)).scalars().one()
    assert revision.created_by is None
