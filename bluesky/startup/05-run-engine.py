"""The station's RunEngine — the thing that actually executes plans.

Defined here (the manager runs with --keep-re) so its document subscriptions
live with the rest of the station's code. To persist documents, subscribe a
sink — e.g. a Tiled writer or a databroker catalog — here; EPIChem stores
pointers to runs (their uids), never the data (plan §3).
"""

from bluesky import RunEngine

RE = RunEngine({"station": "epichem-sim-station"})
