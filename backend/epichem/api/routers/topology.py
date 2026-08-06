"""Read-only topology endpoints (§8.1 subset). Topology is git-backed
(§4) — it's written by `epichem reconcile`, not through this API. Mutating
endpoints (`PUT /api/v1/layouts/{lab}`) belong to the M2 layout editor, not
here.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.api.deps import get_session
from epichem.api.resolve import resolve_by_code_or_id
from epichem.api.schemas import BenchOut, LabOut, SiteOut, StationOut, WorkcellOut, ZoneOut
from epichem.models import Bench, Lab, Site, Station, Workcell, Zone

router = APIRouter(prefix="/api/v1", tags=["topology"])


@router.get("/sites", response_model=list[SiteOut])
def list_sites(session: Session = Depends(get_session)):
    return session.execute(select(Site)).scalars().all()


@router.get("/sites/{ident}", response_model=SiteOut)
def get_site(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Site, ident)


@router.get("/labs", response_model=list[LabOut])
def list_labs(
    session: Session = Depends(get_session),
    site: str | None = Query(None, description="Filter by Site.code"),
):
    stmt = select(Lab)
    if site:
        stmt = stmt.join(Site, Site.id == Lab.site_id).where(Site.code == site)
    return session.execute(stmt).scalars().all()


@router.get("/labs/{ident}", response_model=LabOut)
def get_lab(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Lab, ident)


@router.get("/zones", response_model=list[ZoneOut])
def list_zones(
    session: Session = Depends(get_session),
    lab: str | None = Query(None, description="Filter by Lab.code"),
):
    stmt = select(Zone)
    if lab:
        stmt = stmt.join(Lab, Lab.id == Zone.lab_id).where(Lab.code == lab)
    return session.execute(stmt).scalars().all()


@router.get("/zones/{ident}", response_model=ZoneOut)
def get_zone(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Zone, ident)


@router.get("/workcells", response_model=list[WorkcellOut])
def list_workcells(
    session: Session = Depends(get_session),
    zone: str | None = Query(None, description="Filter by Zone.code"),
):
    stmt = select(Workcell)
    if zone:
        stmt = stmt.join(Zone, Zone.id == Workcell.zone_id).where(Zone.code == zone)
    return session.execute(stmt).scalars().all()


@router.get("/workcells/{ident}", response_model=WorkcellOut)
def get_workcell(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Workcell, ident)


@router.get("/benches", response_model=list[BenchOut])
def list_benches(
    session: Session = Depends(get_session),
    workcell: str | None = Query(None, description="Filter by Workcell.code"),
):
    stmt = select(Bench)
    if workcell:
        stmt = stmt.join(Workcell, Workcell.id == Bench.workcell_id).where(
            Workcell.code == workcell
        )
    return session.execute(stmt).scalars().all()


@router.get("/benches/{ident}", response_model=BenchOut)
def get_bench(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Bench, ident)


@router.get("/stations", response_model=list[StationOut])
def list_stations(
    session: Session = Depends(get_session),
    bench: str | None = Query(None, description="Filter by Bench.code"),
):
    stmt = select(Station)
    if bench:
        stmt = stmt.join(Bench, Bench.id == Station.bench_id).where(Bench.code == bench)
    return session.execute(stmt).scalars().all()


@router.get("/stations/{ident}", response_model=StationOut)
def get_station(ident: str, session: Session = Depends(get_session)):
    return resolve_by_code_or_id(session, Station, ident)
