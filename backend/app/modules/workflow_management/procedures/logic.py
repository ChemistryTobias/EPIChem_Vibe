"""Validating and compiling a procedure (plan §9.1-9.4).

Plan steps are checked against their station's live plan representations --
tier 1 (unknown plans, missing/unknown parameters, types, min/max, device
enums) plus a warning for devices EPIChem hasn't registered. Control steps get
their own checks, and template references (`{{steps.<id>.<field>}}`) must
point at an earlier step. Capability-contract and safety tiers need Roadmap
1.3's descriptor fields and come with them.
"""

import re
from typing import Any, Optional
from urllib.parse import urlparse

from .schema import Diagnostic, ProcedureStep

# Parameters EPIChem fills itself (run metadata), never shown or required.
RESERVED_PARAMETERS = {"md"}
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
INPUT_TYPES = {"text", "number", "boolean"}

_NUMBER_TYPES = {"int": int, "float": (int, float)}
TEMPLATE = re.compile(r"\{\{\s*steps\.([\w-]+)((?:\.[\w-]+)*)\s*\}\}")


def plan_parameters(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """A plan's user-facing parameters: no *args/**kwargs, nothing EPIChem fills."""
    return [
        p
        for p in plan.get("parameters", [])
        if p["name"] not in RESERVED_PARAMETERS and p.get("kind", {}).get("name") not in ("VAR_POSITIONAL", "VAR_KEYWORD")
    ]


def is_required(parameter: dict[str, Any]) -> bool:
    return "default" not in parameter


def _allowed_names(annotation: dict[str, Any]) -> Optional[set[str]]:
    """The device/plan/enum names an annotated parameter accepts, if it's an enum."""
    names: set[str] = set()
    found = False
    for key in ("devices", "plans", "enums"):
        for group in (annotation.get(key) or {}).values():
            found = True
            names.update(group)
    return names if found else None


def is_template(value: Any) -> bool:
    return isinstance(value, str) and bool(TEMPLATE.search(value))


def _check_value(step_id: str, parameter: dict[str, Any], value: Any, devices: dict[str, Any]) -> list[Diagnostic]:
    name = parameter["name"]
    annotation = parameter.get("annotation") or {}

    def issue(message: str) -> list[Diagnostic]:
        return [Diagnostic(severity="error", message=message, step_id=step_id, parameter=name)]

    if is_template(value):
        return []  # filled in at run time; checked by the station then

    allowed = _allowed_names(annotation)
    if allowed is not None:
        values = value if isinstance(value, list) else [value]
        for item in values:
            if item not in allowed:
                return issue(f"'{item}' is not one of {sorted(allowed)}.")
            if annotation.get("devices") and str(item).split(".")[0] not in devices:
                return issue(f"Device '{item}' is not available on this station.")
        return []

    kind = annotation.get("type")
    if kind == "bool" and not isinstance(value, bool):
        return issue("Must be true or false.")
    if kind in _NUMBER_TYPES:
        if isinstance(value, bool) or not isinstance(value, _NUMBER_TYPES[kind]):
            return issue(f"Must be {'a whole number' if kind == 'int' else 'a number'}.")
        if "min" in parameter and value < float(parameter["min"]):
            return issue(f"Must be at least {parameter['min']}.")
        if "max" in parameter and value > float(parameter["max"]):
            return issue(f"Must be at most {parameter['max']}.")
    if kind == "str" and not isinstance(value, str):
        return issue("Must be text.")
    return []


def _templates_in(value: Any) -> list[str]:
    if isinstance(value, str):
        return [m.group(1) for m in TEMPLATE.finditer(value)]
    if isinstance(value, dict):
        return [ref for v in value.values() for ref in _templates_in(v)]
    if isinstance(value, list):
        return [ref for v in value for ref in _templates_in(v)]
    return []


def validate_plan_step(
    step: ProcedureStep, plans: dict[str, Any], devices: dict[str, Any], registered: Optional[set[str]]
) -> list[Diagnostic]:
    """Tier 1 for one plan step against its station's representations. `registered`:
    pod devices known to EPIChem on that station; using another is a warning."""
    plan = plans.get(step.plan)
    if plan is None:
        return [Diagnostic(severity="error", message=f"Plan '{step.plan}' is not offered by this station.", step_id=step.id)]
    diagnostics: list[Diagnostic] = []
    parameters = {p["name"]: p for p in plan_parameters(plan)}
    for name in step.kwargs:
        if name not in parameters:
            diagnostics.append(
                Diagnostic(severity="error", message=f"'{step.plan}' has no parameter '{name}'.", step_id=step.id, parameter=name)
            )
    for name, parameter in parameters.items():
        value = step.kwargs.get(name)
        if value is None or value == "":
            if is_required(parameter):
                diagnostics.append(Diagnostic(severity="error", message=f"'{name}' is required.", step_id=step.id, parameter=name))
            continue
        found = _check_value(step.id, parameter, value, devices)
        diagnostics.extend(found)
        if not found and registered is not None and (parameter.get("annotation") or {}).get("devices") and not is_template(value):
            for item in value if isinstance(value, list) else [value]:
                if str(item).split(".")[0] not in registered:
                    diagnostics.append(
                        Diagnostic(
                            severity="warning",
                            message=f"Device '{item}' isn't registered in EPIChem on this station yet.",
                            step_id=step.id,
                            parameter=name,
                        )
                    )
    return diagnostics


def validate_control_step(step: ProcedureStep) -> list[Diagnostic]:
    k = step.kwargs

    def issue(message: str, parameter: str | None = None) -> Diagnostic:
        return Diagnostic(severity="error", message=message, step_id=step.id, parameter=parameter)

    if step.type == "wait":
        duration = k.get("duration_s")
        if is_template(duration):
            return []
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
            return [issue("Wait needs a duration in seconds, greater than 0.", "duration_s")]
        return []
    if step.type == "input":
        out = []
        if not str(k.get("prompt") or "").strip():
            out.append(issue("Tell the operator what to do.", "prompt"))
        names = set()
        for field in k.get("fields") or []:
            name = str(field.get("name") or "")
            if not re.fullmatch(r"[A-Za-z_]\w*", name):
                out.append(issue(f"Field name '{name}' must be a simple identifier (letters, digits, _).", "fields"))
            elif name in names:
                out.append(issue(f"Field '{name}' appears twice.", "fields"))
            names.add(name)
            if field.get("type", "text") not in INPUT_TYPES:
                out.append(issue(f"Field '{name}' has an unknown type.", "fields"))
        return out
    if step.type == "http":
        out = []
        if str(k.get("method", "GET")).upper() not in HTTP_METHODS:
            out.append(issue(f"Method must be one of {sorted(HTTP_METHODS)}.", "method"))
        url = str(k.get("url") or "")
        parsed = urlparse(TEMPLATE.sub("x", url))
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            out.append(issue("A full http(s) URL is required.", "url"))
        return out
    return [issue(f"Unknown step type '{step.type}'.")]


def validate_steps(
    steps: list[ProcedureStep],
    palettes: dict[Any, dict[str, Any]],
    default_station: Any = None,
) -> list[Diagnostic]:
    """Every step, in order. `palettes`: station uuid -> {"plans", "devices",
    "registered"} or {"error": message} when that station can't be asked."""
    diagnostics: list[Diagnostic] = []
    if not steps:
        diagnostics.append(Diagnostic(severity="error", message="The procedure has no steps."))

    seen: list[str] = []
    for step in steps:
        if step.id in seen:
            diagnostics.append(Diagnostic(severity="error", message=f"Duplicate step id '{step.id}'.", step_id=step.id))
        for ref in _templates_in(step.kwargs):
            if ref not in seen:
                diagnostics.append(
                    Diagnostic(
                        severity="error",
                        message=f"'{{{{steps.{ref}…}}}}' must refer to an earlier step.",
                        step_id=step.id,
                    )
                )
        seen.append(step.id)

        if step.type != "plan":
            diagnostics.extend(validate_control_step(step))
            continue
        station = step.station_uuid or default_station
        if station is None:
            diagnostics.append(Diagnostic(severity="error", message="Choose the station this step runs on.", step_id=step.id))
            continue
        palette = palettes.get(station) or {"error": "Unknown station."}
        if "error" in palette:
            diagnostics.append(Diagnostic(severity="error", message=palette["error"], step_id=step.id))
            continue
        diagnostics.extend(validate_plan_step(step, palette["plans"], palette["devices"], palette.get("registered")))
    return diagnostics


def compile_plan_item(step: ProcedureStep, kwargs: dict[str, Any], meta: dict[str, Any], index: int) -> dict[str, Any]:
    """The queue item one plan step becomes (plan §9.1), carrying EPIChem's provenance in `meta.epichem`."""
    return {
        "item_type": "plan",
        "name": step.plan,
        "args": [],
        "kwargs": {k: v for k, v in kwargs.items() if v is not None and v != ""},
        "meta": {"epichem": {**meta, "step_id": step.id, "step_index": index}},
    }


def compile_steps(steps: list[ProcedureStep], meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Preview: the plan items, in order (control steps are EPIChem's own, not queue items)."""
    return [compile_plan_item(step, step.kwargs, meta, i) for i, step in enumerate(steps) if step.type == "plan"]


def lookup(outputs: dict[str, Any], step_id: str, path: str) -> Any:
    value: Any = outputs.get(step_id)
    for key in [p for p in path.split(".") if p]:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        else:
            return None
    return value


def resolve(value: Any, outputs: dict[str, Any]) -> Any:
    """Fill in `{{steps.<id>.<path>}}` from earlier steps' outputs. A string that is
    exactly one reference takes the referenced value's type; references inside
    longer text are spliced in as text."""
    if isinstance(value, dict):
        return {k: resolve(v, outputs) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v, outputs) for v in value]
    if not isinstance(value, str):
        return value
    whole = TEMPLATE.fullmatch(value.strip())
    if whole:
        return lookup(outputs, whole.group(1), whole.group(2))
    return TEMPLATE.sub(lambda m: str(lookup(outputs, m.group(1), m.group(2))), value)
