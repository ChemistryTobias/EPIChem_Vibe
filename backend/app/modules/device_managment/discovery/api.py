"""Discovery: pods announce, people probe and adopt (plan §6.2 -- assist, never auto-register)."""

import hmac
import os
from datetime import timedelta
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.revisions.logic import record_revision
from app.modules.device_managment.lab.schema import LabDB
from app.modules.device_managment.station.logic import get_default_geometry
from app.modules.device_managment.station.schema import Station, StationDB
from app.modules.sample_tracking.samples.schema import utc_now
from app.modules.workflow_management.queueserver.logic import API_KEY_ENV, QueueserverError, client_for

from .schema import Adopt, Announcement, DiscoveredPod, DiscoveredPodDB, Probe

router = APIRouter(prefix="/discovery", tags=["discovery"])

CurrentUser = Annotated[User, Depends(get_current_user)]
ONLINE_WINDOW = timedelta(seconds=90)  # pods re-announce every 30 s


def _out(session, pod: DiscoveredPodDB) -> DiscoveredPod:
    out = DiscoveredPod.model_validate(pod)
    out.online = utc_now() - pod.last_seen < ONLINE_WINDOW
    station = session.query(StationDB).filter_by(queueserver_url=pod.url).first()
    out.station_uuid = station.uuid if station else None
    return out


def _upsert(session, data: Announcement, source: str) -> DiscoveredPodDB:
    pod = session.query(DiscoveredPodDB).filter_by(url=data.url.rstrip("/")).first()
    if pod is None:
        pod = DiscoveredPodDB(url=data.url.rstrip("/"), station=data.station, source=source)
        session.add(pod)
    pod.station = data.station
    pod.description = data.description
    pod.devices = data.devices
    pod.plans = data.plans
    pod.last_seen = utc_now()
    session.commit()
    session.refresh(pod)
    return pod


@router.post("/announce", status_code=204)
def announce(body: Announcement, session: SessionDepends, authorization: Optional[str] = Header(default=None)):
    """A pod saying it exists. Authenticated with the shared pod key
    (`Authorization: ApiKey <EPICHEM_QSERVER_API_KEY>`), not a user token."""
    key = os.environ.get(API_KEY_ENV)
    given = (authorization or "").removeprefix("ApiKey ").strip()
    if not key or not hmac.compare_digest(given, key):
        raise HTTPException(status_code=401, detail="Announcing needs the shared pod API key.")
    _upsert(session, body, "announce")


@router.get("/pods", response_model=list[DiscoveredPod])
def list_pods(session: SessionDepends, user: CurrentUser):
    """Every pod heard from, most recent first, with whether it's online and adopted."""
    pods = session.query(DiscoveredPodDB).order_by(DiscoveredPodDB.last_seen.desc()).all()
    return [_out(session, p) for p in pods]


@router.post("/probe", response_model=DiscoveredPod)
def probe(body: Probe, session: SessionDepends, user: CurrentUser):
    """Ask a URL whether it's a pod, and remember it if so."""
    url = body.url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Give the pod's full URL, e.g. http://station-spinbot:60610.")
    client = client_for(url)
    try:
        status = client.status()
        devices, plans = client.devices_allowed(), client.plans_allowed()
    except QueueserverError as exc:
        raise HTTPException(status_code=502, detail=f"No pod answered there: {exc.detail}") from None
    name = url.split("//", 1)[1].split(":")[0].split("/")[0]
    info = {n: {"classname": d.get("classname"), "module": d.get("module")} for n, d in devices.items()}
    pod = _upsert(
        session,
        Announcement(url=url, station=name, description=status.get("msg"), devices=info, plans=sorted(plans)),
        "probe",
    )
    return _out(session, pod)


@router.post("/pods/{pod_uuid}/adopt", response_model=Station)
def adopt(pod_uuid: UUID, body: Adopt, session: SessionDepends, user: CurrentUser):
    """Link a pod to a station -- an existing one, or a new one in a lab -- and
    register its devices. The human confirmation plan §6.2 asks for."""
    from app.modules.workflow_management.queueserver.api import register_pod_devices

    pod = session.get(DiscoveredPodDB, pod_uuid)
    if pod is None:
        raise HTTPException(status_code=404, detail="No such discovered pod.")
    if body.station_uuid:
        station = session.get(StationDB, body.station_uuid)
        if station is None:
            raise HTTPException(status_code=404, detail="No such station.")
        station.queueserver_url = pod.url
        action = "updated"
    else:
        if body.lab_uuid is None or session.get(LabDB, body.lab_uuid) is None:
            raise HTTPException(status_code=422, detail="Choose a station to link, or a lab to create one in.")
        name = (body.name or pod.station)[:50]
        if session.query(StationDB).filter_by(name=name).first():
            raise HTTPException(status_code=409, detail=f"A station called '{name}' already exists.")
        station = StationDB(
            name=name,
            lab_uuid=body.lab_uuid,
            queueserver_url=pod.url,
            description=pod.description,
            object_geometry=get_default_geometry({"lab_uuid": body.lab_uuid}).model_dump(mode="json"),
        )
        session.add(station)
        action = "created"
    session.commit()
    session.refresh(station)
    record_revision(
        session,
        entity_type=StationDB.__object_type__,
        entity_uuid=station.uuid,
        action=action,
        snapshot=Station.model_validate(station).model_dump(mode="json"),
        actor_uuid=user.uuid,
    )
    session.commit()
    if body.register_devices:
        register_pod_devices(str(station.uuid), session, user)
    session.refresh(station)
    return station


@router.delete("/pods/{pod_uuid}", status_code=204)
def dismiss(pod_uuid: UUID, session: SessionDepends, user: CurrentUser):
    """Forget a pod (it reappears if it announces again)."""
    pod = session.get(DiscoveredPodDB, pod_uuid)
    if pod is not None:
        session.delete(pod)
        session.commit()
