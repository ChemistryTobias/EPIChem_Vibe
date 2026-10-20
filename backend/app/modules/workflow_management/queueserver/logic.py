"""A thin client for one station's bluesky-httpserver (plan §9.1, Roadmap 1.3/2.2).

EPIChem never executes anything (plan §3): this is the whole of its contact
with execution — read what a station offers, hand it queue items, start/stop
its queue, read back what happened. Every call is a plain HTTP request to the
pod; nothing here keeps state.
"""

import os
from typing import Any

import httpx
from fastapi import HTTPException

API_KEY_ENV = "EPICHEM_QSERVER_API_KEY"
TIMEOUT_S = float(os.environ.get("EPICHEM_QSERVER_TIMEOUT_S", "10"))


class QueueserverError(HTTPException):
    """The station answered with an error, or didn't answer — a 502 to our caller,
    with the station's own message, so the console can say what went wrong."""

    def __init__(self, message: str):
        super().__init__(status_code=502, detail=message)


class QueueserverClient:
    def __init__(self, base_url: str, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        key = api_key if api_key is not None else os.environ.get(API_KEY_ENV)
        self._headers = {"Authorization": f"ApiKey {key}"} if key else {}

    def _call(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        url = f"{self.base_url}/api{path}"
        try:
            response = httpx.request(method, url, json=body, headers=self._headers, timeout=TIMEOUT_S)
        except httpx.HTTPError as exc:
            raise QueueserverError(f"Station queueserver at {self.base_url} is unreachable: {exc}") from exc
        if response.status_code in (401, 403):
            raise QueueserverError(
                f"Station queueserver at {self.base_url} refused EPIChem's API key ({API_KEY_ENV})."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise QueueserverError(f"Station queueserver answered {response.status_code} with no JSON.") from exc
        if response.status_code >= 400:
            raise QueueserverError(f"Station queueserver: {payload.get('detail', payload)}")
        # Most endpoints report failure in-band rather than by status code.
        if payload.get("success") is False:
            raise QueueserverError(f"Station queueserver: {payload.get('msg') or 'request failed'}")
        return payload

    # --- reading ----------------------------------------------------------
    def status(self) -> dict[str, Any]:
        return self._call("GET", "/status")

    def plans_allowed(self) -> dict[str, Any]:
        return self._call("GET", "/plans/allowed").get("plans_allowed", {})

    def devices_allowed(self) -> dict[str, Any]:
        return self._call("GET", "/devices/allowed").get("devices_allowed", {})

    def queue(self) -> dict[str, Any]:
        """`{"items": [...], "running_item": {...}}` — pending items and the one executing."""
        return self._call("GET", "/queue/get")

    def history(self) -> list[dict[str, Any]]:
        return self._call("GET", "/history/get").get("items", [])

    # --- acting -----------------------------------------------------------
    def add_batch(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Adds items to the back of the queue; returns them with their `item_uid`s."""
        return self._call("POST", "/queue/item/add/batch", {"items": items}).get("items", [])

    def remove_item(self, uid: str) -> None:
        self._call("POST", "/queue/item/remove", {"uid": uid})

    def start(self) -> None:
        self._call("POST", "/queue/start")

    def open_environment(self) -> None:
        self._call("POST", "/environment/open")

    def abort(self) -> None:
        """Stop *now*: pause immediately, then abort the running plan."""
        self._call("POST", "/re/pause", {"option": "immediate"})
        self._call("POST", "/re/abort")


def client_for(base_url: str) -> QueueserverClient:
    """The one place a client gets built — tests replace this with a fake."""
    return QueueserverClient(base_url)
