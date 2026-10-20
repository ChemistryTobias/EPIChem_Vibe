/**
 * Launching a run, in the inspector panel: every run registers the sample it
 * produces (Roadmap 3), so this is where that sample gets its name and what
 * it's made of. All optional — a run gets a sample either way.
 */

import { useState } from "react";

import type { Procedure, Station } from "../../api/types";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Field, FieldGroup } from "../../components/Inspector";

export interface SampleDraft {
  name: string;
  substance: string;
  amount_value: string;
  amount_unit: string;
  description: string;
}

interface RunLauncherProps {
  procedure: Procedure;
  station: Station | undefined;
  blocked: string | null;
  warnings: number;
  starting: boolean;
  error: Error | null;
  onStart: (sample: SampleDraft) => void;
  onCancel: () => void;
}

export function RunLauncher({ procedure, station, blocked, warnings, starting, error, onStart, onCancel }: RunLauncherProps) {
  const [sample, setSample] = useState<SampleDraft>({
    name: "",
    substance: "",
    amount_value: "",
    amount_unit: "",
    description: "",
  });
  const field = (key: keyof SampleDraft, label: string, placeholder?: string) => (
    <Field label={label}>
      <input
        className="field__input"
        value={sample[key]}
        placeholder={placeholder}
        onChange={(e) => setSample((s) => ({ ...s, [key]: e.target.value }))}
      />
    </Field>
  );

  return (
    <>
      <FieldGroup title="Run">
        <Field label="Procedure">{`${procedure.name} · v${procedure.version}`}</Field>
        <Field label="Station">{station?.name}</Field>
        <Field label="Steps">{procedure.steps.length}</Field>
      </FieldGroup>

      <FieldGroup title="Sample it produces">
        {field("name", "Name", `${procedure.name} — RUN-…`)}
        {field("substance", "Substance", "e.g. PEDOT:PSS")}
        <Field label="Amount">
          <div className="field__triple">
            <input
              className="field__input mono"
              type="number"
              min={0}
              step="any"
              value={sample.amount_value}
              onChange={(e) => setSample((s) => ({ ...s, amount_value: e.target.value }))}
            />
            <input
              className="field__input"
              placeholder="unit"
              value={sample.amount_unit}
              onChange={(e) => setSample((s) => ({ ...s, amount_unit: e.target.value }))}
            />
          </div>
        </Field>
        {field("description", "Description")}
      </FieldGroup>

      {blocked && <Alert kind="error">{blocked}</Alert>}
      {!blocked && warnings > 0 && (
        <Alert kind="warning">
          {warnings} warning{warnings === 1 ? "" : "s"} — the run can start, but check the diagnostics.
        </Alert>
      )}
      {error && <Alert kind="error">{error.message}</Alert>}

      <div className="run-launcher__actions">
        <Button variant="primary" disabled={Boolean(blocked) || starting} onClick={() => onStart(sample)}>
          {starting ? "Dispatching…" : "Start run"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      <p className="muted step-form__hint">
        EPIChem validates, registers the sample, and hands the compiled steps to {station?.name ?? "the station"}&apos;s
        queue — the station executes them.
      </p>
    </>
  );
}
