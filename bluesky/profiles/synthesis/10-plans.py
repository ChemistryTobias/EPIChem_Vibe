"""Plans this station offers: the synthesis library, plus bluesky's stock count/scan."""

from bluesky.plans import count, scan  # noqa: F401 -- stock plans, exposed as-is

from epichem_pod.plans import synthesis as _synthesis

globals().update(_synthesis.build({"hotplate": hotplate, "pump": pump, "spectrometer": spectrometer}))  # noqa: F821
