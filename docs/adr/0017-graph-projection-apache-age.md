# ADR 0017: A derived graph projection (Apache AGE) for relationship-heavy reads — Postgres stays authoritative

**Part of the graph/multi-user proposal package — see `docs/GRAPH_AND_MULTIUSER_PROPOSAL.md` for the
full picture and how this ADR relates to ADR 0018 and ADR 0019.**

**Status:** Proposed — awaiting decision; nothing here is built.

## Context

The project owner asked for "a GQL implementation" to describe the Site→Zone→Station→Device→Sample→
Procedure relations. GQL (ISO/IEC 39075:2024) is a graph-*database* query language (the Cypher-family
successor standard, as implemented by Neo4j/Memgraph/Apache AGE) — a different thing from GraphQL
(Facebook's API query language, which can sit over any backend including the existing relational
registry). Confirmed directly with the project owner: they mean a real graph database, not a GraphQL
API layer.

The domain is already graph-shaped in several places:

- The containment tree itself (`Site → Lab → Zone/Station → Device`, recursive `Module`/`Device` via
  `parent_id`).
- Zone membership (ADR 0015/0016) — geometric containment, computed, not a stored FK.
- `CapabilityClass.extends` — a class-inheritance graph.
- Sample lineage (§7.4, `DerivationEdge`, explicitly PROV-O) — not built yet (M4).
- The Procedure IR's `StepNode` graph with flow + material ports (§9, §10.4) — not built yet (M3).

Today's API is deliberately flat: every `*Out` schema has no nested children, and the frontend's
`fetchTopology()` issues five parallel `GET`s and reconstructs the tree client-side in
`topologyTree.ts`. That's a reasonable shape for a handful of endpoints but gets worse as more
graph-shaped kinds (lineage, procedure DAGs) arrive.

Two decisions already on the books constrain this:

- **ADR 0004**: Postgres is the source of truth for topology/device/capability-class, with every
  write versioned via one shared `Revision` table carrying a **full JSON snapshot** per write. Don't
  refight "what's authoritative" — that question was already litigated for git-vs-DB and settled.
- **ADR 0006**: don't add infrastructure ahead of a measured need; keep the `docker compose up` /
  sqlite-fallback on-ramp dependency-free. A second, separately-run graph database service would
  need to clear that bar.

## Decision

1. **Don't stand up a second database service.** Use **Apache AGE**, a Postgres extension providing
   an openCypher/GQL-family graph query layer inside the *same* Postgres instance already required in
   production. No new service to run, back up, or keep in sync. Local sqlite dev simply has no graph
   queries available (AGE requires Postgres) — the existing per-kind REST endpoints remain the
   fallback there, so this never blocks the zero-dependency local on-ramp ADR 0006 protects.

2. **Postgres relational tables + the `Revision` table remain the sole source of truth.** The graph
   is a **read-optimized derived projection**, never written to directly by any router, the CLI, or
   the importer.

3. **Projection hooks into the one existing write choke point.** `registry.py`'s
   `create_entity`/`update_entity`/`delete_entity` already sit between *every* entity kind's writes
   (topology, devices, capability classes, and Samples — Sample extends `RegistryEntity` and goes
   through the same functions per ADR 0005) and the DB. A small `graph_projector.py` translates each
   `Revision`'s snapshot into an AGE `MERGE`/`SET`/`DETACH DELETE` call, in the same transaction (AGE
   lives in the same Postgres connection) — the graph can never drift out of sync with the tables it's
   derived from, and a rollback rolls back both together. This mirrors the existing convention of one
   shared write path rather than a second copy per router (see `importer.py`'s docstring).

4. **The graph is always rebuildable.** Because every `Revision` snapshot is a full entity dump,
   replaying the table in order regenerates the graph from scratch — `epichem graph rebuild`, useful
   for bootstrapping AGE on an existing deployment or after a projection schema change.

5. **v1 node/edge vocabulary** (see the cover doc for the diagram): one node label per
   `RegistryEntity` kind (`Site`, `Lab`, `Zone`, `Station`, `Device`, `CapabilityClass`, `Sample`);
   `CONTAINS` edges for the containment tree; `IN_ZONE` edges recomputed at the same trigger points
   the existing geometric-membership computation already uses (ADR 0015/0016); `DECLARES` edges
   Device→CapabilityClass; `EXTENDS` edges for capability-class inheritance. Sample lineage
   (`DERIVED_FROM`) and the Procedure step graph are deliberately **not** modeled yet — this ADR
   doesn't invent schema ahead of the entities that will carry it; extend the projector when M3/M4
   build those kinds.

6. **API surface is a follow-up implementation decision, not fixed here.** Candidates: purpose-built
   endpoints that use AGE internally (`GET /api/v1/sites/{id}/hierarchy` returning the whole subtree
   in one call; `GET /api/v1/devices?capability=&accessible_to=` for ACL-aware capability search —
   see ADR 0019), or a narrow server-validated allowlist of Cypher templates. Not raw user-supplied
   Cypher — that's a straightforward injection-shaped hole.

## Consequences

- **Gains:** single-query hierarchy fetch (would let the frontend retire `fetchTopology()`'s five
  calls and `topologyTree.ts`'s client-side reconstruction — a separate frontend change, not mandated
  by this ADR alone); a natural mechanism for ADR 0019's "walk up to nearest ancestor grant"
  permission resolution (an upward graph traversal instead of N relational ancestor lookups); a ready
  home for M3/M4's DAG-shaped data when those milestones start.
- **Costs:** one more Postgres extension to install and migrate (via Alembic, like any other
  migration); a second query language (Cypher/GQL) alongside SQLAlchemy for contributors to learn;
  projector code that must be extended for every new entity kind — mitigated by hooking the one
  shared `registry.py` choke point rather than per-router logic.
- **Explicitly not decided here:** whether to eventually replace AGE with a standalone graph database
  if traversal workload outgrows a Postgres extension. Revisit only with a measured need, per ADR
  0006's own precedent — don't pre-solve it.

## Alternatives considered

- **Standalone graph database (Neo4j/Memgraph).** More mature tooling and better traversal
  performance at real scale, but a second stateful service to operate — conflicts with ADR 0006's
  "don't add infra ahead of measured need" and the single-`docker compose` on-ramp. Revisit if AGE's
  performance genuinely becomes the bottleneck.
- **A GraphQL API layer instead of a graph database.** Solves "N REST calls to reconstruct a tree"
  without touching storage at all (a resolver layer over the existing ORM). Not what was asked for
  here (confirmed directly), but worth remembering as a smaller, lower-risk option if AGE ever turns
  out to be more machinery than the actual read patterns need.
