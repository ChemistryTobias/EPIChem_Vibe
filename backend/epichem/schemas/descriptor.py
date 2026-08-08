"""Pydantic schemas for descriptor YAML files (§4, §6.1, §6.3): the
`apiVersion/kind/metadata/spec` envelope, one `spec` shape per `kind`. This
is also the write API's request body shape (ADR 0004 §3) — YAML import and
HTTP writes share one model and one Descriptor->values translation path
(epichem.importer). The loader (epichem.descriptors.loader) validates files
into these before epichem.importer upserts them into the registry.

Topology kinds (Site/Lab/Zone/Station) aren't given an explicit YAML example
in the plan — only Device (§6.1) and CapabilityClass (§6.3) are. Their spec
shapes here follow the topology table in §5.1 as flattened by ADR 0007
(Workcell/Bench removed; grid onto Lab; execution binding onto Station;
Station's parent is a Lab, optionally a Zone).
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Kind = Literal["Site", "Lab", "Zone", "Station", "Device", "CapabilityClass"]


class Metadata(BaseModel):
    id: uuid.UUID | None = None
    code: str
    name: str
    labels: dict[str, str] = Field(default_factory=dict)
    # Only meaningful for CapabilityClass (§6.3 example: metadata.iri, an
    # ontology IRI) — optional and unused by every other kind.
    iri: str | None = None


# ---- Topology specs (§5.1) -------------------------------------------------


class SiteSpec(BaseModel):
    address: str | None = None
    timezone: str | None = None
    # The site is a metric canvas (ADR 0012): labs are boxes placed on it.
    width_m: float = 40.0
    depth_m: float = 40.0
    grid_size_m: float = 1.0
    # Number of building floors (ADR 0013); a layout-only field (labs on different
    # floors get separate plans), default 1 = single floor.
    floors: int = 1


class LabSpec(BaseModel):
    site: str  # Site.code this lab belongs to
    room_number: str | None = None
    environment_class: Literal["ambient", "glovebox", "fume_hood", "cleanroom"] = "ambient"
    access_control_group: str | None = None
    # The lab is a metric canvas (ADR 0010): floor size and grid spacing in
    # metres. Cell count is derived (width_m / grid_size_m), not stored.
    width_m: float = 6.0
    depth_m: float = 4.0
    grid_size_m: float = 0.5
    # The lab's box on the parent site canvas (ADR 0012), in metres — distinct
    # from width_m/depth_m (the lab's own floor). Standard 10x10 m default.
    site_pos_x: float = 0.0
    site_pos_y: float = 0.0
    site_size_x_m: float = 10.0
    site_size_y_m: float = 10.0
    # Which site floor this lab sits on (ADR 0013), 0-based; layout-only.
    floor: int = 0


class ZoneSpec(BaseModel):
    lab: str  # Lab.code
    atmosphere: Literal["air", "n2", "ar"] = "air"
    pressure: str | None = None
    temperature_class: str | None = None
    hazard_class: str | None = None
    # §12.2 human-vs-robot safety boundary; "shared" when unclassified.
    occupancy: Literal["human", "robot", "shared"] = "shared"


class StationSpec(BaseModel):
    lab: str  # Lab.code — a station always belongs to a lab (ADR 0007)
    zone: str | None = None  # Zone.code — optional; a station may sit inside a zone
    kind: str = "generic"
    # The station's box on the lab canvas, in metres (ADR 0010: snap-but-not-
    # bound). pos = position from the lab origin, size = footprint, height_m =
    # isometric box height.
    pos_x: float = 0.0
    pos_y: float = 0.0
    size_x_m: float = 1.0
    size_y_m: float = 1.0
    height_m: float = 0.5
    capacity: int = 1
    accepted_labware_types: list[str] = Field(default_factory=list)
    # Execution binding, moved off the removed Workcell (ADR 0007).
    queueserver_endpoint: str | None = None
    redis_namespace: str | None = None
    state: Literal["active", "maintenance", "offline"] = "active"
    owning_group: str | None = None
    # Soft-hide flag (ADR 0011): hidden from layout canvases when True.
    virtual: bool = False


# ---- Device spec (§6.1) -----------------------------------------------------


class SignalEnvelope(BaseModel):
    model_config = {"extra": "allow"}  # e.g. settling_s, resolution — see §6.1 example

    min: float | None = None
    max: float | None = None

    @model_validator(mode="after")
    def _max_not_below_min(self) -> "SignalEnvelope":
        if self.min is not None and self.max is not None and self.max < self.min:
            raise ValueError("envelope max must be >= min")
        return self


class OphydSpec(BaseModel):
    model_config = {"populate_by_name": True}

    import_: str = Field(alias="import")
    args: dict = Field(default_factory=dict)


class TransportSpec(BaseModel):
    protocol: Literal["epics-ca", "epics-pva", "tango", "rest", "sila2", "opcua", "sim"]
    uri: str | None = None
    ioc_host: str | None = None
    quality: Literal["nominal", "degraded"] = "nominal"


class NetworkSpec(BaseModel):
    netbox_device_id: int | None = None
    primary_ip: str | None = None
    mac: str | None = None
    vlan: str | None = None


class PoseSpec(BaseModel):
    x_mm: float | None = None
    y_mm: float | None = None
    z_mm: float | None = None
    yaw_deg: float | None = None


class FootprintSpec(BaseModel):
    # The node's box within its station's canvas (ADR 0012), in mm to match the
    # pose position. All optional: an unplaced node renders at a standard 0.1 m.
    size_x_mm: float | None = None
    size_y_mm: float | None = None
    size_z_mm: float | None = None


class LocationSpec(BaseModel):
    # lab/zone are informational (implied by station); station is authoritative
    # for placement (ADR 0007). Module nesting is expressed by `spec.parent`,
    # not here.
    lab: str | None = None
    zone: str | None = None
    station: str | None = None
    pose: PoseSpec | None = None
    footprint: FootprintSpec | None = None


class SafetySpec(BaseModel):
    flags: list[str] = Field(default_factory=list)
    interlocks: list[str] = Field(default_factory=list)
    max_unattended_minutes: int | None = None


class CalibrationSpec(BaseModel):
    last: str | None = None
    due: str | None = None
    certificate: str | None = None


class OperationalSpec(BaseModel):
    mode: Literal["read_only", "read_write", "maintenance", "disabled"] = "read_write"
    calibration: CalibrationSpec | None = None


class DeviceSpec(BaseModel):
    model_config = {"populate_by_name": True}

    # "device" (controllable leaf) or "module" (grouping / sub-assembly /
    # passive component). ADR 0007. A module promises no capability, so `class`
    # and `transport` are optional — required in practice for a real device,
    # absent for a passive module.
    node_kind: Literal["device", "module"] = "device"
    class_: str | None = Field(default=None, alias="class")
    parent: str | None = None
    ophyd: OphydSpec | None = None
    transport: TransportSpec | None = None
    network: NetworkSpec = Field(default_factory=NetworkSpec)
    location: LocationSpec = Field(default_factory=LocationSpec)
    capabilities: list[str] = Field(default_factory=list)
    envelope: dict[str, SignalEnvelope] = Field(default_factory=dict)
    safety: SafetySpec = Field(default_factory=SafetySpec)
    operational: OperationalSpec = Field(default_factory=OperationalSpec)
    # Soft-hide flag (ADR 0011): hidden from layout canvases when True.
    virtual: bool = False


# ---- Capability class spec (§6.3) ------------------------------------------


class ActionParam(BaseModel):
    model_config = {"extra": "allow"}

    type: str
    required: bool = False
    default: object | None = None
    unit: str | None = None
    from_envelope: str | None = None


class CapabilityAction(BaseModel):
    plan: str
    params: dict[str, ActionParam] = Field(default_factory=dict)
    contract: list[str] = Field(default_factory=list)  # RFC 2119 sentences
    emits: list[str] = Field(default_factory=list)


class CapabilityClassSpec(BaseModel):
    extends: list[str] = Field(default_factory=list)
    actions: dict[str, CapabilityAction] = Field(default_factory=dict)


SPEC_BY_KIND: dict[Kind, type[BaseModel]] = {
    "Site": SiteSpec,
    "Lab": LabSpec,
    "Zone": ZoneSpec,
    "Station": StationSpec,
    "Device": DeviceSpec,
    "CapabilityClass": CapabilityClassSpec,
}


class Descriptor(BaseModel):
    apiVersion: str
    kind: Kind
    metadata: Metadata
    spec: dict

    @field_validator("apiVersion")
    @classmethod
    def _known_api_version(cls, v: str) -> str:
        if v != "epichem.dev/v1":
            raise ValueError(f"unsupported apiVersion {v!r}, expected 'epichem.dev/v1'")
        return v

    def typed_spec(self) -> BaseModel:
        """Re-validate `spec` into the concrete model for this `kind`."""
        return SPEC_BY_KIND[self.kind].model_validate(self.spec)
