"""Plan libraries for EPIChem station pods.

Each module is one library; the queueserver reports a plan's module, and
EPIChem's palette groups plans by it -- so splitting a station's plans into
`<station>_low_level` (one plan per device action) and `<station>` (the
operations a scientist thinks in, composed from the low-level ones) is what
makes the two levels show up as two groups in the workflow designer.

Libraries that need the station's devices or teach points are built by a
`build(station)` factory, whose plans close over them; their parameter
enums (which device, which position group) come from the station config.
"""
