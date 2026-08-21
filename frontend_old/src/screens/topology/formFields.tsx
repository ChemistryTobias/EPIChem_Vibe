/**
 * The small labelled-field primitives shared by the Create and Edit inspectors
 * (ADR 0009). One copy, since both forms lay fields out the same way; they use
 * the `.create-form` classes in `create/CreateInspector.css`.
 */

import type { ReactNode } from "react";

import "./formFields.css";

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  /** `step="any"` on a number field so the browser accepts non-integer metres. */
  step?: string;
}) {
  return (
    <label className="create-form__field">
      <span className="label">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        step={step}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="create-form__field">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A required parent picker (or optional, with a "— none —" choice). */
export function ParentSelect({
  label,
  options,
  value,
  onChange,
  optional,
}: {
  label: string;
  options: { id: string; code: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}): ReactNode {
  return (
    <label className="create-form__field">
      <span className="label">
        {label}
        {optional ? "" : " *"}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={!optional}>
        {optional && <option value="">— none —</option>}
        {options.map((o) => (
          <option key={o.id} value={o.code}>
            {o.code} — {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
