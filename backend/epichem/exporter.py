"""Serializes registry rows back to `Descriptor`-shaped dicts and YAML text
— the inverse of `importer.py`'s Descriptor-to-values translation, for
`epichem <kind> export` and `epichem export-dir` (ADR 0004 §3: YAML as
import/export interchange, not desired state).

CapabilityClass has no persisted `code` column (its natural key is `name`,
see `models/capability.py`) — the descriptor's `metadata.code` is never
stored on import (`importer.capability_class_values` doesn't read it), so
there's nothing to recover on export. `metadata.code` is emitted as
`obj.name` instead: any value satisfies `Metadata.code`'s "required string"
constraint, and CapabilityClass import doesn't read `metadata.code` either,
so this is a lossless round-trip despite not reproducing the original file's
`code` value verbatim.

Device `location` only ever reconstructs `spec.location.station` — `lab`/
`zone`/`workcell`/`bench` are left unset, matching the write side, which
never reads them (`api/routers/devices.py`'s `_device_values` only consumes
`spec.location.station` and `spec.location.pose`).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from epichem.importer import TOPOLOGY_BY_KIND, TOPOLOGY_WRITE, TopologyKind, station_codes_by_device
from epichem.models import CapabilityClass, Device

API_VERSION = "epichem.dev/v1"

_SUBDIR_BY_KIND = {
    "Site": "topology",
    "Lab": "topology",
    "Zone": "topology",
    "Workcell": "topology",
    "Bench": "topology",
    "Station": "topology",
    "Device": "devices",
    "CapabilityClass": "classes",
}


def _prune(value: Any) -> Any:
    """Drop None/empty-dict/empty-list values (recursively): every spec
    field that can end up None or empty already defaults to that same
    None/empty value on re-import (Pydantic `default`/`default_factory` in
    `schemas/descriptor.py`), so omitting them is lossless and keeps the
    YAML human-editable, matching the style of the hand-written files under
    `descriptors/`.
    """
    if isinstance(value, dict):
        pruned = {k: _prune(v) for k, v in value.items()}
        return {k: v for k, v in pruned.items() if v not in (None, {}, [])}
    if isinstance(value, list):
        return [_prune(v) for v in value]
    return value


def _export_topology(entry: TopologyKind, obj: Any) -> dict:
    spec: dict[str, Any] = {}
    if entry.parent_field:
        spec[entry.parent_field] = getattr(obj, entry.parent_field).code
    for attr in entry.attrs:
        spec[attr] = getattr(obj, attr)
    return {
        "apiVersion": API_VERSION,
        "kind": entry.kind,
        "metadata": {"code": obj.code, "name": obj.name},
        "spec": _prune(spec),
    }


def _export_capability_class(obj: CapabilityClass) -> dict:
    metadata: dict[str, Any] = {"code": obj.name, "name": obj.name}
    if obj.iri:
        metadata["iri"] = obj.iri
    spec = {"extends": obj.extends, "actions": obj.actions}
    return {
        "apiVersion": API_VERSION,
        "kind": "CapabilityClass",
        "metadata": metadata,
        "spec": _prune(spec),
    }


def _export_device(session: Session, obj: Device) -> dict:
    spec: dict[str, Any] = {"class": obj.capability_class_ref}
    if obj.parent is not None:
        spec["parent"] = obj.parent.code

    if obj.ophyd_import:
        spec["ophyd"] = {"import": obj.ophyd_import, "args": obj.ophyd_args}

    spec["transport"] = {
        "protocol": obj.transport_protocol,
        "uri": obj.transport_uri,
        "ioc_host": obj.transport_ioc_host,
        # Omitted when nominal: that's TransportSpec's default, so re-import
        # reproduces it, and it keeps the common case out of the YAML.
        "quality": obj.transport_quality if obj.transport_quality != "nominal" else None,
    }
    spec["network"] = {
        "netbox_device_id": obj.network_netbox_device_id,
        "primary_ip": obj.network_primary_ip,
        "mac": obj.network_mac,
        "vlan": obj.network_vlan,
    }

    location: dict[str, Any] = {}
    station_code = station_codes_by_device(session, [obj.id]).get(obj.id)
    if station_code:
        location["station"] = station_code
    pose = _prune(
        {
            "x_mm": obj.pose_x_mm,
            "y_mm": obj.pose_y_mm,
            "z_mm": obj.pose_z_mm,
            "yaw_deg": obj.pose_yaw_deg,
        }
    )
    if pose:
        location["pose"] = pose
    if location:
        spec["location"] = location

    spec["capabilities"] = obj.capabilities
    spec["envelope"] = obj.envelope
    spec["safety"] = {
        "flags": obj.safety_flags,
        "interlocks": obj.safety_interlocks,
        "max_unattended_minutes": obj.safety_max_unattended_minutes,
    }
    operational: dict[str, Any] = {"mode": obj.operational_mode}
    if obj.operational_calibration:
        operational["calibration"] = obj.operational_calibration
    spec["operational"] = operational

    metadata: dict[str, Any] = {"code": obj.code, "name": obj.name}
    if obj.labels:
        metadata["labels"] = obj.labels

    return {
        "apiVersion": API_VERSION,
        "kind": "Device",
        "metadata": metadata,
        "spec": _prune(spec),
    }


def export_row(session: Session, kind: str, obj: Any) -> dict:
    if kind == "CapabilityClass":
        return _export_capability_class(obj)
    if kind == "Device":
        return _export_device(session, obj)
    return _export_topology(TOPOLOGY_BY_KIND[kind], obj)


def to_yaml(document: dict) -> str:
    return yaml.safe_dump(document, sort_keys=False, default_flow_style=False)


def _slug(code: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", code.lower()).strip("-")


def _unique_path(directory: Path, stem: str, taken: set[Path]) -> Path:
    """Never let one exported row silently overwrite another.

    Codes are unique per *table*, not globally, and all six topology kinds
    share one `topology/` directory — so a Site and a Lab both coded "A"
    used to produce the same filename and the second write clobbered the
    first. Kind-prefixing the stem fixes that case; this guard covers the
    remainder (two codes in one kind that slugify identically, e.g. "A/B"
    and "A-B") by appending a counter rather than losing a row.
    """
    path = directory / f"{stem}.yaml"
    counter = 2
    while path in taken:
        path = directory / f"{stem}-{counter}.yaml"
        counter += 1
    taken.add(path)
    return path


def export_dir(session: Session, directory: Path | str) -> list[Path]:
    """Bulk export the entire current registry, laid out the same way as
    the `descriptors/` example tree: `topology/*.yaml`, `classes/*.yaml`,
    `devices/*.yaml`. Topology filenames carry their kind (`site-a.yaml`,
    `lab-a.yaml`) because that one directory holds six kinds; import globs
    the tree and doesn't care about filenames either way.
    """
    directory = Path(directory)
    written: list[Path] = []
    taken: set[Path] = set()

    for entry in TOPOLOGY_WRITE:
        subdir = directory / _SUBDIR_BY_KIND[entry.kind]
        subdir.mkdir(parents=True, exist_ok=True)
        for obj in session.execute(select(entry.model)).scalars():
            path = _unique_path(subdir, f"{entry.kind.lower()}-{_slug(obj.code)}", taken)
            path.write_text(to_yaml(_export_topology(entry, obj)))
            written.append(path)

    classes_dir = directory / _SUBDIR_BY_KIND["CapabilityClass"]
    classes_dir.mkdir(parents=True, exist_ok=True)
    for obj in session.execute(select(CapabilityClass)).scalars():
        path = _unique_path(classes_dir, _slug(obj.name), taken)
        path.write_text(to_yaml(_export_capability_class(obj)))
        written.append(path)

    devices_dir = directory / _SUBDIR_BY_KIND["Device"]
    devices_dir.mkdir(parents=True, exist_ok=True)
    for obj in session.execute(select(Device)).scalars():
        path = _unique_path(devices_dir, _slug(obj.code), taken)
        path.write_text(to_yaml(_export_device(session, obj)))
        written.append(path)

    return written
