# ADR 0002: Internal registry with a NetBox-shaped schema; no NetBox dependency in M1

**Answers plan §17 Q2.**

**Status:** Accepted (default — revisit once FHI IT is consulted)

## Context

§6.4 says NetBox's data model fits the lab domain well and should be mapped
onto rather than reimplemented, but §17 Q2 explicitly says "ask FHI IT first"
whether an institutional NetBox instance exists. This session has no way to
ask FHI IT, and §6.4 itself notes that running NetBox is "an operational
dependency (Postgres, Redis, workers) that a two-person lab may not want."

## Decision

M1 does **not** integrate NetBox. The `Device` model's `network` fields
(`primary_ip`, `mac`, `vlan`, and a nullable `netbox_device_id`) are shaped to
match §6.4's mapping table, so a NetBox sync plugin can be added later without
a schema migration that renames fields — it would only need to start
populating `netbox_device_id` and syncing on a schedule/webhook. Until then,
network fields are populated directly from the device descriptor YAML
(`spec.network`), hand-maintained like everything else in the descriptor.

## Consequences

- Zero extra infrastructure for a new deployment (matches G8).
- Network fields can drift from physical reality with no automatic check —
  acceptable for M1 scope (a handful of devices), not for a 40-instrument
  institute. Flag this explicitly to the user before M5 (scale) if NetBox
  still isn't wired up by then.
- **Action item, not closed:** ask FHI IT whether an institutional NetBox
  instance exists before M5. If yes, add a sync job against the existing
  schema fields rather than redesigning them.
