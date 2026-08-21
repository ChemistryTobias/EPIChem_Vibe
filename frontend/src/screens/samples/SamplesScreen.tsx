import { useState } from "react";

import { Alert } from "../../components/Alert";
import { Field, Inspector } from "../../components/Inspector";
import { ScreenHeader } from "../../components/ScreenHeader";
import { MOCK_SAMPLES } from "./mockSamples";

import "./SamplesScreen.css";

export function SamplesScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = MOCK_SAMPLES.find((s) => s.uuid === selectedId) ?? null;

  return (
    <>
      <ScreenHeader title="Samples" subtitle="Sample tracking — mockup" />
      <div className="screen">
        <div className="screen__content">
          <Alert kind="info">
            Demo data — the Sample entity doesn't exist in the backend yet. These rows are static.
          </Alert>

          <table className="table">
            <thead>
              <tr>
                <th className="label">Code</th>
                <th className="label">Name</th>
                <th className="label">State</th>
                <th className="label">Substance</th>
                <th className="label">Amount</th>
                <th className="label">Location</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_SAMPLES.map((sample) => (
                <tr
                  key={sample.uuid}
                  className={sample.uuid === selectedId ? "table__row table__row--selected" : "table__row"}
                  onClick={() => setSelectedId(sample.uuid)}
                >
                  <td className="mono">{sample.code}</td>
                  <td>{sample.name}</td>
                  <td>{sample.state}</td>
                  <td className="mono">{sample.substance}</td>
                  <td className="mono">{sample.amount}</td>
                  <td className="mono">{sample.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Inspector
          open={selected != null}
          kind="Sample inspector"
          title={selected?.name}
          subtitle={selected?.code}
          onClose={() => setSelectedId(null)}
        >
          {selected && (
            <>
              <Field label="State">{selected.state}</Field>
              <Field label="Substance">{selected.substance}</Field>
              <Field label="Amount">{selected.amount}</Field>
              <Field label="Location">{selected.location}</Field>
            </>
          )}
        </Inspector>
      </div>
    </>
  );
}
