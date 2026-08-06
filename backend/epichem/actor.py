"""Who the current write is being made by, for `Revision.created_by`.

A ContextVar rather than an argument threaded through every write: the
alternative is adding an `actor` parameter to `create_entity`/
`update_entity`/`delete_entity` and to all ~20 of their call sites,
including the CLI and the YAML importer, neither of which has an identity to
pass.

It lives here — not in `api/auth.py`, which is the only thing that *sets* it
— so that `registry.py` (the service layer) doesn't have to import from the
API layer to read it.
"""

from contextvars import ContextVar

#: None means "no authenticated identity": auth is disabled, or the write
#: came from the CLI/importer rather than over HTTP.
current_actor: ContextVar[str | None] = ContextVar("current_actor", default=None)
