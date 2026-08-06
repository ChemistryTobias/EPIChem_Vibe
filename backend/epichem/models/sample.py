"""Sample model (§7.1) — deliberately a *minimal* slice of the plan's sample
model, not the whole of §7.

§7 specifies an eight-entity graph (Substance / Batch / Sample / Container /
Labware / Slot / Consumable / Location), an event-sourced lifecycle whose
`SampleEvent` log is the only thing allowed to move a sample, and a typed
`DerivationEdge` lineage DAG exported as PROV-O. That is M4 and it is not
built here. What *is* built is one flat `Sample` row with just enough fields
to be genuinely useful in a list/detail UI, so the frontend's Samples screen
reads real rows out of the registry instead of fixtures.

Deliberately deferred to a real M4 pass (each of these is a whole entity or
subsystem, not a missing column):

- `Substance` / `Batch` -> `substance` is a free-text label here.
- `Container` / `Labware` / `Slot` -> `location` is a free-text label here.
  §7.3 says location must be *derived* from the event log and never edited
  directly; with no event log yet, it is a plain editable string.
- `SampleEvent` -> state is a plain mutable column. Every write still lands
  in the shared `Revision` table (ADR 0004), so there is an audit trail —
  it is a config-style revision history, not §7.3's operational event log.
- `DerivationEdge` lineage, PROV-O export, DataMatrix marking, ELN
  federation -> absent entirely.

Like the topology models, the enumerated field (`state`) is a plain string
validated where data enters the system (`epichem.schemas.sample`), not a DB
enum — same reasoning as `models/topology.py`'s docstring.
"""

from sqlalchemy.orm import Mapped, mapped_column

from epichem.models.base import RegistryEntity


class Sample(RegistryEntity):
    """A physical sample. `code` is the human-readable identifier §7.5 asks
    for alongside the UUIDv7 primary key (`SMP-2026-0041`).
    """

    __tablename__ = "samples"

    #: §7.3 lifecycle state. Free-form at the DB layer; the allowed set is
    #: `epichem.schemas.sample.SAMPLE_STATES`.
    state: Mapped[str] = mapped_column(default="registered", index=True)

    #: Primary substance, as free text — stands in for the §7.2 composition
    #: list of {substance, role, amount} triples until `Substance` exists.
    substance: Mapped[str | None] = mapped_column(default=None)

    amount_value: Mapped[float | None] = mapped_column(default=None)
    amount_unit: Mapped[str | None] = mapped_column(default=None)

    #: Where it physically is, as free text (e.g. "RACK-A/3", "FREEZER-2").
    #: Becomes a Slot/Container reference in M4.
    location: Mapped[str | None] = mapped_column(default=None)

    #: Responsible person/group. Free text until §12.1 auth exists and
    #: there are real identities to reference.
    owner: Mapped[str | None] = mapped_column(default=None)

    notes: Mapped[str | None] = mapped_column(default=None)
