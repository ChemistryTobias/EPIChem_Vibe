#!/usr/bin/env python3
"""Local-dev seed: admin user, one site, two labs, one station. See scripts/README.md."""

import os
import sys

import httpx

BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000") + "/api/v1"
ADMIN_NAME = "admin"
ADMIN_PASSWORD = "12345678" 

def main() -> None:
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        print(f"creating user '{ADMIN_NAME}'")
        created = client.post("/users", json={"name": ADMIN_NAME, "password": ADMIN_PASSWORD})
        if created.status_code == 409:
            print(f"user '{ADMIN_NAME}' already exists -- aborting, this stack is likely already seeded")
            sys.exit(1)
        created.raise_for_status()

        login = client.post("/auth/login", json={"name": ADMIN_NAME, "password": ADMIN_PASSWORD})
        login.raise_for_status()
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

        site = client.post("/sites", json={"name": "Example Site"}).raise_for_status().json()
        lab1 = client.post("/labs", json={"name": "Lab 1", "site_uuid": site["uuid"]}).raise_for_status().json()
        lab2 = client.post("/labs", json={"name": "Lab 2", "site_uuid": site["uuid"]}).raise_for_status().json()
        station = client.post("/stations", json={"name": "Station 1", "lab_uuid": lab1["uuid"]}).raise_for_status().json()

        print("seeded:")
        print(f"  admin user: {ADMIN_NAME} / {ADMIN_PASSWORD}")
        print(f"  site:       {site['name']}")
        print(f"  lab 1:      {lab1['name']} (has {station['name']})")
        print(f"  lab 2:      {lab2['name']}")


if __name__ == "__main__":
    main()
