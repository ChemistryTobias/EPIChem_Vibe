# ADR 0018: Per-device IOC pods, Station-level RunEngine, and §11's Scheduler as the cross-plan decision-maker

**Answers plan §17 Q4's deliberately-left-open "cross-station scheduling scope" and ADR 0007's
"Execution unit" open point. Part of the graph/multi-user proposal package — see
`docs/GRAPH_AND_MULTIUSER_PROPOSAL.md`.**

**Status:** Proposed — awaiting decision; nothing here is built.

## Context

The project owner wants each device backed by an Ophyd device (with Bluesky plans for its specific
actions) running in its own pod/container, and raised — without yet deciding — where decisions like
scheduling, prioritization, and "waiting for information" should live: "either a super bluesky driver
should do [this] or this EPIChem orchestrator itself, because it just manages different plans. Those
plans should adhere to some contract for device abstractions."

This sits close to two binding constraints:

- **§3 Non-Goals**: "Execute plans / drive the acquisition loop" is delegated to the Bluesky
  RunEngine; EPIChem must not grow a second execution engine.
- **ADR 0004**: a git-clone-is-desired-state model for the registry was tried and explicitly
  reversed — the database, not git, is authoritative, and there is no reconciler.

On close reading, the owner's actual model doesn't require violating either: they're asking about
*deployment granularity* (one pod per device) plus a *scheduling layer* — and the plan already
specifies most of both, just not phrased in pod terms:

- **§6.5** step 4 already says "Deploy: IOC container to the cell's IOC host" — IOCs are already
  meant to be containers; today's wording ties them to one host shared per cell rather than being
  explicit about one container per device.
- **§4** (quoted in ADR 0006) already fixes RunEngine granularity: "one workcell (Station) = one RE
  Manager + one RE Worker + its IOC set + its Redis namespace." An Ophyd `Device` is a network client
  (EPICS CA/PVA, Tango, REST, SiLA2, ...) — a Station's single RunEngine process holds proxies to
  devices regardless of which pod their IOC actually runs in. Per-device IOC pods and a per-Station
  RunEngine are different layers (hardware I/O vs. orchestration of one plan), not competing answers
  to the same question.
- **§6.3** ("Capability classes and behavioural contracts" — the interface a device promises,
  decoupled from its vendor, RFC 2119 contract keywords, `actions: {plan, params, contract}`) is
  already the "contract for device abstractions" being asked for, and already exists in the schema
  (`CapabilityClass.actions`). It needs fuller population as devices are onboarded, not reinvention.
- **§11 Scheduler** is already scoped as exactly the cross-plan decision-maker described: "deciding
  which procedure runs on which cell... and when; reserving devices, labware, consumables; preventing
  deadlock... duration learning... priority [handling]." It is explicitly out of scope for
  step-by-step execution within a run (that's the RunEngine). It just hasn't been built yet (M5).

## Decision

1. **Containerize for I/O at the device (or tightly-coupled device-group) level, not per-Station.**
   Each `Device` — or a small set of devices that must share one IOC process (e.g. a multi-channel
   controller) — gets its own IOC container. `Device Descriptor`'s `spec.transport.ioc_host` becomes
   a pod reference rather than a shared physical hostname. This refines §6.5 step 4; it doesn't
   reverse it, and the descriptor schema already carries the field.

2. **Keep the RunEngine/queueserver at Station granularity**, per §4 / ADR 0006 / ADR 0007: one
   Station = one RE Manager + one RE Worker holding Ophyd proxies to that Station's devices (wherever
   their IOC pods run) + its own Redis namespace. A Station's queueserver executes one plan at a time
   from its own queue — unchanged. This is what "how a plan executes" (§3 Non-Goals) already
   delegates to Bluesky, and it's why a plan spanning several devices on one Station (e.g. "heat while
   stirring while monitoring pressure") stays a single in-process RunEngine concern, not a
   distributed-transaction problem across device pods.

3. **Cross-station / cross-plan decisions belong to §11's Scheduler — which *is* EPIChem, not a
   second "super bluesky driver."** Scheduling, prioritization, resource reservation across stations,
   and "waiting for information" (a step blocking on another station's output, or on a sample reaching
   a state) are already in §11's scope: reserve-all-or-none resource holds, a wait-for graph for
   deadlock avoidance, a priority ordinal scale. This ADR doesn't redesign §11 — it confirms device
   pods plug into it unchanged: the Scheduler dispatches published Procedure runs to the right
   Station's queue; it never reaches into a Station's RunEngine mid-plan. This is the same boundary
   the plan's own thesis (§1) already draws: EPIChem decides *what/where/to which sample/whether
   allowed*; Bluesky decides *how*.

4. **The contract boundary is `CapabilityClass`** (§6.3, already in the schema). Every device pod —
   whatever is actually inside it, real hardware, a simulator, or a future different implementation —
   must declare its capabilities through the same `actions: {plan, params, contract}` vocabulary. A
   pod is swappable/clonable precisely because the rest of the system depends on the contract, not the
   implementation.

5. **Git's role stays exactly what ADR 0004 already decided.** A device pod's *source* (ophyd class,
   IOC Dockerfile, Device Descriptor YAML) can absolutely live in a git repo and serve as a
   clone-and-fill-in onboarding template — §6.5 steps 1–2 already describe git commits for this. But
   the running registry entry is created through the existing import/API path into Postgres, versioned
   like everything else. Git is a template/source location, not a live desired-state sync target — no
   pod is "reconciled from git" the way ADR 0001's model was rejected.

6. **Explicit non-goal, restated:** this ADR does not create a second execution engine. If
   cross-station coordination ever needs step-*level* intervention inside a running plan (not just
   "which plan runs when"), that's out of scope and escalates per §3's own rule: "if an implementation
   begins to grow one of these, stop and escalate."

## Consequences

- No schema change is strictly required by this ADR alone — the Device Descriptor's
  `transport`/`location` fields already support a per-device IOC reference. This is primarily a
  deployment-topology and scheduler-scope clarification, not a data-model change.
- §11 Scheduler moves from "M5, not started, no design gap" to "the confirmed answer" for cross-plan
  orchestration — which may argue for pulling pieces of its design forward, but building it is still
  properly M5-scoped work; this ADR only fixes *where* the responsibility lives.
- "Waiting for information" spanning a long human/analytical timescale (e.g. an off-site NMR result
  arriving days later) is a Procedure IR / `ManualStep`-and-resume concern (§9.4, §11's resource
  reservation), not new scheduler semantics invented here — flagged for the eventual M3/M5 ADRs, not
  resolved by this one.

## Alternatives considered

- **Pod-per-device *is* the execution unit** (each device pod runs its own RunEngine). Rejected: the
  RunEngine coordinates multiple devices within a single plan; splitting it per device would turn an
  ordinary multi-device plan into a distributed-transaction problem the plan never asks for, and would
  duplicate what a Station-level RunEngine already does for free over EPICS/Tango/REST.
