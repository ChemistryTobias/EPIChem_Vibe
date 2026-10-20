/**
 * A selected step's settings, in the inspector: a plan step's station and its
 * generated parameter form, or a flow-control step's own editor — Wait (how
 * long), Input (what to ask and which values to collect), HTTP request (where,
 * how, what to send). Values can come from earlier steps (`{{steps.<id>.…}}`).
 */

import type { Diagnostic, InputField, Palette, ProcedureStep, Station } from "../../api/types";
import { Button } from "../../components/Button";
import { Glyph, stationGlyph } from "../../components/glyphs";
import { Field, FieldGroup } from "../../components/Inspector";
import { StepForm } from "./StepForm";
import { isTemplate } from "./plans";

interface StepSettingsProps {
  step: ProcedureStep;
  stations: Station[];
  palette: Palette | undefined;
  diagnostics: Diagnostic[];
  refs: { value: string; label: string }[];
  onChange: (step: ProcedureStep) => void;
}

export function StepSettings({ step, stations, palette, diagnostics, refs, onChange }: StepSettingsProps) {
  const set = (key: string, value: unknown) => onChange({ ...step, kwargs: { ...step.kwargs, [key]: value } });
  const issues = (parameter: string) =>
    diagnostics
      .filter((d) => d.parameter === parameter)
      .map((d, i) => (
        <p key={i} className={d.severity === "error" ? "create__error" : "step-form__warning"}>
          {d.message}
        </p>
      ));
  const general = diagnostics.filter((d) => !d.parameter);
  const label = (
    <Field label="Label">
      <input
        className="field__input"
        value={step.label ?? ""}
        placeholder="shown on the canvas"
        onChange={(e) => onChange({ ...step, label: e.target.value || null })}
      />
    </Field>
  );

  if ((step.type ?? "plan") === "plan") {
    const offering = stations.filter((s) => s.queueserver_url);
    return (
      <>
        <FieldGroup title="Station">
          <div className="station-choice">
            <Glyph name={stationGlyph(stations.find((s) => s.uuid === step.station_uuid))} size={20} />
            <select
              className="field__input"
              value={step.station_uuid ?? ""}
              onChange={(e) => onChange({ ...step, station_uuid: e.target.value || null })}
            >
              {offering.map((s) => (
                <option key={s.uuid} value={s.uuid}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </FieldGroup>
        <StepForm
          step={step}
          plan={palette?.plans[step.plan]}
          diagnostics={diagnostics}
          registered={palette?.registered ?? []}
          onChange={onChange}
          refs={refs}
        />
      </>
    );
  }

  return (
    <>
      {general.map((d, i) => (
        <p key={i} className={d.severity === "error" ? "create__error" : "step-form__warning"}>
          {d.message}
        </p>
      ))}
      <FieldGroup title="Step">{label}</FieldGroup>

      {step.type === "wait" && (
        <FieldGroup title="Wait">
          <Field label="Duration">
            <DurationInput value={step.kwargs.duration_s} onChange={(v) => set("duration_s", v)} refs={refs} />
            {issues("duration_s")}
          </Field>
          <p className="muted step-form__hint">EPIChem holds the run here; the stations are free meanwhile.</p>
        </FieldGroup>
      )}

      {step.type === "input" && (
        <FieldGroup title="Ask the operator">
          <Field label="Prompt">
            <textarea
              className="field__input field__textarea"
              rows={3}
              value={String(step.kwargs.prompt ?? "")}
              placeholder="e.g. Place a fresh substrate in slot 1, then confirm."
              onChange={(e) => set("prompt", e.target.value)}
            />
            {issues("prompt")}
          </Field>
          <InputFields
            fields={(step.kwargs.fields as InputField[] | undefined) ?? []}
            onChange={(fields) => set("fields", fields)}
          />
          {issues("fields")}
          <p className="muted step-form__hint">
            The run waits until someone answers in Runs. Later steps can use the values, e.g.{" "}
            <span className="mono">{`{{steps.${step.id}.<field>}}`}</span>.
          </p>
        </FieldGroup>
      )}

      {step.type === "http" && (
        <FieldGroup title="Request">
          <Field label="Method and URL">
            <div className="param-row">
              <select
                className="field__input http-method"
                value={String(step.kwargs.method ?? "GET")}
                onChange={(e) => set("method", e.target.value)}
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                className="field__input mono"
                value={String(step.kwargs.url ?? "")}
                placeholder="https://…"
                onChange={(e) => set("url", e.target.value)}
              />
            </div>
            {issues("method")}
            {issues("url")}
          </Field>
          <Field label="Body (JSON)">
            <textarea
              className="field__input field__textarea mono"
              rows={5}
              value={typeof step.kwargs.body === "string" ? step.kwargs.body : JSON.stringify(step.kwargs.body ?? "", null, 2)}
              placeholder={'{"sample": "{{steps.<id>.<field>}}"}'}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <Field label="Expect status">
            <input
              className="field__input mono"
              type="number"
              placeholder="any 2xx"
              value={step.kwargs.expect_status === undefined || step.kwargs.expect_status === null ? "" : String(step.kwargs.expect_status)}
              onChange={(e) => set("expect_status", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          {refs.length > 0 && (
            <Field label="Insert a value from an earlier step">
              <select
                className="field__input"
                value=""
                onChange={(e) => e.target.value && set("body", `${typeof step.kwargs.body === "string" ? step.kwargs.body : ""}${e.target.value}`)}
              >
                <option value="">append to the body…</option>
                {refs.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="muted step-form__hint">
            EPIChem makes the request; the response is the step&apos;s output (<span className="mono">status</span>,{" "}
            <span className="mono">json</span>) for later steps. A non-2xx answer fails the run.
          </p>
        </FieldGroup>
      )}
    </>
  );
}

const UNITS = [
  { label: "s", factor: 1 },
  { label: "min", factor: 60 },
  { label: "h", factor: 3600 },
];

function DurationInput({ value, onChange, refs }: { value: unknown; onChange: (v: unknown) => void; refs: { value: string; label: string }[] }) {
  if (isTemplate(value)) {
    return (
      <div className="ref-value">
        <span className="mono">{refs.find((r) => r.value === value)?.label ?? String(value)}</span>
        <button type="button" className="ref-value__clear" onClick={() => onChange(60)}>
          ×
        </button>
      </div>
    );
  }
  const seconds = Number(value) || 0;
  const unit = [...UNITS].reverse().find((u) => seconds >= u.factor && seconds % u.factor === 0) ?? UNITS[0];
  return (
    <div className="param-row">
      <input
        className="field__input mono"
        type="number"
        min={0}
        step="any"
        value={seconds / unit.factor}
        onChange={(e) => onChange(Number(e.target.value) * unit.factor)}
      />
      <select className="param-row__ref" value={unit.label} onChange={(e) => onChange((seconds / unit.factor) * UNITS.find((u) => u.label === e.target.value)!.factor)}>
        {UNITS.map((u) => (
          <option key={u.label}>{u.label}</option>
        ))}
      </select>
      {refs.length > 0 && (
        <select className="param-row__ref" value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">from step…</option>
          {refs.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function InputFields({ fields, onChange }: { fields: InputField[]; onChange: (fields: InputField[]) => void }) {
  const update = (i: number, patch: Partial<InputField>) => onChange(fields.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  return (
    <Field label="Values to collect">
      {fields.length === 0 && <p className="muted step-form__hint">None — the operator just confirms.</p>}
      {fields.map((f, i) => (
        <div key={i} className="input-field-row">
          <input
            className="field__input mono"
            placeholder="name"
            value={f.name}
            onChange={(e) => update(i, { name: e.target.value.replace(/\W/g, "_") })}
          />
          <input className="field__input" placeholder="label" value={f.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} />
          <select className="field__input" value={f.type ?? "text"} onChange={(e) => update(i, { type: e.target.value as InputField["type"] })}>
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="boolean">yes/no</option>
          </select>
          <label className="input-field-row__req" title="Required">
            <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => update(i, { required: e.target.checked })} /> req.
          </label>
          <button type="button" className="ref-value__clear" onClick={() => onChange(fields.filter((_, n) => n !== i))} title="Remove">
            ×
          </button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...fields, { name: `value${fields.length + 1}`, type: "number", required: true }])}>
        Add a value
      </Button>
    </Field>
  );
}
