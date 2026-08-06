"""limit/offset paging on the two lists that grow with the work
(epichem/api/pagination.py). Topology lists are deliberately unpaged.
"""

import pytest
from fastapi.testclient import TestClient

from epichem.api.pagination import DEFAULT_LIMIT, MAX_LIMIT, TOTAL_COUNT_HEADER


@pytest.fixture
def client(session, monkeypatch):
    from epichem import db

    monkeypatch.setattr(db, "SessionLocal", lambda: session)

    from epichem.api.app import create_app

    return TestClient(create_app())


@pytest.fixture
def many_samples(client):
    for i in range(25):
        client.post(
            "/api/v1/samples",
            json={"code": f"SMP-{i:03d}", "name": f"Sample {i}", "state": "registered"},
        )
    return 25


def test_total_count_header_reports_all_matches_not_the_page(client, many_samples):
    r = client.get("/api/v1/samples", params={"limit": 10})

    assert len(r.json()) == 10
    assert r.headers[TOTAL_COUNT_HEADER] == str(many_samples)


def test_offset_walks_the_whole_set_without_gaps_or_repeats(client, many_samples):
    seen = []
    for offset in range(0, many_samples, 10):
        page = client.get("/api/v1/samples", params={"limit": 10, "offset": offset}).json()
        seen.extend(s["code"] for s in page)

    assert len(seen) == many_samples
    assert len(set(seen)) == many_samples


def test_offset_past_the_end_is_an_empty_page_not_an_error(client, many_samples):
    r = client.get("/api/v1/samples", params={"offset": 999})

    assert r.status_code == 200
    assert r.json() == []
    assert r.headers[TOTAL_COUNT_HEADER] == str(many_samples)


def test_total_count_respects_filters(client, many_samples):
    client.post(
        "/api/v1/samples",
        json={"code": "SMP-ODD", "name": "Odd one", "state": "quarantined"},
    )

    r = client.get("/api/v1/samples", params={"state": "quarantined"})

    assert r.headers[TOTAL_COUNT_HEADER] == "1"
    assert [s["code"] for s in r.json()] == ["SMP-ODD"]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": MAX_LIMIT + 1}, {"offset": -1}])
def test_out_of_range_paging_params_are_rejected(client, params):
    assert client.get("/api/v1/samples", params=params).status_code == 422


def test_default_limit_applies_when_unspecified(client):
    r = client.get("/api/v1/samples")

    assert r.status_code == 200
    schema = client.get("/openapi.json").json()
    limit = next(
        p for p in schema["paths"]["/api/v1/samples"]["get"]["parameters"] if p["name"] == "limit"
    )
    assert limit["schema"]["default"] == DEFAULT_LIMIT


def test_devices_are_paged_and_count_after_the_capability_filter(client, session):
    """The capability filter runs in Python (JSON column), so the window has
    to be applied after it — otherwise the page is short and the total lies.
    """
    from epichem.models import CapabilityClass, Device

    cc = CapabilityClass(name="Klass", actions={"heat": {}, "stir": {}})
    session.add(cc)
    session.flush()
    for i in range(6):
        session.add(
            Device(
                code=f"DEV-{i}",
                name=f"Device {i}",
                capability_class_id=cc.id,
                capabilities=["heat"] if i % 2 == 0 else ["stir"],
            )
        )
    session.commit()

    r = client.get("/api/v1/devices", params={"capability": "heat", "limit": 2})

    assert r.headers[TOTAL_COUNT_HEADER] == "3"  # 3 match, not 6
    assert len(r.json()) == 2
    assert all("heat" in d["capabilities"] for d in r.json())


def test_topology_lists_are_not_paged(client):
    """Bounded by physical reality, not usage — a pager there would be
    ceremony. If that ever changes, this test is the reminder."""
    schema = client.get("/openapi.json").json()
    params = {p["name"] for p in schema["paths"]["/api/v1/sites"]["get"].get("parameters", [])}
    assert "limit" not in params
