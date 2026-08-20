# EPIChem — Roadmap (supersedes §14 milestones)

**Status:** active roadmap, replaces the M0–M6 milestone numbering in
`EPIChem_Project_Plan.md` §14 going forward. `PROJECT_MILESTONES.md` should
be re-pointed at this numbering the next time it's updated — not done as
part of writing this document, to keep this change to the plan only.

This document does **not** replace `EPIChem_Project_Plan.md`. That document
stays the binding spec for architecture, the canonical data model, and the
sections referenced below by number — this roadmap only re-sequences *when*
things get built and folds in decisions made since it was written. Where
this roadmap is silent on a detail, the original plan's section governs.

---

## Binding, carried forward unchanged

**§3 Non-Goals still apply, with one worth restating because it's the
architectural spine of Milestone 1 below:** EPIChem **administers and
dispatches** procedures — it calls the Bluesky RunEngine (via
bluesky-queueserver) to run them. It does not become a second execution
engine, no matter how tempting a "just run it directly" shortcut looks
during Milestone 1.3 or the scheduler work in Milestone 2. Bluesky executes;
EPICS drives the hardware; EPIChem decides *what* runs *where*, *on which
sample*, and *whether it's allowed*.

Also carried forward as cross-cutting concerns, unchanged from the original
plan:
- **§12.1 Access control** — folds into Milestone 0.2's User/Group identity
  work below.
- **§12.2 Safety** — software safety in EPIChem stays *advisory and
  preventative*, never the last line of defense; hardware interlocks are.
- **§12.3 Observability**
- **§12.4 Provenance**

---

## Milestone 0 — Basic functionality

### 0.1 A solid, extendable backend structure
**Status: done.** The vertical-slice rewrite (`backend/app/modules/
device_managment/<entity>/{schema,api,logic}.py`, shared `app/core/`) is in
place and structurally sound — see the audit published this session for the
specific gaps it still has (revisions, auth, Device's real fields, tests),
which is what the rest of 0.x and Milestone 1 close.

### 0.2 File storage, auth, users, groups, revisions
- **File storage** — done (`core/file_storage/`).
- **Auth + Users + Groups** — not started. A reasonable starting shape
  (sketched, not yet built): a `User` (code/name/email, no global role
  field), a `Group` (code/name + membership), and a scope-based
  `AccessGrant` tying a subject (user or group) to a hierarchy node
  (site/lab/zone/station/device, referenced polymorphically like `Revision`
  already does) with a level of `none | read | read_write` — per-scope
  access, not fixed role tiers. Treat this as a starting point to adjust,
  not a locked design.
- **Revisions** — not started, design intentionally still open. The old
  backend's full-snapshot-per-write `Revision` table (ADR 0004) is a
  reasonable reference for scope and mechanism, but the redesign you have in
  mind hasn't been specified yet — this needs a decision before 0.2 can
  close, and Milestone 1.3's "pod version push" and Milestone 2's workflow
  runs will both want to hang off whatever the answer is (a plan revision
  and a run should both be reconstructible after the fact).

### 0.3 A frontend that matches the new backend
**Status: not started**, deliberately sequenced after Milestone 1's device
fields land (see the audit's suggested ordering — rewriting the API layer
before Device/CapabilityClass exist would mean doing it twice). Rewritten
from scratch, not evolved from the old-backend frontend: same modular
vertical-slice instinct as the backend, same visual language (`DESIGN.md` /
`tokens.css` — unchanged, no need to redesign), but a cleaner structural
match to the new backend than the current frontend's `api/` layer, which is
still shaped around the old envelope/PUT API. Shared `ConfirmDialog` and a
`useApiAction` hook (both proposed in the audit) go in from the start
instead of being retrofitted later.

---

## Milestone 1 — Device management

### 1.1 Rough lab-layout and device-hierarchy structure in the backend
**Status: done.** `Site → Lab → Station → Module/Device` with optional zoning for lab and station. Geometry and collision-free default placement. What it's still missing
— CapabilityClass, and Device's actual descriptor fields — is 1.3's job, not
1.1's; 1.1 was containment and geometry, not device-ness.

### 1.2 A solid lab-layout frontend
**Status: not started against the new backend.** The old frontend's
isometric editor (`@joint/core`, staged-draft editing, drill-down breadcrumb
— ADRs 0009–0016) is a proven UX; the fastest path is porting its geometry
layer (`isometric.ts`, `levels.ts`) onto the new backend's flat-body/PATCH
API as part of 0.3's rewrite. A Three.js replacement (orthographic camera +
raycast drag, sketched in the audit) is a real option worth prototyping but
is not a blocker for 1.2 — 1.2 can ship on the existing JointJS approach and
move to Three.js later without changing `levels.ts`'s contract.

