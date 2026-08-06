# EPIChem — repo notes for Claude Code

Full spec: `project_plan/EPIChem_Project_Plan.md` (68K, read it before touching architecture —
§3 Non-Goals is binding: don't let this project grow an execution engine, a device driver layer,
an ELN, or a raw-data store; those are explicitly delegated elsewhere). Design/brand reference:
`project_plan/DESIGN.md`. Decision log: `docs/adr/` — read it before re-deciding something already
decided there. Milestone status: `PROJECT_MILESTONES.md` — the honest record of what's actually
built vs. what the plan describes; update it when scope changes, don't let it drift from reality.

## Working in this repo

- Backend: `backend/epichem/` (Python, FastAPI, SQLAlchemy 2.0, Pydantic v2). Venv at
  `backend/.venv` — `.venv/bin/pytest`, `.venv/bin/ruff check epichem tests`,
  `.venv/bin/epichem <command>`.
- No Postgres needed for local dev/tests: `epichem/db.py` falls back to a local sqlite file, and
  tests use an in-memory sqlite engine with `StaticPool` (required for in-memory sqlite —
  otherwise each connection gets its own empty database).
- Descriptor YAML lives in `descriptors/` at the repo root (topology/classes/devices) — this is
  the git-backed "desired state" the reconciler reads (plan §4). It's also the reconciler's test
  fixture; don't restructure it without checking `backend/tests/test_reconciler.py`.
- Every module has a one-line docstring pointing back to the plan section it implements. Keep
  doing that — it's what makes "why does this field exist" answerable without re-reading the
  68K-word spec each time.

## Conventions established so far

- Enumerated fields (environment_class, atmosphere, workcell state, ...) are plain strings
  validated at the pydantic descriptor layer, not DB enums — see the module docstring in
  `models/topology.py` for why.
- Registry mutation happens two ways only: the reconciler (from descriptors) or direct DB writes
  in tests. The read API (`api/routers/`) is deliberately read-only in M1 — topology/device
  mutation via HTTP is an M2 (layout editor) concern, not something to bolt on early.
- `ReconcileReport`/`ReconcileItem` shape (built by the reconciler): check
  `backend/epichem/reconciler.py`'s module docstring before consuming it from a new call site —
  don't assume the shape, it was designed by whoever wrote that file.

## Process

- ADRs (`docs/adr/NNNN-title.md`) for any decision with real weight — see `docs/adr/0000-adr-process.md`
  for the format. Don't silently redecide something already in the log; supersede it explicitly if
  it needs to change.
- Commit and push at logical checkpoints, not one giant commit — this project is meant to be
  buildable incrementally and reviewable that way.
- A project-specific subagent, `karpathy-guidelines` (`.claude/agents/karpathy-guidelines.md`),
  encodes Andrej Karpathy's LLM-coding-pitfall guidelines (think before coding, simplicity first,
  surgical changes, goal-driven execution with verifiable success criteria). Prefer it for
  self-contained, testable features. It's a project-level agent file — if a session's Agent tool
  doesn't list it as an available `subagent_type`, agent definitions are loaded at session start,
  so it needs a fresh session to register; until then, inline its guidelines into a
  `general-purpose` agent's prompt instead (see how the reconciler was delegated for a template).
