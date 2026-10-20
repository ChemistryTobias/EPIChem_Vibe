"""Simulated ophyd devices for the reference EPIChem station pod (Roadmap 1.3).

Importable on purpose: a real device descriptor's `ophyd_import` names a class
like `epichem_sim.devices:SimHeaterStirrer`, and the queueserver startup
profile instantiates it from that same path — so the registry and the worker
namespace come from one source (plan §6.1).
"""

from .devices import SimHeaterStirrer, SimRamp, SimSpectrometer, SimSyringePump

__all__ = ["SimHeaterStirrer", "SimRamp", "SimSpectrometer", "SimSyringePump"]
