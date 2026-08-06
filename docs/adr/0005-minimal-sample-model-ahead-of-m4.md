# ADR 0005: A minimal Sample row now, ahead of M4 — plain JSON body, no descriptor YAML

**Status:** Accepted — by explicit user direction (see Context).

## Context

The frontend's Samples screen needs real rows. The plan's §7 sample model is the M4 milestone and
is large: eight entities (`Substance`, `Batch`, `Sample`, `Container`, `Labware`, `Slot`,
`Consumable`, `Location`), a structured composition list of `{substance, role, amount}` triples
with `pint`-normalised units (§7.2), an event-sourced lifecycle where a `SampleEvent` log is the
only thing allowed to move a sample and location is *derived* from that log rather than edited
(§7.3), a typed `DerivationEdge` lineage DAG serialised as PROV-O (§7.4), DataMatrix physical
marking (§7.5), and ELN federation (§7.6, still blocked on an institutional Chemotion-vs-Kadi4Mat
decision).

Plan §14 sequences samples *after* procedures for a reason: "topology before devices, devices
before procedures, procedures before samples... inverting any pair produces rework." Building M4
properly now would be out of order and would be a large speculative bet on a model whose consumers
(procedures, scheduling) don't exist yet.

The user asked for a middle option explicitly: a **minimal real sample backend now, with a good
documented API** — not fixtures in the frontend, and not the full §7 model.

## Decision

**1. One flat `Sample` row, and nothing else from §7.**

`epichem/models/sample.py` extends `RegistryEntity` like every other kind (UUIDv7 `id` + unique
`code`, matching §7.5's "UUIDv7 plus a human-readable code" and the `SMP-2026-0041` example
already sitting in `RegistryEntity`'s own docstring). Fields: `state`, `substance`,
`amount_value`, `amount_unit`, `location`, `owner`, `notes`.

Three §7 concepts are collapsed into free-text strings rather than modelled:

| §7 concept | Here | Why |
|---|---|---|
| `Substance`/`Batch` + §7.2 composition list | `substance: str` | A composition list needs a `Substance` entity and unit normalisation to be worth anything. One label is honest; a half-modelled composition would not be. |
| `Container`/`Labware`/`Slot` + §7.3 derived location | `location: str` | §7.3 says location must be derived from the event log and never edited directly. With no event log, a derived field would be a lie — so it's a plain editable string, clearly labelled as such. |
| §7.3 `SampleEvent` log | mutable `state` column | State can be moved by a PUT. Transition *legality* is not enforced. |

Absent entirely: lineage `DerivationEdge`s, PROV-O export, DataMatrix marking, ELN federation.

Each of these is a whole entity or subsystem, not a missing column, which is what makes this a
scope cut rather than an incomplete implementation: M4 will add tables next to this one, and the
main migration cost is moving `substance`/`location` from strings to foreign keys.

**2. Writes go through `registry.py`, same as every other kind.**

`create_entity`/`update_entity`/`delete_entity`, so every sample write records a full-snapshot
`Revision` (ADR 0004) and `GET /api/v1/samples/{ident}/revisions` works exactly like the device
and topology equivalents. This is *not* §7.3's operational event log — it's the same config-style
audit trail the rest of the registry has. When M4 adds `SampleEvent`, the two coexist: revisions
record "who edited this row", events record "what physically happened to this sample".

**3. Samples take a plain JSON body, not the `apiVersion/kind/metadata/spec` descriptor envelope —
and get no YAML import/export.**

Every other registry kind is *configuration*: authored by a lab engineer as descriptor YAML, and
ADR 0004 §3 deliberately reused that same envelope as the HTTP write body so there is one shape
and one translation path. Samples are not configuration. They are operational rows created as work
happens — dozens a week, by instruments and technicians, not reviewed and versioned as a lab's
definition. Wrapping them in a descriptor envelope would imply a `descriptors/samples/` directory
that should never exist, and `epichem export-dir` would start emitting a lab's experimental record
as config files.

So: `epichem/schemas/sample.py::SampleWrite` is a flat pydantic model used for both POST and PUT,
`Sample` is deliberately **not** added to `Kind`, `SPEC_BY_KIND`, `TOPOLOGY_WRITE`, the importer,
the exporter, or `KIND_CLI`. The CLI gets `epichem sample list` / `epichem sample add` instead of
the `export`/`import` pair, mostly so a fresh database can be seeded without a browser.

Consistent with the rest of the registry, `state` is a plain string column validated at the
pydantic layer against `SAMPLE_STATES` rather than a DB enum — same reasoning as
`models/topology.py`'s docstring.

## Consequences

- The Samples screen reads real rows from a real table; there is no fixture data anywhere in the
  frontend.
- Sample edits are audited from day one, for free, because they reuse the ADR 0004 write path.
- M4 is still M4. This does not pre-decide the composition model, the lineage edge types, or the
  ELN target — it deliberately avoids modelling any of them.
- Two forward migrations are already visible and accepted: `substance` string → `Substance`/`Batch`
  reference, and `location` string → `Slot`/`Container` reference derived from the event log. Both
  are data migrations on a table that will be small until M4 anyway.
- `GET /api/v1/samples` has no pagination. Fine for a table screen against a lab that is being
  built out; must be addressed before this points at a real sample population.
- Sample writes are unauthenticated, like the rest of the API (§12.1 is unbuilt). Unchanged risk,
  but note it now applies to experimental records and not only to config.
