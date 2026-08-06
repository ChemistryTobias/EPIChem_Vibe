# ADR 0001: In-application reconciler, not a Kubernetes operator with CRDs

**Answers plan §17 Q6.**

**Status:** Accepted

## Context

§4 mandates git-backed declarative config with a Kubernetes-style
reconciliation loop (desired state vs. observed state, drift reporting).
§17 Q6 asks whether that loop should be a real k8s operator with CRDs, or an
in-application control loop with the same semantics.

CRDs give free RBAC, `kubectl diff`/`kubectl get` tooling, and a
well-understood operator pattern. But they hard-require a Kubernetes cluster,
which conflicts directly with G8 ("a single-cell lab should run from one
`docker compose up` with defaults") and with the `docker compose` on-ramp in
§12.6.

## Decision

Build the reconciler as an in-application control loop:

- Desired state = descriptor YAML files under a configured directory (a git
  checkout in real deployments; `descriptors/` in this repo for now).
- Observed state = the Postgres registry.
- The reconciler (`epichem.reconciler`) loads, validates, and diffs the two,
  upserts what's changed, and returns a structured report (created / updated
  / unchanged / conflict). It runs on demand via `epichem reconcile` (CLI) or
  a REST trigger; a periodic/webhook-triggered mode is future work, not M1.
- The reconciler is a single Python module with a plain function signature
  (`reconcile(session, descriptors_dir) -> ReconcileReport`), not a
  Kubernetes-shaped object (no CRD schemas, no controller-runtime patterns).
  If the project later needs multi-cluster / RBAC-via-k8s, this can be
  wrapped by an operator without changing the reconciliation semantics
  themselves — the function is the reusable unit, not the deployment model.

## Consequences

- No k8s dependency for a single-cell lab. Matches G8 directly.
- No free `kubectl diff` — drift inspection is a CLI/API report instead.
- If the project later needs a real operator (multi-cluster, k8s-native RBAC),
  this ADR should be revisited; the in-app reconciler's diff logic should be
  reusable inside a controller's `Reconcile()` method rather than rewritten.
