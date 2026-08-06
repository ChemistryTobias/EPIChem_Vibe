/**
 * Inline "register a sample" form — POST /api/v1/samples.
 *
 * A panel above the table rather than a modal: no focus-trap or scroll-lock
 * machinery to get subtly wrong, and the table stays visible while you type
 * (useful for picking the next free code).
 *
 * Everything optional is sent as null rather than "" so the backend stores a
 * real absence, matching `SampleWrite`'s `str | None` fields.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { createSample } from "../../api/samples";
import { Button } from "../../components/Button";
import { SAMPLE_STATES } from "../../api/types";
import type { SampleState } from "../../api/types";

interface NewSampleFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

const emptyToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function NewSampleForm({ onCreated, onCancel }: NewSampleFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<SampleState>("registered");
  const [substance, setSubstance] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createSample({
        code: code.trim(),
        name: name.trim(),
        state,
        substance: emptyToNull(substance),
        amount_value: amount.trim() === "" ? null : Number(amount),
        amount_unit: emptyToNull(unit),
        location: emptyToNull(location),
        owner: emptyToNull(owner),
        notes: emptyToNull(notes),
      });
      onCreated();
    } catch (cause) {
      // The backend's problem+json title/detail is the useful message here
      // (e.g. "Sample already exists: Sample with code=... already exists").
      setError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  }

  return (
    <form className="new-sample" onSubmit={submit}>
      <p className="label new-sample__title">Register a sample</p>

      <div className="new-sample__grid">
        <label>
          <span className="label">Code *</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SMP-2026-0041"
            required
          />
        </label>

        <label className="new-sample__wide">
          <span className="label">Name *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PEDOT:PSS film, 60 s @ 2000 rpm"
            required
          />
        </label>

        <label>
          <span className="label">State</span>
          <select value={state} onChange={(e) => setState(e.target.value as SampleState)}>
            {SAMPLE_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="label">Substance</span>
          <input value={substance} onChange={(e) => setSubstance(e.target.value)} />
        </label>

        <label>
          <span className="label">Amount</span>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label>
          <span className="label">Unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mL" />
        </label>

        <label>
          <span className="label">Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="RACK-A/3"
          />
        </label>

        <label>
          <span className="label">Owner</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>

        <label className="new-sample__wide">
          <span className="label">Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {error && (
        <p className="new-sample__error" role="alert">
          {error}
        </p>
      )}

      <div className="new-sample__actions">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving…" : "Register"}
        </Button>
        <Button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
