"""Plans this station offers, as two libraries: the high-level operations and
the low-level device actions they're made of (the palette shows them as two
groups -- see epichem_pod/plans/__init__.py)."""

from epichem_pod.plans import spinbot as _high_level
from epichem_pod.plans import spinbot_low_level as _low_level

globals().update(_low_level.build(station))  # noqa: F821 -- from 00-devices.py
globals().update(_high_level.build(station))  # noqa: F821
