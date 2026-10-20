"""Auto-discovery: turn plain driver objects into ophyd devices and plans (IvoryOS-style).

    from epichem_pod import expose
    hotplate = HotplateDriver("192.168.10.22", 4001, 1, 300)
    expose(globals())

`expose` finds every instrument-driver object in the namespace and, for each:

- wraps it in an ophyd Device (same `DriverDevice` base the hand-written
  wrappers use), whose readings are the driver's *getters* -- methods named
  `get_*`, `read_*`, `request_*`, `is_*` that need no arguments;
- generates one plan per *action* method (every other public method),
  `<device>_<method>`, with the method's own signature: type hints and
  defaults carry over, and the docstring supplies the description, each
  parameter's description, and `[min, max]` ranges when written the way
  instrument drivers usually document them:

      Args:
          T_SET (int, [0, 300]): Temperature setpoint [°C].

The generated plans live in a module named `epichem_pod.auto.<device>_low_level`,
so EPIChem's palette shows each device as its own low-level group. Write your
station's high-level plans as ordinary bluesky plans calling these.
"""

import inspect
import re
import types
from collections.abc import Callable, Iterable
from typing import Any

from ophyd import Component as Cpt
from ophyd import Device, Signal

from .devices.lab import DriverDevice, action, do

GETTER = re.compile(r"^(get|read|request|is|has)_")
LIFECYCLE = {"connect", "disconnect", "close", "open", "shutdown", "reconnect"}
SKIP_TYPES = (types.ModuleType, type, types.FunctionType, types.BuiltinFunctionType, types.MethodType)
SKIP_MODULES = ("builtins", "bluesky", "ophyd", "epichem_pod.devices", "epichem_pod.auto", "typing", "logging", "pathlib", "collections")
_DEVICE_ATTRS = set(dir(Device))


def _public_methods(obj: Any) -> dict[str, Callable]:
    methods = {}
    for name in dir(type(obj)):
        if name.startswith("_"):
            continue
        attr = getattr(type(obj), name, None)
        if callable(attr) and not isinstance(attr, (staticmethod, classmethod, property, type)):
            methods[name] = getattr(obj, name)
    return methods


def is_driver(obj: Any) -> bool:
    """An instance of some library's class with public methods -- an instrument driver."""
    if isinstance(obj, (*SKIP_TYPES, Device, int, float, str, bytes, list, dict, tuple, set)):
        return False
    module = type(obj).__module__ or ""
    if module.startswith(SKIP_MODULES) or type(obj).__name__ in ("RunEngine", "Station"):
        return False
    return bool(_public_methods(obj))


def _required(method: Callable) -> bool:
    try:
        parameters = inspect.signature(method).parameters.values()
    except (TypeError, ValueError):
        return True
    return any(
        p.default is inspect.Parameter.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD) for p in parameters
    )


# --- docstrings ---------------------------------------------------------------
_GOOGLE = re.compile(r"^\s*(\w+)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$")
_RANGE = re.compile(r"\[\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*\]")


def parse_docstring(doc: str | None) -> tuple[str, dict[str, dict[str, Any]]]:
    """(summary, {param: {description, min?, max?}}) from Google, NumPy or Sphinx style."""
    if not doc:
        return "", {}
    lines = inspect.cleandoc(doc).splitlines()
    summary = lines[0].strip() if lines else ""
    params: dict[str, dict[str, Any]] = {}
    section = None
    current = None
    for line in lines[1:]:
        stripped = line.strip()
        lower = stripped.lower().rstrip(":")
        if lower in ("args", "arguments", "parameters", "params"):
            section, current = "params", None
            continue
        if lower in ("returns", "return", "raises", "yields", "examples", "notes") or set(stripped) == {"-"}:
            if set(stripped) != {"-"}:
                section, current = None, None
            continue
        sphinx = re.match(r"^:param\s+(?:\w+\s+)?(\w+):\s*(.*)$", stripped)
        if sphinx:
            current = sphinx.group(1)
            params[current] = {"description": sphinx.group(2)}
            continue
        if section != "params" or not stripped:
            continue
        indent = len(line) - len(line.lstrip())
        # NumPy writes "name : type" (space before the colon), Google "name (type): text".
        numpy = re.match(r"^(\w+)\s+:\s*(.*)$", stripped) if indent <= 4 else None
        google = None if numpy else _GOOGLE.match(stripped)
        if google and (google.group(2) is not None or indent <= 4):
            current = google.group(1)
            entry: dict[str, Any] = {"description": google.group(3).strip()}
            spec = google.group(2) or ""
            rng = _RANGE.search(spec) or _RANGE.search(google.group(3))
            if rng:
                entry["min"], entry["max"] = float(rng.group(1)), float(rng.group(2))
            params[current] = entry
        elif numpy:
            current = numpy.group(1)
            params[current] = {"description": ""}
        elif current:
            params[current]["description"] = f"{params[current]['description']} {stripped}".strip()
            rng = _RANGE.search(stripped)
            if rng and "min" not in params[current]:
                params[current]["min"], params[current]["max"] = float(rng.group(1)), float(rng.group(2))
    return summary, params


