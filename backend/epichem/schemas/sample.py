"""Request schema for the Sample write API (§7.1/§7.3).

Every other registry kind is *configuration*: it is authored as descriptor
YAML and the HTTP write body reuses that same `apiVersion/kind/metadata/spec`
envelope (`epichem.schemas.descriptor`, ADR 0004 §3). Samples are not
configuration — they are operational rows created as work happens, so they
get a plain JSON body instead of a descriptor envelope, and no YAML
import/export round-trip. See docs/adr/0005.

`state` is validated here rather than as a DB enum, matching the convention
in `models/topology.py`'s docstring: the allowed value set is still moving
and a migration per new value is friction the plan does not ask for.
"""

from typing import Literal

from pydantic import BaseModel, Field

#: §7.3's lifecycle states. The transition *rules* (and the SampleEvent log
#: that enforces them) are M4 — this minimal pass validates that a state is
#: a known one, not that the move to it was legal.
SAMPLE_STATES = (
    "registered",
    "staged",
    "reserved",
    "in_process",
    "processed",
    "characterized",
    "archived",
    "consumed",
    "disposed",
    "quarantined",
)

SampleState = Literal[
    "registered",
    "staged",
    "reserved",
    "in_process",
    "processed",
    "characterized",
    "archived",
    "consumed",
    "disposed",
    "quarantined",
]


class SampleWrite(BaseModel):
    """Body for both POST (create) and PUT (full replace) — PUT replaces the
    whole row, so one model serves both, the same way `Descriptor` does for
    the topology/device endpoints.
    """

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "code": "SMP-2026-0041",
                    "name": "PEDOT:PSS film, 60 s @ 2000 rpm",
                    "state": "registered",
                    "substance": "PEDOT:PSS",
                    "amount_value": 1.5,
                    "amount_unit": "mL",
                    "location": "RACK-A/3",
                    "owner": "j.doe",
                    "notes": "Spin-coated from the 1.5 wt% dispersion.",
                }
            ]
        }
    }

    code: str = Field(
        description="Human-readable identifier, unique across samples (§7.5), e.g. SMP-2026-0041.",
        min_length=1,
    )
    name: str = Field(description="Short human-readable label.", min_length=1)
    state: SampleState = Field(
        default="registered",
        description=(
            "§7.3 lifecycle state. Transition legality is not enforced yet "
            "(that needs M4's SampleEvent log); any known state is accepted."
        ),
    )
    substance: str | None = Field(
        default=None,
        description=(
            "Primary substance as free text. Stands in for §7.2's structured "
            "composition list until the Substance entity exists (M4)."
        ),
    )
    amount_value: float | None = Field(default=None, description="Numeric amount, if known.")
    amount_unit: str | None = Field(
        default=None,
        description=(
            "Unit for `amount_value` as free text (e.g. mL, mg). Not yet "
            "parsed/normalised with pint — that is M4 (§7.2)."
        ),
    )
    location: str | None = Field(
        default=None,
        description=(
            "Where the sample physically is, as free text (e.g. RACK-A/3). "
            "Becomes a Container/Slot reference derived from the event log in M4 (§7.3)."
        ),
    )
    owner: str | None = Field(default=None, description="Responsible person or group, free text.")
    notes: str | None = Field(default=None, description="Free-text notes.")
