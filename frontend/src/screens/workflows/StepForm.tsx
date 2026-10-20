/**
 * A step's parameter form, generated from its plan's representation: one input
 * per parameter, typed from the annotation (device/enum -> select, bool ->
 * checkbox, int/float -> number with the plan's min/max/step, else text).
 * Defaults show as placeholders; leaving a field empty means "use the plan's
 * default", which is why an optional field is never pre-filled.
 */

import type { Diagnostic, PlanParameter, PlanRepr, ProcedureStep } from "../../api/types";
import { Field, FieldGroup } from "../../components/Inspector";
import { enumOptions, inputKind, isDeviceParameter, isRequired, parametersOf } from "./plans";

interface StepFormProps {
  step: ProcedureStep;
  plan: PlanRepr | undefined;
  diagnostics: Diagnostic[];
  registered: string[];
  onChange: (step: ProcedureStep) => void;
}

export function StepForm({ step, plan, diagnostics, registered, onChange }: StepFormProps) {
  const set = (name: string, value: unknown) => {
    const kwargs = { ...step.kwargs };
    if (value === null || value === undefined || value === "") delete kwargs[name];
    else kwargs[name] = value;
    onChange({ ...step, kwargs });
  };
  const general = diagnostics.filter((d) => !d.parameter);

  return (
    <>
      {plan?.description && <p className="step-form__description">{plan.description}</p>}
      {!plan && (
        <p className="create__error">
          This station doesn&apos;t offer a plan called <span className="mono">{step.plan}</span>. Remove the step, or
          pick the station that does.
        </p>
      )}
      {general.map((d, i) => (
        <p key={i} className={d.severity === "error" ? "create__error" : "step-form__warning"}>
          {d.message}
        </p>
      ))}

      <FieldGroup title="Step">
        <Field label="Label">
          <input
            className="field__input"
            value={step.label ?? ""}
            placeholder={step.plan}
            onChange={(e) => onChange({ ...step, label: e.target.value || null })}
          />
        </Field>
      </FieldGroup>

      {plan && parametersOf(plan).length > 0 && (
        <FieldGroup title="Parameters">
          {parametersOf(plan).map((p) => (
            <ParameterInput
              key={p.name}
              parameter={p}
              value={step.kwargs[p.name]}
              registered={registered}
              diagnostics={diagnostics.filter((d) => d.parameter === p.name)}
              onChange={(value) => set(p.name, value)}
            />
          ))}
        </FieldGroup>
      )}
    </>
  );
}

function ParameterInput({
  parameter: p,
  value,
  registered,
  diagnostics,
  onChange,
}: {
  parameter: PlanParameter;
  value: unknown;
  registered: string[];
  diagnostics: Diagnostic[];
  onChange: (value: unknown) => void;
}) {
  const kind = inputKind(p);
  const label = `${p.name}${isRequired(p) ? " *" : ""}`;
  const placeholder = p.default !== undefined ? `default: ${p.default}` : "required";
  const range = [p.min !== undefined && `≥ ${p.min}`, p.max !== undefined && `≤ ${p.max}`].filter(Boolean).join(", ");

  let input;
  if (kind === "enum") {
    const device = isDeviceParameter(p);
    input = (
      <select className="field__input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{isRequired(p) ? "Choose…" : placeholder}</option>
        {enumOptions(p)!.map((option) => (
          <option key={option} value={option}>
            {option}
            {device && !registered.includes(option) ? " (not registered)" : ""}
          </option>
        ))}
      </select>
    );
  } else if (kind === "bool") {
    const fallback = p.default === "True";
    input = (
      <select
        className="field__input"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      >
        <option value="">{`default (${fallback ? "yes" : "no"})`}</option>
        <option value="true">yes</option>
        <option value="false">no</option>
      </select>
    );
  } else if (kind === "int" || kind === "float") {
    input = (
      <input
        className="field__input mono"
        type="number"
        min={p.min}
        max={p.max}
        step={p.step ?? (kind === "int" ? 1 : "any")}
        placeholder={placeholder}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : kind === "int" ? Math.trunc(Number(e.target.value)) : Number(e.target.value))}
      />
    );
  } else {
    input = (
      <input
        className="field__input"
        placeholder={placeholder}
        value={value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Field label={label}>
      {input}
      {(p.description || range) && (
        <p className="step-form__hint">
          {p.description}
          {p.description && range ? " " : ""}
          {range && <span className="mono">({range})</span>}
        </p>
      )}
      {diagnostics.map((d, i) => (
        <p key={i} className={d.severity === "error" ? "create__error" : "step-form__warning"}>
          {d.message}
        </p>
      ))}
    </Field>
  );
}
