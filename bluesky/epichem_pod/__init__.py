"""epichem-pod: a station's Bluesky control stack for EPIChem (Roadmap 1.3).

    pip install epichem-pod            # or: pip install ./bluesky
    epichem-pod init my-station        # a station.py to edit
    epichem-pod serve my-station/station.py --epichem http://epichem:8000

See docs/BLUESKY.md. `expose(globals())` turns the driver objects in a
station script into ophyd devices and plans; `serve` runs the queueserver
and HTTP server for it and announces it to EPIChem.
"""

from .auto import expose

__version__ = "0.2.0"
__all__ = ["__version__", "expose"]
