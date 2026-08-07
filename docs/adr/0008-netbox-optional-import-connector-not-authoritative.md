# ADR 0008: NetBox is an optional import connector, not an upstream system of record

**Supersedes the "NetBox authoritative, one-way sync" framing in plan §6.4 and
narrows ADR 0002. Answers plan §17 Q2.**

**Status:** Accepted (2026-08-07). Supersedes ADR 0002's forward-looking sync
plan; ADR 0002's *schema-shaping* guidance still stands.

## Context

Plan §6.4 proposes NetBox as **authoritative** for network + physical asset
facts, with a scheduled + webhook **one-way sync** (NetBox → EPIChem) and a
reconciliation report. ADR 0002 deferred any NetBox integration for M1 but kept
the `Device` network fields NetBox-shaped so that sync could be added later
"without a schema migration."

That authoritative-upstream framing conflicts with how the user actually wants
to work, and with ADR 0004:

- **ADR 0004** makes the EPIChem database the *versioned source of truth*: every
  write records a `Revision`. An authoritative NetBox sync would overwrite
  EPIChem-side edits to synced fields, contradicting "the database is the source
  of truth" and the user's explicit requirement that topology be **"created
  here, where one can edit everything."**
- The user's stated intent: *"NetBox should only be considered as a side-note to
  optionally connect via the APIs, and there one could later add syncing… as
  long as EPIChem has an API it's fine for now."*

## Decision

**EPIChem is fully authoritative for topology and devices. NetBox is an
optional, one-directional *import connector*, not a system of record.**

- Topology and devices are created and edited **in EPIChem** and persist there;
  nothing external overwrites them.
- NetBox (and the flat CSV/API export it produces — see the MPG-FKF
  `Netbox_devices.csv` sample) is an **import source**: a user may pull an
  inventory into EPIChem as a starting point. Import is an **idempotent upsert**
  through `registry.py` (like `import-dir` today, ADR 0004), so imported rows are
  revisioned and thereafter editable like any other.
  - NetBox's `Site → Location → Rack → Device` maps to EPIChem's
    `Site → Lab → Station → Device` (ADR 0007). A rack (e.g. `SpinBot`) becomes a
    **Station** grouping its devices — "a group import of multiple devices."
- **Live bidirectional or authoritative sync is explicitly deferred**, not
  designed away. The `Device` network fields stay NetBox-shaped (ADR 0002), and
  a nullable `netbox_device_id` remains, so a future sync job can be added
  without a schema migration. But until someone asks for it, EPIChem does not
  depend on, poll, or defer to a NetBox instance.
- **EPIChem's own HTTP API is the integration surface.** Anything that wants to
  keep NetBox and EPIChem aligned can do so against EPIChem's API from the
  outside; EPIChem does not need to embed a NetBox client to be useful.

## Consequences

- **No operational dependency on NetBox** for a new deployment — matches G8 and
  ADR 0002's zero-extra-infra outcome, and now it's a permanent stance for the
  foreseeable roadmap, not just an M1 deferral.
- Network facts can drift from physical reality with no automatic reconciliation
  — acceptable while EPIChem is the place people edit, and revisited only if a
  real institutional NetBox instance is later designated the master (which would
  need a new ADR superseding this one).
- Plan §6.4's mapping table and the "**Integration mode**" paragraph are
  **superseded**: read "NetBox is authoritative… sync is one-way" as "NetBox is
  an optional import; EPIChem is authoritative." The `Admin → NetBox sync
  status` screen (plan §13) becomes `NetBox import` (last import, row counts,
  conflicts), not a sync dashboard.
- The `epichem` CLI/API gains a NetBox/CSV import path as part of the M2 slice
  (ADR 0009 sequencing), reusing the existing importer machinery.
