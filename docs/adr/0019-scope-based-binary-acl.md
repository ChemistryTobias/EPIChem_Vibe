# ADR 0019: Scope-scoped binary read/write grants — supersedes plan §12.1's role list

**Part of the graph/multi-user proposal package — see `docs/GRAPH_AND_MULTIUSER_PROPOSAL.md`.**

**Status:** Proposed — awaiting decision; nothing here is built.

## Context

Plan §12.1 specifies OIDC (Keycloak) identity plus five global roles — `viewer` (read-only),
`operator` (run published procedures, control samples), `author` (create/publish procedures),
`engineer` (device descriptors, layout, capability classes), `admin` (permissions, policies) — with
an admin-mode/user-mode split enforced server-side, meant to align with bluesky-queueserver's own
`user_group_permissions.yaml`.

The project owner explicitly rejected this shape: "I do not like those five global roles, I would
just like to see the following for each layer every user (or user group) can get read or r/w
permissions. Every new user has no permissions and must be added to a group or get certain
permissions."

No auth/identity/RBAC exists in the codebase today — confirmed by direct inspection. The only thing
that exists is a shared bearer token (`api/auth.py::require_write_token`), whose own docstring
already names it as "the seam" a real identity system replaces, and the frontend has deliberately
built no login UI "until the backend has real identities... today [the token is] a shared secret with
no user behind it." This is green-field work, not a rewrite of something functioning.

Plan §17 Q9 ("multi-tenancy model: one deployment per group, or one per institute with tenant
isolation... affects the auth model and the database schema") is explicitly open. This ADR's grant
model works under either answer without deciding Q9 — a Site-scoped grant already behaves like tenant
isolation for a single-institute-multi-group deployment.

## Decision

1. **Two new entities:** `Principal` (a `User` or a `Group`; a `User` may belong to zero or more
   `Group`s) and `PermissionGrant` — `(principal_id, scope_type: site|lab|zone|station|device,
   scope_id, level: read|write)`. A freshly-provisioned `User` (first OIDC login) starts with **zero**
   grants and zero group memberships — nothing is usable until an admin adds them to a group or grants
   them directly, matching "every new user has no permissions."

2. **Inheritance is downward through the containment tree.** A grant at Site level implies the same
   level at every Lab/Zone/Station/Device beneath it. Resolving "can principal P do X at entity E"
   walks upward from E through its ancestors (E → its Station/Zone → its Lab → its Site) and stops at
   the nearest grant found. This is a short upward traversal, and maps directly onto ADR 0017's
   `CONTAINS` graph edges — the graph projection is a natural fit for this check, not a separate
   concern from it.

3. **`write` implies `read`.** There is no separate "execute a published procedure" permission in v1:
   running a procedure against a Station requires `read` on that Station (or an ancestor), since
   running it doesn't mutate topology — the Sample/Run rows a run produces are written by the API on
   the operator's behalf, not because the operator holds structural `write`. This is a deliberate
   simplification (see Consequences); a future `operate` level between `read` and `write` is a small
   additive change if this proves too coarse (e.g. to let read-only users run procedures without
   seeing calibration certificates).

4. **"Admin" is `write` on a scope, not a sixth global role.** Whoever holds `write` on a Site can
   grant others `read`/`write` within it — granting/revoking permissions is itself governed by the
   same model, not a separate privilege. A fresh deployment still needs a bootstrap mechanism for the
   very first grant: today's shared `EPICHEM_API_TOKENS` env var is the natural bootstrap path until
   the first admin grant exists, mirroring how it already works today.

5. **§12.1's OIDC/Keycloak identity layer is kept.** This ADR replaces the *role* model, not the
   *authentication* mechanism — `User.subject` maps to the OIDC `sub` claim. §12.1's stated intent to
   "align with queueserver's `user_group_permissions.yaml` rather than layering an independent
   permission system" is honored directly: an EPIChem `Group` maps 1:1 to a queueserver permission
   group and can be exported to that file rather than hand-duplicated.

6. **`PermissionGrant` writes go through the existing `registry.py` path** — it's a `RegistryEntity`
   like everything else, versioned and revisioned with no special-cased write mechanism.

## Consequences

- Loses §12.1's role vocabulary as named concepts (`operator`/`author`/`engineer`). Anywhere the plan
  or a future UI would say "needs `author`," it becomes "needs `write` at the relevant
  Procedure/Lab scope" instead — simpler, but loses the built-in distinction between e.g. "can create
  procedures" and "can edit device descriptors" (both collapse to `write` at different scopes rather
  than different named roles). This is the direct tradeoff of the simplification requested.
- §17 Q9 (multi-tenancy) becomes easier to leave open longer: Site-scoped grants already give
  tenant-like isolation without committing to a separate `Organisation` table first.
- Real implementation work, none of it started: `User`/`Group`/`PermissionGrant` models + migration;
  an actual OIDC login flow (today's frontend has none, by design, pending exactly this); scope-aware
  enforcement in every router (today's `require_write_token` is one shared gate, not scope-aware); a
  permission-aware frontend (hide/disable controls the current user lacks `write` for, at the scope
  being viewed).
- **A related gap this surfaces, not fixed by this ADR:** §8.1 already promises `ETag`/`If-Match`
  optimistic concurrency, but it isn't implemented — PUT is a full replace with no version check.
  Once multiple principals can hold `write` on the same scope, two people (or one person in two tabs)
  editing the same Lab layout draft (ADR 0014) can silently clobber each other. Worth its own follow-up
  once this ADR is accepted — see the cover proposal doc.

## Alternatives considered

- **Keep §12.1's five roles, add scope as a modifier** (`engineer @ LAB-3`). Rejected per direct
  feedback — this adds role vocabulary on top of scope instead of replacing it, more concepts than
  wanted.
- **Deny-by-default with explicit lower-scope overrides** (a "revoke" grant type narrowing access
  below an ancestor's grant). Not adopted in v1 — introduces a second grant polarity and a "nearest
  vs. most-restrictive wins" resolution question that wasn't asked for. Nearest-ancestor-wins is
  simpler to reason about and matches "every layer... read or r/w" as stated.