# --- building -----------------------------------------------------------------
def _signature(method: Callable) -> inspect.Signature:
    """The method's signature for the plan: no self, no *args/**kwargs, types
    inferred from defaults where the hint is missing."""
    parameters = []
    for p in inspect.signature(method).parameters.values():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        annotation = p.annotation
        if annotation is inspect.Parameter.empty and p.default not in (inspect.Parameter.empty, None):
            annotation = type(p.default)
        parameters.append(p.replace(kind=p.POSITIONAL_OR_KEYWORD, annotation=annotation))
    return inspect.Signature(parameters)


def _device_class(name: str, getters: dict[str, Callable], actions: Iterable[str]) -> type:
    attrs: dict[str, Any] = {}
    readings: dict[str, str] = {}
    for method in getters:
        attr = GETTER.sub("", method)
        if attr in _DEVICE_ATTRS or attr in attrs:
            attr = f"r_{attr}"
        attrs[attr] = Cpt(Signal, value=0.0, kind="hinted")
        readings[attr] = method
    for method in actions:
        attrs[f"act_{method}"] = action(method, on_driver=True)

    def refresh(self):
        for attr, method in readings.items():
            try:
                value = getattr(self.driver, method)()
            except Exception as exc:  # a getter that fails reads as its error, not as a dead panel
                value = f"error: {exc}"
            if value is None:
                value = ""  # ophyd can't describe None
            elif not isinstance(value, (int, float, str, bool)):
                value = str(value)
            getattr(self, attr).put(value)

    attrs["refresh"] = refresh
    attrs["__doc__"] = f"Auto-discovered device around a {name}."
    return type(f"Auto{name}", (DriverDevice,), attrs)


def _make_plan(device: Device, device_name: str, method_name: str, method: Callable):
    from bluesky_queueserver import parameter_annotation_decorator

    signature = _signature(method)
    summary, docs = parse_docstring(inspect.getdoc(method))
    target = getattr(device, f"act_{method_name}")

    def plan(*args, **kwargs):
        # The queueserver may pass arguments positionally; bind them to names.
        bound = signature.bind(*args, **kwargs)
        yield from do(target, dict(bound.arguments))

    plan.__name__ = plan.__qualname__ = f"{device_name}_{method_name}"
    plan.__signature__ = signature
    plan.__module__ = f"epichem_pod.auto.{device_name}_low_level"
    plan.__doc__ = summary or f"{type(device.driver).__name__}.{method_name}"
    parameters = {}
    for p in signature.parameters.values():
        info = docs.get(p.name, {})
        entry = {k: v for k, v in info.items() if k in ("description", "min", "max") and v not in ("", None)}
        if entry:
            parameters[p.name] = entry
    return parameter_annotation_decorator({"description": plan.__doc__, "parameters": parameters})(plan)


def expose(namespace: dict, *, exclude: Iterable[str] = (), only: Iterable[str] | None = None) -> dict[str, Any]:
    """Discover the drivers in `namespace`, replace each with its ophyd device,
    and add one plan per action method, plus `read_devices` and a RunEngine if
    the namespace has none. `exclude`: method names never to expose; `only`:
    restrict to these variable names. Returns {name: device}."""
    from bluesky import RunEngine

    from .devices.readings import make_read_devices

    skip = set(exclude) | LIFECYCLE
    found: dict[str, Any] = {}
    for name, obj in list(namespace.items()):
        if name.startswith("_") or (only is not None and name not in set(only)) or not is_driver(obj):
            continue
        methods = {m: f for m, f in _public_methods(obj).items() if m not in skip}
        getters = {m: f for m, f in methods.items() if GETTER.match(m) and not _required(f)}
        actions = {m: f for m, f in methods.items() if m not in getters}
        device = _device_class(type(obj).__name__, getters, actions)(name=name, driver=obj)
        device.refresh()  # real first values: readings must describe from the start
        namespace[name] = device
        found[name] = device
        for method_name, method in actions.items():
            try:
                plan = _make_plan(device, name, method_name, method)
            except (TypeError, ValueError):
                continue  # a signature inspect can't read; leave it out rather than guess
            namespace[plan.__name__] = plan
    namespace.setdefault("read_devices", make_read_devices(namespace))
    namespace.setdefault("RE", RunEngine({}))
    return found
