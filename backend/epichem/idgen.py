"""UUIDv7 generation (RFC 9562), per plan §5: "All identifiers are UUIDv7
(time-ordered, index-friendly)".

Not using Python's stdlib uuid7 (added in 3.14+) to keep the minimum
supported version at 3.11.
"""

import os
import time
import uuid

_VERSION_7 = 0x7
_VARIANT_RFC4122 = 0b10


def uuid7() -> uuid.UUID:
    unix_ts_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF  # 48 bits
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF  # 12 bits
    rand_b = int.from_bytes(os.urandom(8), "big") & 0x3FFFFFFFFFFFFFFF  # 62 bits

    value = unix_ts_ms << 80
    value |= _VERSION_7 << 76
    value |= rand_a << 64
    value |= _VARIANT_RFC4122 << 62
    value |= rand_b

    return uuid.UUID(int=value)
