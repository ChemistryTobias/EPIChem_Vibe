"""ophyd Devices for EPIChem station pods (Roadmap 1.3).

Two kinds:

- `ramp`: self-contained soft devices (a heater, a pump, a spectrometer) for
  the synthesis demo station;
- `lab`: thin wrappers that turn any *driver* object (see ../drivers) into an
  ophyd Device -- each driver call becomes a Movable whose Status reports how
  it went, so plans stay pure bluesky and the RunEngine keeps control
  (pause/abort between moves, every action in the document stream).

The station config names the driver class; the wrapper doesn't care whether
it's a simulator or the real instrument.
"""
