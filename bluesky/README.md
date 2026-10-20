# epichem-pod

A station's Bluesky control stack for [EPIChem](../docs/BLUESKY.md):
bluesky-queueserver + bluesky-httpserver over ophyd devices, with
auto-discovery of plain instrument-driver objects.

```bash
pip install ./bluesky          # or: pip install "epichem-pod @ git+https://github.com/ChemistryTobias/EPIChem_Vibe#subdirectory=bluesky"
epichem-pod init my-station
epichem-pod discover my-station/station.py
epichem-pod serve my-station/station.py --epichem http://localhost:8000
```

`serve` needs a Redis (it starts `redis-server` itself if one is installed).
Full guide: [`docs/BLUESKY.md`](../docs/BLUESKY.md).
