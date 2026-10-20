"""Shared fixtures: a fresh sqlite file per test session, wiped between tests, and a signed-in client."""

import os
import tempfile

# Must happen before anything imports app.core.database, which reads it at import.
os.environ["EPICHEM_ORCHESTRATOR"] = "off"  # tests advance runs explicitly (tick())
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp(prefix='epichem-test-')}/test.db"

import pytest
from fastapi.testclient import TestClient

from app.core.database import Database, engine
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_database():
    Database.metadata.drop_all(engine)
    Database.metadata.create_all(engine)
    yield


@pytest.fixture
def client() -> TestClient:
    """A TestClient already carrying a bearer token for user `tester`."""
    c = TestClient(app)
    c.post("/api/v1/users", json={"name": "tester", "password": "12345678"}).raise_for_status()
    token = c.post("/api/v1/auth/login", json={"name": "tester", "password": "12345678"}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {token}"
    return c


@pytest.fixture
def layout(client):
    """One site, two labs side by side (the second away from the site origin), one station."""
    site = client.post("/api/v1/sites", json={"name": "Site"}).json()
    lab1 = client.post("/api/v1/labs", json={"name": "Lab 1", "site_uuid": site["uuid"]}).json()
    lab2 = client.post("/api/v1/labs", json={"name": "Lab 2", "site_uuid": site["uuid"]}).json()
    station = client.post("/api/v1/stations", json={"name": "Station 1", "lab_uuid": lab1["uuid"]}).json()
    return {"site": site, "lab1": lab1, "lab2": lab2, "station": station}
