# ADR 0000: ADR process

**Status:** Accepted

## Context

`EPIChem_Project_Plan.md` §17 lists ten open questions that must be decided at
M0 before downstream work (§14). The plan also mandates (§15 Risks) that any
proposed violation of §3 Non-Goals "requires a written ADR", and §12.6 requires
"documentation-first; ADRs; no undocumented tribal configuration".

## Decision

Each ADR is one file, numbered sequentially, in `docs/adr/`. Format:
Status / Context / Decision / Consequences. An ADR is never edited to reverse
a decision — a later ADR supersedes it and says so explicitly, so the log stays
an honest history of what was decided when.

The ten §17 questions are answered in ADRs 0001–0004 below. Not all ten get a
full implementation-grade decision in M0 — some are genuinely blocked on
information this session doesn't have (asking FHI IT, choosing an
institutional ELN). For those, the ADR records the *default that unblocks
implementation* and flags what would change it.
