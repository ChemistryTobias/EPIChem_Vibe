"""Request-body checks shared by the descriptor-shaped write endpoints.

`Descriptor` carries its own `kind`, and the URL says which kind the caller
is addressing — so `POST /api/v1/labs` with a `kind: Site` body is a
contradiction that has to be rejected somewhere. It used to be rejected by
two identical private copies of this function, one per router module.
"""

from fastapi import HTTPException

from epichem.schemas.descriptor import Descriptor


def check_descriptor_kind(descriptor: Descriptor, expected_kind: str) -> None:
    """400 if the body's `kind` doesn't match the endpoint's.

    Deliberately a plain 400 rather than an RFC 9457 problem: this is a
    malformed request, the same class of thing FastAPI's own body validation
    rejects, not one of the three write-path failures `api/errors.py` models.
    """
    if descriptor.kind != expected_kind:
        raise HTTPException(
            status_code=400,
            detail=f"expected kind={expected_kind!r}, got kind={descriptor.kind!r}",
        )
