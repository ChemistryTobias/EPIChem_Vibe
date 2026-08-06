"""Topology endpoints (§8.1 subset): read + write. The registry (Postgres)
is the source of truth for topology (ADR 0004) — writes go through
`create_entity`/`update_entity`/`delete_entity` (`epichem.registry`), each
recording a `Revision`. The M2 layout editor still owns visual layout
editing; this is CRUD only.

Write endpoints for the six topology kinds (Site/Lab/Zone/Workcell/Bench/
Station) are near-identical apart from which model/parent/attrs they touch,
so they're registered from one data-driven table (`TOPOLOGY_WRITE`, imported
from `epichem.importer`) rather than six hand-written copies. That table and
the Descriptor->values translation (`resolve_topology_values`) are shared
with `epichem.importer`'s YAML import path, so there's exactly one copy of
each, not one per caller.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from epichem.api.deps import get_session
from epichem.api.errors import ConflictProblem, UnprocessableProblem
from epichem.api.resolve import resolve_by_code_or_id
from epichem.api.schemas import (
    BenchOut,
    LabOut,
    RevisionOut,
    SiteOut,
    StationOut,
    WorkcellOut,
    ZoneOut,
)
from epichem.api.validation import check_descriptor_kind
from epichem.importer import TOPOLOGY_WRITE, TopologyKind, resolve_topology_values
from epichem.models import Bench, Lab, Site, Station, Workcell, Zone
from epichem.registry import create_entity, delete_entity, list_revisions, update_entity
from epichem.schemas.descriptor import Descriptor

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


# ---- write endpoints (ADR 0004) --------------------------------------------


def _register_topology_routes(entry: TopologyKind) -> None:
    kind, plural, model_cls, out_schema = entry.kind, entry.plural, entry.model, entry.out_schema

    def resolve_values(descriptor: Descriptor, session: Session) -> dict:
        try:
            return resolve_topology_values(entry, descriptor, session)
        except ValueError as e:
            raise UnprocessableProblem(
                title=f"{kind} references could not be resolved", detail=str(e)
            ) from e

    def create(descriptor: Descriptor, session: Session = Depends(get_session)):
        check_descriptor_kind(descriptor, kind)
        values = resolve_values(descriptor, session)
        try:
            obj, _revision = create_entity(session, model_cls, kind, out_schema, values)
        except ValueError as e:
            raise ConflictProblem(title=f"{kind} already exists", detail=str(e)) from e
        session.commit()
        return obj

    def replace(ident: str, descriptor: Descriptor, session: Session = Depends(get_session)):
        check_descriptor_kind(descriptor, kind)
        obj = resolve_by_code_or_id(session, model_cls, ident)
        values = resolve_values(descriptor, session)
        update_entity(session, obj, kind, out_schema, values)
        session.commit()
        return obj

    def delete(ident: str, session: Session = Depends(get_session)):
        obj = resolve_by_code_or_id(session, model_cls, ident)
        try:
            delete_entity(session, obj, kind, out_schema)
        except IntegrityError:
            session.rollback()
            raise ConflictProblem(
                title=f"{kind} cannot be deleted",
                detail=f"{kind} {ident!r} is still referenced by other records",
            ) from None
        session.commit()
        return None

    def revisions(ident: str, session: Session = Depends(get_session)):
        obj = resolve_by_code_or_id(session, model_cls, ident)
        return list_revisions(session, kind, obj.id)

    router.add_api_route(
        f"/{plural}", create, methods=["POST"], response_model=out_schema, status_code=201
    )
    router.add_api_route(
        f"/{plural}/{{ident}}", replace, methods=["PUT"], response_model=out_schema
    )
    router.add_api_route(f"/{plural}/{{ident}}", delete, methods=["DELETE"], status_code=204)
    router.add_api_route(
        f"/{plural}/{{ident}}/revisions",
        revisions,
        methods=["GET"],
        response_model=list[RevisionOut],
    )


for _entry in TOPOLOGY_WRITE:
    _register_topology_routes(_entry)
