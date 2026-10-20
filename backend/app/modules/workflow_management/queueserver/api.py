"""Per-station execution endpoints: what a station's pod can run, and its queue (plan §9.2, Roadmap 2.2).

The palette endpoint is what the workflow designer's node list and parameter
forms are generated from — straight from the pod's `plans_allowed` /
`devices_allowed`, never hand-maintained.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app.core.access_control.auth.api import get_current_user
from app.core.revisions.logic import record_revision
from app.modules.device_managment.devices.logic import get_default_geometry
from app.modules.device_managment.devices.schema import Device, DeviceDB
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.modules.device_managment.station.api import get_station

from . import logic

router = APIRouter(prefix="/stations/{identifier}/execution", tags=["execution"])

CurrentUser = Annotated[User, Depends(get_current_user)]

# The subset of RE Manager status the console shows.
STATUS_FIELDS = (
    "manager_state",
    "re_state",
    "worker_environment_exists",
    "worker_environment_state",
    "items_in_queue",
    "items_in_history",
    "running_item_uid",
    "queue_stop_pending",
)


def station_client(identifier: str, session, user) -> logic.QueueserverClient:
    station = get_station(identifier, session, user)
    if not station.queueserver_url:
        raise HTTPException(
            status_code=409,
            detail=f"Station '{station.name}' has no queueserver URL -- set one to make it executable.",
        )
    return logic.client_for(station.queueserver_url)


@router.get("")
def get_execution_status(identifier: str, session: SessionDepends, user: CurrentUser) -> dict[str, Any]:
    """Whether the station is executable and, if so, its RE Manager state.

    An unreachable pod is reported in the body (`reachable: false`), not as an
    error: a dashboard listing many stations shouldn't fail because one is down.
    """
    station = get_station(identifier, session, user)
    if not station.queueserver_url:
        return {"configured": False, "reachable": False, "url": None, "status": None, "error": None}
    try:
        status = logic.client_for(station.queueserver_url).status()
    except logic.QueueserverError as exc:
        return {"configured": True, "reachable": False, "url": station.queueserver_url, "status": None, "error": exc.detail}
    return {
        "configured": True,
        "reachable": True,
        "url": station.queueserver_url,
        "status": {key: status.get(key) for key in STATUS_FIELDS},
        "error": None,
    }


def registered_ophyd_names(session, station_uuid) -> set[str]:
    rows = session.query(DeviceDB.ophyd_name).filter(DeviceDB.station_uuid == station_uuid, DeviceDB.ophyd_name.isnot(None))
    return {name for (name,) in rows}


@router.get("/palette")
def get_palette(identifier: str, session: SessionDepends, user: CurrentUser) -> dict[str, Any]:
    """The plans and devices this station offers, as the queueserver represents them,
    plus which of those devices are registered in EPIChem on this station."""
    client = station_client(identifier, session, user)
    station = get_station(identifier, session, user)
    devices = client.devices_allowed()
    registered = registered_ophyd_names(session, station.uuid)
    return {"plans": client.plans_allowed(), "devices": devices, "registered": sorted(registered & set(devices))}


@router.post("/devices/register", response_model=list[Device], status_code=201)
def register_pod_devices(identifier: str, session: SessionDepends, user: CurrentUser):
    """Create a registry Device for every pod device not yet registered on this
    station, linked by `ophyd_name` -- the quick way to make a new station's
    instruments known. Returns the devices created (none if all were)."""
    client = station_client(identifier, session, user)
    station = get_station(identifier, session, user)
    known = registered_ophyd_names(session, station.uuid)
    taken = {name for (name,) in session.query(DeviceDB.name)}
    created = []
    for ophyd_name, info in client.devices_allowed().items():
        if ophyd_name in known:
            continue
        name = f"{ophyd_name} ({station.name})"[:50]
        suffix = 2
        while name in taken:
            name = f"{ophyd_name} ({station.name}) {suffix}"[:50]
            suffix += 1
        taken.add(name)
        device = DeviceDB(
            name=name,
            description=f"{info.get('classname', 'Device')} from {info.get('module', 'the station pod')}",
            station_uuid=station.uuid,
            ophyd_name=ophyd_name,
            object_geometry=get_default_geometry({"station_uuid": station.uuid}).model_dump(mode="json"),
        )
        session.add(device)
        session.commit()  # before the next default placement looks for a free slot
        session.refresh(device)
        record_revision(
            session,
            entity_type=DeviceDB.__object_type__,
            entity_uuid=device.uuid,
            action="created",
            snapshot=Device.model_validate(device).model_dump(mode="json"),
            actor_uuid=user.uuid,
        )
        session.commit()
        created.append(device)
    return created


@router.get("/queue")
def get_queue(identifier: str, session: SessionDepends, user: CurrentUser) -> dict[str, Any]:
    """Pending items, the running one, and the most recent history (newest first)."""
    client = station_client(identifier, session, user)
    queue = client.queue()
    history = client.history()
    return {
        "items": queue.get("items", []),
        "running_item": queue.get("running_item") or None,
        "history": list(reversed(history[-25:])),
    }


@router.post("/environment/open", status_code=204)
def open_environment(identifier: str, session: SessionDepends, user: CurrentUser):
    """Start the station's worker (loads its devices and plans)."""
    station_client(identifier, session, user).open_environment()


@router.post("/queue/start", status_code=204)
def start_queue(identifier: str, session: SessionDepends, user: CurrentUser):
    """Start working through the station's queue."""
    station_client(identifier, session, user).start()
