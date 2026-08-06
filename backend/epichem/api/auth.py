"""Shared-token authentication for the write API (§12.1, partial).

This is deliberately the smallest thing that closes the real hole — "anyone
who can reach this API can delete a device or a sample" — and deliberately
*not* the identity system §12.1 eventually wants. There is no user table, no
roles, no SSO. What there is:

- One or more tokens supplied via `EPICHEM_API_TOKENS`, as
  `label:token` pairs (`ci:s3cret,tobias:hunter2`). The label is what lands
  in `Revision.created_by`, so the audit trail finally says *who*, at the
  granularity of "which token", not "someone".
- Enforcement on writes only (POST/PUT/DELETE). Reads stay open: the read
  API is what the console and the CLI use for browsing, and gating it would
  buy little while there's no login UI.
- **Unset means disabled**, so `epichem` still runs with zero configuration
  for local work. The app logs a warning at startup when that's the case, so
  an unauthenticated deployment is a thing you chose rather than a thing you
  didn't notice.

A real OIDC/RBAC design (per-user identity, roles, scoped tokens) is still
owed — see ADR 0003 Q3's owner note and PROJECT_MILESTONES.md. When it
lands, `require_write_token` is the seam it replaces: every write endpoint
already depends on it, and `Revision.created_by` already carries whatever it
returns.
"""

import logging
import os
import secrets

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from epichem.actor import current_actor
from epichem.api.errors import UnauthorizedProblem

logger = logging.getLogger("epichem.auth")

TOKENS_ENV = "EPICHEM_API_TOKENS"

#: FastAPI's bearer extractor. auto_error=False so a *missing* header reaches
#: our own handler and comes back as problem+json like every other error,
#: rather than FastAPI's default 403 shape.
_bearer = HTTPBearer(auto_error=False, description="Bearer token from EPICHEM_API_TOKENS.")


def configured_tokens() -> dict[str, str]:
    """`{token: label}` parsed from the environment. Empty means auth is off.

    Read per call rather than cached at import so tests (and a reloading dev
    server) can change it without reimporting the module.
    """
    raw = os.environ.get(TOKENS_ENV, "")
    tokens: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair:
            continue
        label, _, token = pair.partition(":")
        if not token:
            logger.warning(
                "%s entry %r is not in label:token form and was ignored", TOKENS_ENV, label
            )
            continue
        tokens[token] = label
    return tokens


def auth_enabled() -> bool:
    return bool(configured_tokens())


def warn_if_open() -> None:
    if not auth_enabled():
        logger.warning(
            "%s is not set: writes are UNAUTHENTICATED. Fine for localhost; "
            "set it to 'label:token' pairs before exposing this to anyone else.",
            TOKENS_ENV,
        )


async def require_write_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str | None:
    """Dependency for every write endpoint. Returns the token's label — which
    becomes `Revision.created_by` — or None when auth is disabled.

    `async` on purpose. A *sync* dependency runs in its own threadpool
    worker, which gets a copy of the request's context — so a ContextVar set
    there is discarded before the endpoint runs, and `created_by` silently
    stays null. An async dependency runs in the event loop's own context,
    which the endpoint's worker then inherits.
    """
    tokens = configured_tokens()
    if not tokens:
        current_actor.set(None)
        return None

    presented = credentials.credentials if credentials else ""
    # Checked against every configured token rather than by dict lookup, and
    # with compare_digest, so neither the comparison nor the loop leaks which
    # token (or which prefix of one) was closest.
    label = None
    for token, token_label in tokens.items():
        if secrets.compare_digest(presented, token):
            label = token_label
    if label is None:
        raise UnauthorizedProblem(
            title="Not authenticated",
            detail=(
                "Writes require a bearer token from EPICHEM_API_TOKENS: "
                "send `Authorization: Bearer <token>`."
            ),
        )

    current_actor.set(label)
    return label
