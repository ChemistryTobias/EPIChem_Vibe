"""Validating and compiling a procedure against a station's live plan representations (plan §9.1-9.3).

Validation covers tier 1 (schema/type: unknown plans, missing/unknown
parameters, types, min/max, device enums) and the graph tier a linear list
has (empty, duplicate ids). Capability-contract and safety tiers need Roadmap
1.3's device descriptor fields and come with them.
"""

from typing import Any, Optional

from .schema import Diagnostic, ProcedureStep

# Parameters EPIChem fills itself (run metadata), never shown or required.
RESERVED_PARAMETERS = {"md"}

_NUMBER_TYPES = {"int": int, "float": (int, float)}


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


def _check_value(step_id: str, parameter: dict[str, Any], value: Any, devices: dict[str, Any]) -> list[Diagnostic]:
    name = parameter["name"]
    annotation = parameter.get("annotation") or {}
    issue = lambda message: [Diagnostic(severity="error", message=message, step_id=step_id, parameter=name)]

    allowed = _allowed_names(annotation)
    if allowed is not None:
        values = value if isinstance(value, list) else [value]
        for item in values:
            if item not in allowed:
                return issue(f"'{item}' is not one of {sorted(allowed)}.")
            # A device enum entry must also really exist on the station.
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


def validate_steps(
    steps: list[ProcedureStep],
    plans: dict[str, Any],
    devices: dict[str, Any],
    registered: Optional[set[str]] = None,
) -> list[Diagnostic]:
    """`registered`: the pod devices known to EPIChem on this station; a step
    using one that isn't gets a warning (it runs, but the registry can't say
    where that device is or track it)."""
    diagnostics: list[Diagnostic] = []
    if not steps:
        diagnostics.append(Diagnostic(severity="error", message="The procedure has no steps."))

    seen: set[str] = set()
    for step in steps:
        if step.id in seen:
            diagnostics.append(Diagnostic(severity="error", message=f"Duplicate step id '{step.id}'.", step_id=step.id))
        seen.add(step.id)

        plan = plans.get(step.plan)
        if plan is None:
            diagnostics.append(
                Diagnostic(severity="error", message=f"Plan '{step.plan}' is not offered by this station.", step_id=step.id)
            )
            continue

        parameters = {p["name"]: p for p in plan_parameters(plan)}
        for name in step.kwargs:
            if name not in parameters:
                diagnostics.append(
                    Diagnostic(severity="error", message=f"'{step.plan}' has no parameter '{name}'.", step_id=step.id, parameter=name)
                )
        for name, parameter in parameters.items():
            if name not in step.kwargs or step.kwargs[name] is None:
                if is_required(parameter):
                    diagnostics.append(
                        Diagnostic(severity="error", message=f"'{name}' is required.", step_id=step.id, parameter=name)
                    )
                continue
            found = _check_value(step.id, parameter, step.kwargs[name], devices)
            diagnostics.extend(found)
            if not found and registered is not None and (parameter.get("annotation") or {}).get("devices"):
                values = step.kwargs[name] if isinstance(step.kwargs[name], list) else [step.kwargs[name]]
                for value in values:
                    if str(value).split(".")[0] not in registered:
                        diagnostics.append(
                            Diagnostic(
                                severity="warning",
                                message=f"Device '{value}' isn't registered in EPIChem on this station yet.",
                                step_id=step.id,
                                parameter=name,
                            )
                        )
    return diagnostics


def compile_steps(steps: list[ProcedureStep], meta: dict[str, Any]) -> list[dict[str, Any]]:
    """The queue items a procedure becomes (plan §9.1): one plan item per step,
    in order, each carrying EPIChem's provenance in `meta.epichem`."""
    return [
        {
            "item_type": "plan",
            "name": step.plan,
            "args": [],
            "kwargs": {k: v for k, v in step.kwargs.items() if v is not None},
            "meta": {"epichem": {**meta, "step_id": step.id, "step_index": index}},
        }
        for index, step in enumerate(steps)
    ]