### 1.3 Devices and stations as deployable, updatable pods
**Status: not started — this is new scope, not in the original plan.**

Each Station's control stack — its IOC set, its ophyd `Device` tree, and its
own bluesky-queueserver (§4's L1–L3, unchanged) — is packaged and deployed
as one versioned, git-tracked unit ("pod"). EPIChem holds the descriptor and
a pointer to the pod's repo/version; it can trigger a redeploy when a new
version is pushed, and it talks to the pod's queueserver over HTTP to
dispatch and observe plans — **it still never executes anything itself**,
per the Non-Goals restated above. This is a packaging/deployment mechanism
layered on top of the existing L1–L3 model, not a new execution model.

**A second, local path, alongside the git-pod mechanism:** a `pip install
epichem-runner` package that takes a YAML device descriptor and spins up a
single device locally on the network, for testing a new instrument without
first setting up a dedicated git repo. This is meant as the fast
onboarding/prototyping path — a device proven out this way should be able to graduates into a
proper git-tracked pod when it's ready for production use (should be also be an option for easier onboarding as a parallel deployment mechanism).

This is also where the audit's device-management gap gets closed: `Device`
needs `CapabilityClass`, `ophyd_import`/`ophyd_args`, `transport_*`,
`network_*`, `capabilities`, `envelope`, `safety_*`, `operational_mode` —
the fields a pod's descriptor actually needs to be introspectable per §6.1
and §9.2 (`plans_allowed`/`devices_allowed`). Do this before 2.2's node
palette, which is generated directly from that introspection.

---

## Milestone 2 — Workflow design

### 2.1 Composing devices' Bluesky plans into a procedure
Each device (via its pod, per 1.3) exposes Bluesky plans as linear,
parameterized action calls. 2.1 is putting a sequence of these together into
a whole experimental procedure. Start with §9.1's fast path — a plain
ordered list of queue items, no control flow — and defer §9.4's
branch/loop/codegen tier until a real procedure actually needs it; building
that before anything requires it is premature.

### 2.2 A node-based frontend for building procedures
React Flow (MIT — already decided, ADR 0003 Q1), not JointJS. The palette
and every parameter form are **generated** from `plans_allowed`/
`devices_allowed` introspection against the current lab's actual pods
(§9.2 — "the single highest-leverage integration in the project"), not
hand-maintained, so a scientist only ever sees plans/devices that really
exist and that they're allowed to use. Validation follows §9.3's tiers
(schema/type, capability contract, graph/resource, safety) surfaced as
diagnostics on the canvas before submission.

**Scheduler, folded in here rather than as its own milestone:** administering
and dispatching these workflows — calling the queueserver API on a
workflow's behalf, tracking what's queued/running per station, handling
retries/reordering — is scheduler work (§11 is the reference for scope and
mechanism). It isn't a separate top-level milestone because it has no
purpose independent of 2.x's workflows and Milestone 3's sample-triggered
runs; build it as the dispatch layer underneath both rather than in
isolation.

---

## Milestone 3 — Sample tracking

**Status: not started, deliberately minimal to start.** The concrete goal:
every workflow run automatically creates a `Sample` linked to that run and
its parameters — flat fields, ADR-0005-style, no composition list, no
containers, no lineage graph yet, matching where the old backend's minimal
Sample model already was. This is intentionally the smallest thing that
makes the Samples screen mean something once workflows exist to trigger it.

**§7's full model remains the eventual target, not abandoned**:
Substance/Batch/Container/Labware/Slot, `pint`-unit composition, the
`SampleEvent` lifecycle/custody log, a PROV-O lineage DAG, DataMatrix
physical marking, and ELN federation. None of that is designed further
here — it's sequenced *after* the minimal, run-linked version above proves
out, per your own "I don't know how to implement this yet."

---

## Sequencing notes

- 0.1 is done; 0.2 and 0.3 are the two remaining items before Milestone 1
  can be considered structurally complete, but 0.2's auth/users piece and
  1.1–1.3 have no ordering dependency on each other and can run in parallel.
- 0.3 (frontend rewrite) should follow 1.3's device fields landing, per the
  audit — one API-layer rewrite instead of two.
- 2.1/2.2 depend on 1.3's introspectable device descriptors existing; there
  is nothing for the node palette to generate from before that.
- 3 depends on 2.x producing actual workflow runs to link samples to.
