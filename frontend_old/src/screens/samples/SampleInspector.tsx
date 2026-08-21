/**
 * Right-hand detail panel for the selected sample, with the two writes this
 * screen supports: advance the lifecycle state, and delete.
 *
 * The state change is a PUT of the *whole* row with one field swapped —
 * `PUT /api/v1/samples/{ident}` is a full replace (ADR 0005), so sending a
 * partial body would silently blank the rest. `toWriteBody` below is the one
 * place that conversion happens.
 *
 * Note what this panel does *not* claim: there is no lineage, no event
 * history, no container. Those are §7.4/§7.3/§7.1 and belong to M4 — see
 * `backend/epichem/models/sample.py` for the full list of deferrals.
 */

import { useState } from "react";

import { deleteSample, replaceSample } from "../../api/samples";
import { Button } from "../../components/Button";
import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import { SAMPLE_STATES } from "../../api/types";
import type { Sample, SampleState, SampleWrite } from "../../api/types";
import { formatAmount, humanState, sampleTone } from "./sampleTone";

/** Sample (response) -> SampleWrite (request body). */
function toWriteBody(sample: Sample): SampleWrite {
  return {
    code: sample.code,
    name: sample.name,
    state: sample.state as SampleState,
    substance: sample.substance,
    amount_value: sample.amount_value,
    amount_unit: sample.amount_unit,
    location: sample.location,
    owner: sample.owner,
    notes: sample.notes,
  };
}

interface SampleInspectorProps {
  sample: Sample | null;
  /** Re-fetch the list after a write. */
  onChanged: () => void;
  onClose: () => void;
}

export function SampleInspector({ sample, onChanged, onClose }: SampleInspectorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!sample) {
    return (
      <Inspector kind="Sample inspector" placeholder="Select a sample to see its record." />
    );
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const changeState = (next: SampleState) =>
    run(() => replaceSample(sample.code, { ...toWriteBody(sample), state: next }));

  const remove = () =>
    run(async () => {
      await deleteSample(sample.code);
      setConfirmingDelete(false);
      onClose();
    });

  return (
    <Inspector
      kind="Sample inspector"
      title={sample.name}
      subtitle={sample.code}
      onClose={onClose}
    >
      <FieldGroup title="State">
        <Field label="Current">
          <StatusDot tone={sampleTone(sample.state)} label={humanState(sample.state)} />
        </Field>
        <Field label="Move to">
          <select
            value={sample.state}
            disabled={busy}
            onChange={(e) => changeState(e.target.value as SampleState)}
          >
            {SAMPLE_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {/* Honest about what the backend does and doesn't check. */}
        <p className="inspector__note muted">
          Any state is accepted — transition rules need §7.3&apos;s event log (M4).
        </p>
      </FieldGroup>

      <FieldGroup title="Sample">
        <Field label="Substance">{sample.substance}</Field>
        <Field label="Amount" mono>
          {formatAmount(sample.amount_value, sample.amount_unit)}
        </Field>
        <Field label="Location" mono>
          {sample.location}
        </Field>
        <Field label="Owner">{sample.owner}</Field>
        <Field label="Notes">{sample.notes}</Field>
      </FieldGroup>

      <FieldGroup title="Record">
        <Field label="UUID" mono>
          {sample.id}
        </Field>
        <Field label="Created" mono>
          {new Date(sample.created_at).toLocaleString()}
        </Field>
        <Field label="Updated" mono>
          {new Date(sample.updated_at).toLocaleString()}
        </Field>
      </FieldGroup>

      {error && (
        <p className="inspector__error" role="alert">
          {error}
        </p>
      )}

      <div className="inspector__actions">
        {confirmingDelete ? (
          <>
            <Button variant="danger" onClick={remove} disabled={busy}>
              Confirm delete
            </Button>
            <Button onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
            Delete sample
          </Button>
        )}
      </div>
    </Inspector>
  );
}
