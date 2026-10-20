/**
 * A step's parameter form, generated from its plan's representation: one input
 * per parameter, typed from the annotation (device/enum -> select, bool ->
 * checkbox, int/float -> number with the plan's min/max/step, else text).
 * Defaults show as placeholders; leaving a field empty means "use the plan's
 * default", which is why an optional field is never pre-filled.
 */

import type { Diagnostic, PlanParameter, PlanRepr, ProcedureStep } from "../../api/types";
import { Field, FieldGroup } from "../../components/Inspector";
import { enumOptions, inputKind, isDeviceParameter, isRequired, isTemplate, parametersOf } from "./plans";

type Ref = { value: string; label: string };

interface StepFormProps {
  step: ProcedureStep;
  plan: PlanRepr | undefined;
  diagnostics: Diagnostic[];
  registered: string[];
  onChange: (step: ProcedureStep) => void;
  /** Hide the step label (a one-off run has nothing to label). */
  bare?: boolean;
  /** Parameters set by context — e.g. the device a card's action belongs to —
   * shown, but not editable. */
  fixed?: string[];
  /** Earlier steps' outputs a parameter can take its value from. */
  refs?: Ref[];
}

export function StepForm({ step, plan, diagnostics, registered, onChange, bare = false, fixed = [], refs = [] }: StepFormProps) {
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

      {!bare && (
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
      )}

      {plan && parametersOf(plan).length > 0 && (
        <FieldGroup title="Parameters">
          {parametersOf(plan).map((p) =>
            fixed.includes(p.name) ? (
              <Field key={p.name} label={p.name}>
                <span className="mono">{String(step.kwargs[p.name] ?? "")}</span>
              </Field>
            ) : (
            <ParameterInput
              key={p.name}
              parameter={p}
              value={step.kwargs[p.name]}
              registered={registered}
              refs={refs}
              diagnostics={diagnostics.filter((d) => d.parameter === p.name)}
              onChange={(value) => set(p.name, value)}
            />
            ),
          )}
        </FieldGroup>
      )}
    </>
  );
}

function ParameterInput({
  parameter: p,
  value,
  registered,
  refs,
  diagnostics,
  onChange,
}: {
  parameter: PlanParameter;
  value: unknown;
  registered: string[];
  refs: Ref[];
  diagnostics: Diagnostic[];
  onChange: (value: unknown) => void;
}) {
  const kind = inputKind(p);
  const label = `${p.name}${isRequired(p) ? " *" : ""}`;
  const placeholder = p.default !== undefined ? `default: ${p.default}` : "required";
  const range = [p.min !== undefined && `≥ ${p.min}`, p.max !== undefined && `≤ ${p.max}`].filter(Boolean).join(", ");

  let input;
  if (isTemplate(value)) {
    // Filled in at run time from an earlier step.
    input = (
      <div className="ref-value">
        <span className="mono">{refs.find((r) => r.value === value)?.label ?? String(value)}</span>
        <button type="button" className="ref-value__clear" onClick={() => onChange(null)} title="Type a value instead">
          ×
        </button>
      </div>
    );
  } else if (kind === "enum") {
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
      <div className="param-row">
        {input}
        {refs.length > 0 && kind !== "enum" && !isTemplate(value) && (
          <select
            className="param-row__ref"
            value=""
            title="Take the value from an earlier step"
            onChange={(e) => e.target.value && onChange(e.target.value)}
          >
            <option value="">from step…</option>
            {refs.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>
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
