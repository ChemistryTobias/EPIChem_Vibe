"""Instrument drivers -- the layer below ophyd.

A driver is any plain Python object that talks to one instrument (sockets,
CAN, Modbus, a vendor SDK...). EPIChem's pod doesn't care how; it only needs
the driver's *methods*. `drivers.sim` holds simulators with the same method
surface as typical lab drivers (a SCARA arm, a pipetting module, a hotplate, a
spin coater), so a station can be built and its workflows tested before -- or
without -- the hardware. Point a station's config at the real driver class
instead (`drivers.load`) and nothing above this layer changes.
"""
