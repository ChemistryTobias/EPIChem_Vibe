# ADR 0003: Scope defaults for the remaining M0 questions

**Answers plan §17 Q1, Q3, Q4, Q5, Q7, Q8, Q9, Q10.**

**Status:** Accepted (defaults — several explicitly revisitable, see below)

## Context

§17 lists ten decisions blocking downstream work. ADR 0001 and ADR 0002 cover
the two with real architectural weight (reconciler shape, NetBox). The
remaining eight are recorded here as pragmatic defaults so implementation can
proceed, per §14's own instruction that M0 exit criteria are "closed **or
explicitly deferred with an owner**."

## Decisions

**Q1 — JointJS+ or `@joint/core`-only?**
Deferred, not decided: no frontend work happens in this implementation pass
(see PROJECT_MILESTONES.md — M1 here is backend registry only). When frontend
work starts, the plan's own recommendation (§10.2: `@joint/core` only, React
palette/inspector) is the default to build against, because it's the only
option compatible with the binding "MUST be open source, end to end"
condition (plan header). Revisit only if that license condition is relaxed.

*Update (frontend pass, 2026-08-06).* A frontend now exists (`frontend/`) but
this question is still open, because nothing built so far needs a canvas: the
Topology screen is a tree, not the isometric view. Two things were settled
around it, though, and neither requires answering Q1:

- **The procedure/workflow editor (M3) will use React Flow (MIT), not
  JointJS.** §10.2 already lists this as the sanctioned alternative for the
  procedure DAG specifically. It sidesteps Q1 entirely for that canvas.
  Nothing is built yet — there is no procedure IR or backend to build
  against — so this is a recorded decision, not an implementation.
- **A free-tier isometric implementation already exists, as a reference.**
  Worth knowing before anyone assumes the isometric view needs a JointJS+
  license: the approved standalone HTML prototype in `project_plan/` renders
  its isometric floor plan using **only `@joint/core` (MPL-2.0) APIs** —
  `joint.dia.Graph`, `joint.dia.Paper`, `joint.dia.Element.define` and
  `joint.shapes.standard.Link`. The diamond tiles are hand-built polygons
  (`body/points`), not the commercial `isometric-diagram` demo, and no
  Stencil/Inspector/Halo/Toolbar/Navigator/Selection component appears
  anywhere in it. So the `@joint/core`-only path §10.2 recommends is already
  demonstrated to work for this view. (The prototype is a bundled artifact
  file; the logic lives in its embedded `x-dc` script block, not in this
  repo's git history — `git log` here starts at the plan itself.)

**Q3 — ELN target: Chemotion, Kadi4Mat, or both?**
Deferred — out of scope until M4 (samples & provenance). No adapter is
implemented in M1; the `Run`/provenance push design in §7.6 stays a design
note until an institutional decision is made. Owner: the author, before M4
starts.

**Q4 — Workcell granularity.**
Decided: a workcell is **a robot-served island** (§4's own definition — "one
workcell = one RE Manager + one RE Worker + its IOC set"), not a room or a
logical group. This is really already decided by §4's architectural
commitment, not an open question; Q4 in §17 is asking the *scheduler* to
confirm it, which it does by scoping reservations to a workcell's device set.

**Q5 — EPICS-only, or EPICS + Tango + direct-REST from day one?**
Decided: EPICS-only (`ca://`) for M1–M2. The `Device.spec.transport.protocol`
field is an open string (not an enum locked to `epics-ca`) so Tango/REST/SiLA2
support is additive later, but only `epics-ca` and `sim` are exercised by
tests and examples now. Rationale: §15 risk table calls tripling the
integration matrix a Medium risk; §16 prior art take on ophyd-async is "take
the abstraction, leave nothing out" but that doesn't mean exercise all three
transports before the first device works end to end.

**Q7 — How much xDL?**
Decided: none in M1–M3. The IR node schema (M3, not yet built) should reserve
an optional `ontology_iri` and `xdl_mapping` field per node per §9.5, but no
xDL import/export/compiler exists yet. Revisit at M3 when the IR is designed.

**Q8 — Manual steps in v1 or v2?**
Decided: **v1**, per the plan's own recommendation ("a system that can't
express a human step won't be used in a real lab"). Not yet implemented
(manual steps are a procedure-designer/M3 concept) — recorded here so M3
doesn't re-litigate it.

**Q9 — Multi-tenancy: one deployment per group, or one per institute with
tenant isolation?**
Decided: **one deployment per group** for now (no tenant isolation in the
schema). Simpler auth model, matches G8's single-cell on-ramp. The schema
avoids anything that would *block* adding tenant isolation later (no global
singletons, IDs are UUIDv7 not auto-increment, per §6.5's federation caution),
but no `tenant_id` column exists yet. Revisit if/when a second institute
group asks to share one deployment.

**Q10 — Where does calibration data live?**
Decided: **EPIChem**, as operational metadata on the `Device` model
(`operational.calibration: {last, due, certificate}` per the §6.1 descriptor
example) — a pointer (`certificate: kadi:record/...`) to the ELN/instrument
record if one exists, not the calibration document itself. This matches the
plan's own general pattern (§3: EPIChem holds the operational record, links
to the scientific one by PID) and needs no further adapter to implement now.

## Consequences

Q1 and Q3 remain genuinely open and are called out again in
PROJECT_MILESTONES.md so they aren't silently forgotten. The rest are
implemented as stated above; changing any of them later is a schema or
architecture change, not a config flag, so treat them as real decisions, not
placeholders.
