"""Pydantic schemas for the git-backed descriptor YAML files (§4, §6.1,
§6.3): the `apiVersion/kind/metadata/spec` envelope, one `spec` shape per
`kind`. These are the schemas descriptor authors write against, and what
the loader (epichem.descriptors.loader) validates files into before the
reconciler upserts them into the registry.

Topology kinds (Site/Lab/Zone/Workcell/Bench/Station) aren't given an
explicit YAML example in the plan — only Device (§6.1) and CapabilityClass
(§6.3) are. Their spec shapes here follow directly from the topology table
in §5.1 and are recorded as a decision in docs/adr/0003.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Kind = Literal[
    "Site", "Lab", "Zone", "Workcell", "Bench", "Station", "Device", "CapabilityClass"
]


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


class LabSpec(BaseModel):
    site: str  # Site.code this lab belongs to
    room_number: str | None = None
    environment_class: Literal["ambient", "glovebox", "fume_hood", "cleanroom"] = "ambient"
    access_control_group: str | None = None


class ZoneSpec(BaseModel):
    lab: str  # Lab.code
    atmosphere: Literal["air", "n2", "ar"] = "air"
    pressure: str | None = None
    temperature_class: str | None = None
    hazard_class: str | None = None


class WorkcellSpec(BaseModel):
    zone: str  # Zone.code
    queueserver_endpoint: str | None = None
    redis_namespace: str | None = None
    state: Literal["active", "maintenance", "offline"] = "active"
    owning_group: str | None = None


class BenchSpec(BaseModel):
    workcell: str  # Workcell.code
    grid_cols: int = 1
    grid_rows: int = 1
    height_mm: float | None = None


class StationSpec(BaseModel):
    bench: str  # Bench.code
    kind: str = "generic"
    grid_col: int = 0
    grid_row: int = 0
    stack_height: int = 1
    capacity: int = 1
    accepted_labware_types: list[str] = Field(default_factory=list)


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


class LocationSpec(BaseModel):
    lab: str | None = None
    zone: str | None = None
    workcell: str | None = None
    bench: str | None = None
    station: str | None = None
    pose: PoseSpec | None = None


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

    class_: str = Field(alias="class")
    parent: str | None = None
    ophyd: OphydSpec | None = None
    transport: TransportSpec
    network: NetworkSpec = Field(default_factory=NetworkSpec)
    location: LocationSpec = Field(default_factory=LocationSpec)
    capabilities: list[str] = Field(default_factory=list)
    envelope: dict[str, SignalEnvelope] = Field(default_factory=dict)
    safety: SafetySpec = Field(default_factory=SafetySpec)
    operational: OperationalSpec = Field(default_factory=OperationalSpec)


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
    "Workcell": WorkcellSpec,
    "Bench": BenchSpec,
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
