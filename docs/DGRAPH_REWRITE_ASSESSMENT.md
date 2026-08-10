# Dgraph rewrite — a critical assessment: should this happen at all?

**Status: critical assessment, not a proposal to adopt.** This document does the thing that was
asked: take the earlier graph proposal ([`GRAPH_AND_MULTIUSER_PROPOSAL.md`](GRAPH_AND_MULTIUSER_PROPOSAL.md)
+ ADRs 0017–0019), swap the intended engine for **[Dgraph](https://docs.dgraph.io/)**, and examine
*critically* whether it works — including the parts where a graph database is the wrong tool. It ends
with a recommendation, because "should we do this" deserves an answer, not a menu.

**Bottom line up front:** A rewrite of the backend onto Dgraph does **not** make sense at the
project's current stage, and Dgraph specifically is a worse fit than the in-Postgres graph option
already sketched in ADR 0017. A graph *query capability* is genuinely useful for a handful of
relationship-shaped reads; a graph *database as a second system of record* is not justified by
anything built or measured today, and adopting one now would re-open two decisions
(ADR 0004, ADR 0006) that were settled deliberately. The defensible version is small, additive, and
deferred — details in §6–§7. If the graph engine is wanted anyway, the phased plan in §7 is how to do
it without betting the registry on it.

---

## 1. First, a correction to my own earlier proposal

The previous proposal recommended **Apache AGE** — a graph query layer *inside the same Postgres
instance*. Its entire safety argument was: the graph projection lives in the same transaction as the
relational write, so it **cannot drift** and a rollback undoes both. Swapping in Dgraph deletes that
argument, because Dgraph is a separate database. That's not a small substitution — it changes the risk
profile of the whole idea. So this isn't "same plan, different logo"; the critique below is mostly
*about* that change.

Two things in the earlier proposal that still hold and aren't Dgraph-dependent, so they survive this
reassessment regardless of the engine decision:

- The **optimistic-concurrency gap** (§8.1 promises `ETag`/`If-Match`; it isn't built; it becomes
  load-bearing the moment ADR 0019's ACL lets two principals write the same scope). Real, unrelated to
  graphs, worth fixing on its own.
- The **storage-tier framework** (browser vs. Redis vs. Postgres vs. graph). Still correct; the graph
  row in that table just gets much harder to justify with Dgraph than with AGE, per below.

One thing I'll now flag as **overstated** in the earlier ADR 0017: it presented the graph projection
as close to free ("hooks into the one existing write choke point"). That's true for AGE (same
connection, same transaction). It is *not* true for Dgraph, where "hook into the write path" means
"introduce a distributed dual-write," which is one of the classic hard problems in data engineering.
The earlier framing doesn't survive the engine swap.

## 2. What Dgraph actually is (and why the "GQL" framing gets muddier, not clearer)

Facts, from the [docs](https://docs.dgraph.io/) and [architecture reference](https://docs.dgraph.io/installation/dgraph-architecture/):

- A **standalone, distributed** graph database written in Go, storing data in BadgerDB. A cluster is
  **Dgraph Zero** nodes (group 0 — cluster management, predicate rebalancing) plus one or more
  **Dgraph Alpha** groups (the data). Each group is a Raft consensus group. It **shards by
  predicate**, which matters only near ~1 TB — nowhere near this project's scale.
- **HA is not lightweight.** A highly-available deployment is **3 Zeros + 3 Alphas** (replicas=3),
  run as Kubernetes StatefulSets with persistent volumes. Even non-HA is a multi-process cluster, not
  a library you link.
- **ACID transactions — but only inside Dgraph.** It has no notion of a shared transaction with
  Postgres. Any consistency between the two is *your* code's problem.
- **Query languages: DQL and a GraphQL API.** Note carefully: **neither is ISO/IEC 39075 GQL.** DQL is
  Dgraph's own language (historically "GraphQL+−"); the GraphQL API is Facebook-lineage GraphQL. So
  adopting Dgraph does **not** get you "a GQL implementation" in the standards sense the original ask
  used. If proximity to the ISO GQL / Cypher family is the actual goal, Apache AGE (openCypher) is
  *closer* to it than Dgraph is. This is a genuine mismatch worth surfacing before any commitment.
- **License:** Apache 2.0 (relicensed, and as of the v25 line all features under it). Ownership moved
  Hypermode → Istari Digital (Oct 2025), with stated priority on the open-source/self-hosted
  community. So licensing is *not* an obstacle — this isn't the JointJS+ situation.

The disqualifying property for a *rewrite* isn't any of these individually — it's that Dgraph is a
**second stateful distributed system**, and the current design's whole on-ramp story (ADR 0006, §G8)
is "one `docker compose up`, sqlite fallback, zero external services for a single-cell lab."

## 3. The core problem a Dgraph rewrite creates: two systems of record

Everything downstream flows from one question: **is Dgraph authoritative, or derived?**

**Option A — Dgraph as source of truth (a real "rewrite").**
This is what "rewrite the backend" most naturally means. It directly contradicts **ADR 0004**, which
made Postgres authoritative *by explicit user direction overriding the plan*, and which the whole
`Revision` audit-trail design (ADR 0004 §2) is built on. It would mean re-implementing, in Dgraph:
the full-snapshot revision history, the natural-key uniqueness guarantees, the referential-integrity
behaviours (the 409-on-delete-with-children that `db.py`'s FK enforcement gives for free), and the
Alembic migration story. Dgraph has ACID transactions but a *different* consistency and schema model;
none of `registry.py`, `importer.py`, the routers, or the Alembic history transfers. This is not a
port; it's a reconstruction of the registry's guarantees on a substrate that doesn't natively provide
several of them. **Recommendation: reject this outright.** It reopens a settled decision to gain a
query convenience, and trades a mature, understood storage layer for one the team would be learning
under production.

**Option B — Dgraph as a derived projection (what ADR 0017 intended, now cross-process).**
Postgres stays authoritative; Dgraph mirrors it for graph reads. Safer in principle, but the "same
transaction, can't drift" guarantee is *gone* because the two are different systems. You now must
choose a sync mechanism, and every choice has a real cost:

| Sync mechanism | What it is | The catch |
|---|---|---|
| **Dual-write** | `registry.py` writes Postgres, then writes Dgraph | Two systems, no shared transaction → partial failure leaves them inconsistent. The drift ADR 0017 claimed to have eliminated comes back in full. |
| **Outbox + worker** | Writes append to a Postgres "outbox" table in the same tx; a worker drains it into Dgraph | Correct and standard, but it's a *new asynchronous subsystem* — a worker to run, monitor, and recover; eventual (not immediate) consistency between tables and graph; a backlog to reason about. |
| **Rebuild-from-Revision** | Periodically/ on-demand replay the `Revision` log into Dgraph | Fine for bootstrap and disaster recovery (the `Revision` full-snapshot design genuinely makes this clean), useless as the *primary* freshness mechanism. |

The honest read: **with Dgraph, even the "safe" derived-projection option costs an outbox pipeline
and eventual consistency.** With AGE, that same option cost ~nothing (same transaction). The engine
swap is precisely what turns a cheap idea into an expensive one.

## 4. Where a graph database does **not** make sense here (the critical list)

This is the part explicitly asked for. For each, the point is not "graphs are bad" but "this workload
is not graph-shaped, and moving it gains nothing while losing what Postgres already gives."

1. **Registry CRUD (Site…Sample).** Single-entity create/read/update/delete by natural key. This is a
   keyed row lookup — an index hit in Postgres. A graph engine adds latency and a second language for
   zero benefit. `registry.py`'s generic create/update/delete is *already* the clean abstraction here.
2. **The `Revision` audit log.** Append-only, queried as "history of one entity, ordered." A flat
   indexed table is the ideal shape; ADR 0004 chose it deliberately over per-model tables. Modelling
   immutable snapshots as graph nodes buys nothing.
3. **Geometric zone membership (ADR 0015/0016).** Membership is *computed from rectangle containment*
   (`rectContainsBox`), not a stored relationship. A graph stores edges; it does not compute
   "is this box inside that rectangle" — that's arithmetic, and it already lives correctly in the
   layout code. An `IN_ZONE` edge in a graph would be a *cache of a computation*, needing the same
   recompute triggers whether or not a graph exists.
4. **Layout geometry (positions, sizes, floors, grid).** Numeric attributes on entities. Graphs are
   indifferent to them; they're just columns. No traversal touches them.
5. **Sample operational data (ADR 0005).** Flat JSON-body rows, filtered by `state`/`owner`/substring
   search. That's a relational query with indexes. The *future* lineage DAG (§7.4) is graph-shaped —
   but that entity doesn't exist yet (M4), so building graph infrastructure for it now is speculative.
6. **Anything at current data scale.** ADR 0006 already made this argument for caching and it applies
   verbatim here: lab-sized tables (one site, a handful of zones, tens–hundreds of samples).
   Postgres **recursive CTEs** handle the containment tree and ancestor walks at this scale without
   measurable latency. A distributed graph cluster is engineered for the ~TB regime this project is
   several orders of magnitude below.
7. **Transactional, multi-entity writes.** The staged layout Save (ADR 0014) replays many operations
   as one logical commit. Postgres gives one transaction. Splitting authority across Postgres+Dgraph
   turns this into a two-system coordination problem.
8. **The single-cell on-ramp (§G8, ADR 0006).** sqlite has no Dgraph equivalent. Introducing Dgraph
   either breaks "runs from one `docker compose up`" or forces a second code path (graph features off
   locally, on in prod) — a divergence that reliably rots.

## 5. Where a graph query capability *would* genuinely help

To be fair to the idea — these are real, and they're why "some graph capability, eventually" is
defensible even though "rewrite onto Dgraph now" isn't:

- **ACL ancestor resolution (ADR 0019).** "Nearest grant walking up Site→…→Device" is a natural
  upward traversal. *But* it's also a bounded recursive CTE (max depth ~5), so Postgres does it fine
  until proven slow.
- **Sample lineage (§7.4, PROV-O).** A genuine DAG with variable-depth ancestry queries
  (`/samples/{id}/lineage?depth=`). This is the strongest graph case — and it's **M4**, unbuilt.
- **Procedure IR validation (§9.3 tier 3).** "Connected DAG, no orphan steps, no resource cycle" is
  graph analysis. Also unbuilt (**M3**), and arguably done in-memory on the IR at compile time, not in
  a database at all.
- **Multi-hop "reachability" reads.** "Every device with capability X reachable from sample Y's
  location" — real, but again depends on lineage/transport-route data that doesn't exist yet.

The pattern is stark: **every strong graph use case is either handled adequately by a recursive CTE at
this scale, or belongs to a milestone (M3/M4) that hasn't started.** None of them is a
*currently-built* workload crying out for a graph engine.

## 6. Verdict — does it even make sense?

**No, not as a rewrite, and not with Dgraph, at this stage.** Concretely:

- **A rewrite onto Dgraph-as-source-of-truth: reject.** Contradicts ADR 0004, discards mature registry
  guarantees, and — because Dgraph is DQL/GraphQL, not ISO GQL — doesn't even deliver the standards-
  "GQL" the original ask implied.
- **Dgraph as a derived projection: not now.** It's the safer shape, but the engine swap from AGE
  reintroduces cross-system drift and forces an outbox pipeline + eventual consistency + a 3+3 cluster
  operational burden — all to accelerate reads that aren't slow, over data that isn't big, for
  DAG entities that aren't built. This is exactly the "standing up a service whose only current user
  is code written to justify it" that ADR 0006 declined.
- **If a graph query layer is wanted anyway: prefer Apache AGE over Dgraph** — same Postgres, same
  transaction, no drift, openCypher (closer to the GQL/Cypher family), and it evaporates the entire §3
  two-systems problem. Dgraph only starts to win at a scale (~TB, high write throughput, horizontal
  sharding) this project is nowhere near and has no roadmap toward.
- **The honest smallest useful step** that delivers the *value* behind the request — "see the whole
  Site→Device relationship in one query instead of five" — is **not a graph database at all**. It's
  one endpoint (`GET /sites/{id}/hierarchy`) backed by a recursive CTE, letting the frontend retire
  `fetchTopology()`'s five calls. That captures the daily-felt benefit with zero new infrastructure,
  and leaves the real graph decision for M3/M4 when lineage/procedure DAGs actually exist and can be
  measured.

## 7. If the graph engine is adopted anyway — how to tackle it without betting the registry

Should the decision be to proceed despite §6, do it in the order that keeps the registry safe and
lets you bail cheaply at any step. Never start at the bottom of this list.

1. **Don't move authority. Ever, in v1.** Postgres stays the system of record (ADR 0004 stands).
   Whatever graph engine, it is a *derived read model*. This single rule contains most of the risk.
2. **Prove the read need first, with a CTE.** Build `GET /sites/{id}/hierarchy` and the ACL
   ancestor-walk as recursive CTEs. If those are fast enough (they will be at this scale), stop —
   you've captured the benefit and the graph engine is unnecessary. This step is the actual
   recommendation; the rest is contingency.
3. **If (2) is measurably insufficient, add AGE, not Dgraph.** In-Postgres, same-transaction
   projection off `registry.py`'s write path, rebuildable from the `Revision` log. Re-read ADR 0017 —
   that's this step, and it's already written.
4. **Only if AGE is outgrown (a scale this project has no evidence of approaching) consider Dgraph.**
   And then as a projection fed by a **transactional outbox** drained by a worker — never dual-write —
   with the `Revision` log as the rebuild/DR source of truth. Budget for: the outbox table + worker,
   eventual-consistency semantics surfaced in the API, a 3+3 cluster in prod, a "graph-off" local dev
   path, and a second query language in the codebase. Write the ADR that supersedes ADR 0017 and
   justifies each of those costs against a *measured* need, per ADR 0006's standing rule.
5. **Whatever the engine, keep the graph vocabulary from ADR 0017** (node labels per `RegistryEntity`
   kind; `CONTAINS`/`IN_ZONE`/`DECLARES`/`EXTENDS` edges; lineage/procedure edges deferred to their
   milestones). The model is engine-independent; only the substrate and sync mechanism differ.

## 8. Decisions this document asks for

1. **Accept the verdict (§6)** — defer the graph engine, build the one CTE-backed hierarchy endpoint
   now — or reject it and proceed to a graph engine despite the analysis?
2. If proceeding: **AGE (recommended) or Dgraph?** The choice hinges entirely on whether TB-scale /
   horizontal-sharding is a real near-term need. If it isn't (no evidence it is), AGE dominates.
3. Regardless of the graph decision: **fix the optimistic-concurrency gap (§8.1 `ETag`/`If-Match`)**
   before ADR 0019's multi-writer ACL lands — this one is independent and real.

*Nothing here is built. This is analysis to decide against, not a plan already in motion.*
