# ADR 0006: No Redis yet — it belongs to the device plane, not the registry

**Status:** Accepted.

## Context

The plan's architecture sketch lists Redis as part of the L4 runtime alongside Postgres, the MQTT
broker and Tiled (§2). §4 is more specific about what it's for: "one workcell = one RE Manager +
one RE Worker + its IOC set + **its Redis namespace**", and "the control plane is stateless —
all state is in Postgres, Redis, the MQTT broker's retained messages, or Tiled". `Workcell` even
carries a `redis_namespace` column today, straight from the §5.1 table.

So Redis is unambiguously in the design. The question asked here is only whether anything in the
*current* system needs it, since the obvious candidates get raised whenever a project reaches this
size: cache the read endpoints, back sessions, rate-limit writes.

## Decision

**Don't introduce Redis in this pass.** Revisit it as part of M2, where it has a real job.

Nothing built so far earns it:

- **Caching.** The read endpoints answer from lab-sized tables — one site, a handful of zones, a
  couple of devices, tens to hundreds of samples — with single-table queries and one index per
  natural key. The paging work (`api/pagination.py`) already bounds the largest responses. There
  is no measured latency problem to cache away, and a cache would add an invalidation path to
  every write in `registry.py` for no observed benefit.
- **Sessions.** The auth added in this pass is a stateless shared bearer token
  (`api/auth.py`) — there is no session to store. A real identity system (§12.1) may want one,
  but that decision belongs with the OIDC/RBAC design, not ahead of it.
- **Rate limiting.** Worth having on a public deployment; there isn't one, and a single-process
  in-memory limiter would do until there is.
- **Background jobs / queues.** None exist. The one long-running thing the plan describes — the
  RunEngine queue — is queueserver's own Redis, not ours to invent.

Against that: §G8 wants "a single-cell lab to run from one `docker compose up` with defaults", and
the local path today needs no external services at all (`db.py` falls back to sqlite). Adding a
Redis container that only serves a cache nobody needs makes the on-ramp worse in exchange for
nothing.

## When it comes back

M2, the device plane, is where it stops being speculative — it's the milestone that introduces
state that genuinely isn't Postgres-shaped:

- **Queueserver state per workcell.** `bluesky-queueserver` uses Redis itself; `Workcell.
  queueserver_endpoint` and `Workcell.redis_namespace` already exist to point at it. This is the
  concrete thing the plan means, and it arrives with the RE Manager, not before.
- **Live device state.** §9's MQTT state tree and the "single highest-leverage integration"
  introspection service (§9.2) produce fast-moving, disposable state that has no business in a
  revisioned registry.
- **Fan-out to connected consoles.** Once the frontend shows live state rather than registry
  records, pub/sub between API replicas becomes a real requirement rather than an imagined one.

## Consequences

- The dependency list stays: Postgres (or sqlite), and nothing else. `docker compose up` and
  `pip install -e .` both stay short.
- `Workcell.redis_namespace` keeps carrying a value nothing reads yet. That's correct — it's
  registry *configuration for* the execution layer, and the whole point of the registry is to
  describe a lab the execution layer hasn't been built for yet.
- If a read endpoint ever does get slow, the first move is an index or a query fix, and the second
  is measuring — not a cache. Caches added before a measurement tend to hide the actual problem.
- This is a "not yet", not a "no". Nothing here argues against Redis in the architecture; it
  argues against standing up a service whose only current user would be code written to justify it.
