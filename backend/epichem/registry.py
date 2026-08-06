"""Generic, kind-agnostic versioned write service (ADR 0004): create/update/
delete for any registry entity kind, recording a full-snapshot Revision on
every write. This is the shared write path a later HTTP write API and YAML
import/export are meant to code against, so the function signatures here
are the contract.

Natural-key matching mirrors reconciler.py's `_upsert_row`: every kind is
matched by `code` except `CapabilityClass`, which has no `code` column and
is matched by `name` instead (see `models/capability.py`).

`resolve_device_references` ports reconciler.py's per-device validation
(capability-class resolution by trailing dotted segment of `spec.class_`,
capability-name membership against the union of all registered
`CapabilityClass.actions` keys, station lookup by code, parent lookup by
code) to a single entity — no batch/fixed-point cascade, since a single
API write's parent either already exists in the DB or it's an error.
"""

import uuid
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.models.capability import CapabilityClass
from epichem.models.device import Device
from epichem.models.revision import Revision
from epichem.models.topology import Station

_NATURAL_KEY_BY_MODEL = {CapabilityClass: "name"}


def _natural_key_attr(model_cls: type) -> str:
    return _NATURAL_KEY_BY_MODEL.get(model_cls, "code")


def _snapshot(out_schema: type[BaseModel], obj: Any) -> dict:
    return out_schema.model_validate(obj).model_dump(mode="json")


def next_revision_number(session: Session, entity_type: str, entity_id: uuid.UUID) -> int:
    stmt = (
        select(Revision.revision_number)
        .where(Revision.entity_type == entity_type, Revision.entity_id == entity_id)
        .order_by(Revision.revision_number.desc())
        .limit(1)
    )
    last = session.execute(stmt).scalar_one_or_none()
    return (last or 0) + 1


def record_revision(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    snapshot: dict,
    created_by: str | None = None,
) -> Revision:
    revision = Revision(
        entity_type=entity_type,
        entity_id=entity_id,
        revision_number=next_revision_number(session, entity_type, entity_id),
        action=action,
        snapshot=snapshot,
        created_by=created_by,
    )
    session.add(revision)
    session.flush()  # so a same-transaction follow-up call sees this revision_number
    return revision


def create_entity(
    session: Session,
    model_cls: type,
    entity_type: str,
    out_schema: type[BaseModel],
    values: dict,
) -> tuple[Any, Revision]:
    """Insert a new row, flush to get its id, record a "created" revision.
    Raises ValueError if a row with the same natural key already exists.
    """
    key_attr = _natural_key_attr(model_cls)
    key_value = values[key_attr]
    stmt = select(model_cls).where(getattr(model_cls, key_attr) == key_value)
    if session.execute(stmt).scalar_one_or_none() is not None:
        raise ValueError(f"{entity_type} with {key_attr}={key_value!r} already exists")

    obj = model_cls(**values)
    session.add(obj)
    session.flush()
    revision = record_revision(session, entity_type, obj.id, "created", _snapshot(out_schema, obj))
    return obj, revision


def update_entity(
    session: Session,
    obj: Any,
    entity_type: str,
    out_schema: type[BaseModel],
    values: dict,
) -> Revision | None:
    """Only set fields that actually differ. Returns None (no revision
    recorded) if nothing changed; otherwise flushes and records an
    "updated" revision with the post-change snapshot.
    """
    changed = False
    for k, v in values.items():
        if getattr(obj, k) != v:
            setattr(obj, k, v)
            changed = True
    if not changed:
        return None

    session.flush()
    return record_revision(session, entity_type, obj.id, "updated", _snapshot(out_schema, obj))


def delete_entity(
    session: Session, obj: Any, entity_type: str, out_schema: type[BaseModel]
) -> Revision:
    """Record a "deleted" revision with the pre-delete snapshot, then hard-
    delete the row. Referential integrity is the caller's problem —
    IntegrityError is not caught here and propagates on flush.
    """
    entity_id = obj.id
    snapshot = _snapshot(out_schema, obj)
    revision = record_revision(session, entity_type, entity_id, "deleted", snapshot)
    session.delete(obj)
    session.flush()
    return revision


def list_revisions(session: Session, entity_type: str, entity_id: uuid.UUID) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == entity_id)
        .order_by(Revision.revision_number.asc())
    )
    return list(session.execute(stmt).scalars())


def resolve_device_references(
    session: Session,
    capability_class_ref: str,
    capabilities: list[str],
    station_code: str | None,
    parent_code: str | None = None,
) -> dict:
    """Validate and resolve a single Device's cross-references. Raises
    ValueError describing every problem found (mirrors reconciler.py's
    per-device problem list) if resolution fails. Returns
    {"capability_class_id": UUID, "station_id": UUID | None,
    "parent_id": UUID | None}.
    """
    problems: list[str] = []

    class_name = capability_class_ref.rsplit(".", 1)[-1]
    cc = session.execute(
        select(CapabilityClass).where(CapabilityClass.name == class_name)
    ).scalar_one_or_none()
    if cc is None:
        problems.append(
            f"class {capability_class_ref!r} does not resolve to any registered "
            f"CapabilityClass (looked for name {class_name!r})"
        )

    all_actions: set[str] = set()
    for c in session.execute(select(CapabilityClass)).scalars():
        all_actions.update(c.actions.keys())
    missing_caps = [c for c in capabilities if c not in all_actions]
    if missing_caps:
        problems.append(
            f"capabilities {missing_caps} are not defined by any registered CapabilityClass"
        )

    station_id = None
    if station_code:
        station_id = session.execute(
            select(Station.id).where(Station.code == station_code)
        ).scalar_one_or_none()
        if station_id is None:
            problems.append(f"location.station {station_code!r} not found")

    parent_id = None
    if parent_code:
        parent_id = session.execute(
            select(Device.id).where(Device.code == parent_code)
        ).scalar_one_or_none()
        if parent_id is None:
            problems.append(f"parent {parent_code!r} not found")

    if problems:
        raise ValueError("; ".join(problems))

    return {"capability_class_id": cc.id, "station_id": station_id, "parent_id": parent_id}
