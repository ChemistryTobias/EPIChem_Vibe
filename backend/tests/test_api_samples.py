"""Tests for the Sample API (§7.1 minimal slice, see models/sample.py).

Follows test_api_write.py's TestClient + sqlite-in-memory fixture pattern.
Samples take a plain JSON body rather than the descriptor envelope every
other kind uses (docs/adr/0005), so there are no `_*_descriptor` helpers
here — just dicts.
"""

import pytest
from fastapi.testclient import TestClient

from epichem.models import Revision, Sample


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


def _sample(code: str, name: str, **overrides) -> dict:
    body = {
        "code": code,
        "name": name,
        "state": "registered",
        "substance": "PEDOT:PSS",
        "amount_value": 1.5,
        "amount_unit": "mL",
        "location": "RACK-A/3",
        "owner": "j.doe",
        "notes": None,
    }
    body.update(overrides)
    return body


def test_post_creates_sample_and_conflicts_on_duplicate_code(client):
    r = client.post("/api/v1/samples", json=_sample("SMP-2026-0001", "First film"))
    assert r.status_code == 201
    body = r.json()
    assert body["code"] == "SMP-2026-0001"
    assert body["state"] == "registered"
    assert body["amount_value"] == 1.5
    assert "id" in body and "created_at" in body

    r = client.post("/api/v1/samples", json=_sample("SMP-2026-0001", "Duplicate"))
    assert r.status_code == 409
    assert r.headers["content-type"] == "application/problem+json"


def test_post_rejects_unknown_state(client):
    r = client.post("/api/v1/samples", json=_sample("SMP-X", "Bad state", state="levitating"))
    assert r.status_code == 422


def test_get_by_code_and_by_id_and_404(client):
    created = client.post("/api/v1/samples", json=_sample("SMP-2026-0002", "Second")).json()

    assert client.get("/api/v1/samples/SMP-2026-0002").json()["id"] == created["id"]
    assert client.get(f"/api/v1/samples/{created['id']}").json()["code"] == "SMP-2026-0002"

    r = client.get("/api/v1/samples/NOPE")
    assert r.status_code == 404
    assert r.headers["content-type"] == "application/problem+json"


def test_list_filters_by_state_owner_substance_and_q(client):
    client.post("/api/v1/samples", json=_sample("SMP-A", "Alpha film", owner="a.one"))
    client.post(
        "/api/v1/samples",
        json=_sample("SMP-B", "Beta powder", state="staged", substance="TiO2", owner="b.two"),
    )

    assert len(client.get("/api/v1/samples").json()) == 2

    only_staged = client.get("/api/v1/samples", params={"state": "staged"}).json()
    assert [s["code"] for s in only_staged] == ["SMP-B"]

    by_owner = client.get("/api/v1/samples", params={"owner": "a.one"}).json()
    assert [s["code"] for s in by_owner] == ["SMP-A"]

    by_substance = client.get("/api/v1/samples", params={"substance": "TiO2"}).json()
    assert [s["code"] for s in by_substance] == ["SMP-B"]

    # q matches code, name or substance, case-insensitively
    assert [s["code"] for s in client.get("/api/v1/samples", params={"q": "powder"}).json()] == [
        "SMP-B"
    ]
    assert [s["code"] for s in client.get("/api/v1/samples", params={"q": "smp-a"}).json()] == [
        "SMP-A"
    ]


def test_put_replaces_fields_and_resets_omitted_optionals(client):
    client.post("/api/v1/samples", json=_sample("SMP-2026-0003", "Third"))

    r = client.put(
        "/api/v1/samples/SMP-2026-0003",
        json={"code": "SMP-2026-0003", "name": "Third, renamed", "state": "in_process"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Third, renamed"
    assert body["state"] == "in_process"
    # PUT is a full replace: fields absent from the body go back to defaults.
    assert body["substance"] is None
    assert body["amount_value"] is None
    assert body["location"] is None

    assert client.put("/api/v1/samples/NOPE", json=_sample("NOPE", "Nope")).status_code == 404


def test_delete_removes_row_but_keeps_revision_history(client, session):
    client.post("/api/v1/samples", json=_sample("SMP-2026-0004", "Fourth"))

    assert client.delete("/api/v1/samples/SMP-2026-0004").status_code == 204
    assert client.get("/api/v1/samples/SMP-2026-0004").status_code == 404
    assert session.query(Sample).count() == 0

    kept = session.query(Revision).filter(Revision.entity_type == "Sample").all()
    assert [rev.action for rev in kept] == ["created", "deleted"]
    assert kept[-1].snapshot["code"] == "SMP-2026-0004"


def test_writes_record_revisions_and_no_op_put_records_none(client):
    client.post("/api/v1/samples", json=_sample("SMP-2026-0005", "Fifth"))
    client.put("/api/v1/samples/SMP-2026-0005", json=_sample("SMP-2026-0005", "Fifth renamed"))
    # identical body a second time -> update_entity diffs, nothing changed
    client.put("/api/v1/samples/SMP-2026-0005", json=_sample("SMP-2026-0005", "Fifth renamed"))

    revisions = client.get("/api/v1/samples/SMP-2026-0005/revisions").json()
    assert [(r["revision_number"], r["action"]) for r in revisions] == [
        (1, "created"),
        (2, "updated"),
    ]
    assert revisions[1]["snapshot"]["name"] == "Fifth renamed"
