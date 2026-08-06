/**
 * Samples screen: search/filter, register, and a table of the real rows in
 * the `samples` table — `GET /api/v1/samples` (ADR 0005). No fixtures.
 */

import { useCallback, useMemo, useState } from "react";

import { listSamples } from "../../api/samples";
import { SAMPLE_STATES } from "../../api/types";
import type { Sample } from "../../api/types";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import { NewSampleForm } from "./NewSampleForm";
import { SampleInspector } from "./SampleInspector";
import { SampleTable } from "./SampleTable";

import "./SamplesScreen.css";

export function SamplesScreen() {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const samples = useAsync(
    useCallback(
      () => listSamples({ q: q || undefined, state: state || undefined }),
      [q, state],
    ),
  );

  // Track the selection by id and look the row up again on each render, so
  // the inspector shows the *fresh* row after a write rather than the stale
  // object that was clicked.
  const selected = useMemo(
    () => (samples.data ?? []).find((s) => s.id === selectedId) ?? null,
    [samples.data, selectedId],
  );

  const handleSelect = (sample: Sample) => setSelectedId(sample.id);

  return (
    <>
      <ScreenHeader
        title="Samples"
        subtitle="Registered samples (§7.1, minimal model — see ADR 0005)."
        actions={
          <>
            <Button onClick={() => setCreating((open) => !open)}>
              {creating ? "Close form" : "New sample"}
            </Button>
            <Button variant="primary" onClick={samples.reload}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="screen">
        <div className="screen__content">
          {creating && (
            <NewSampleForm
              onCreated={() => {
                setCreating(false);
                samples.reload();
              }}
              onCancel={() => setCreating(false)}
            />
          )}

          <div className="toolbar">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search code, name or substance"
              aria-label="Search samples"
            />

            <label className="label" htmlFor="sample-state">
              State
            </label>
            <select id="sample-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All</option>
              {SAMPLE_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <span className="toolbar__spacer label">{(samples.data ?? []).length} shown</span>
          </div>

          <AsyncBoundary
            state={samples}
            isEmpty={(rows) => rows.length === 0}
            empty={
              <p>
                No samples yet. Use <strong>New sample</strong> above, or{" "}
                <code className="mono">epichem sample add SMP-2026-0001 &quot;First sample&quot;</code>.
              </p>
            }
          >
            {(rows) => (
              <SampleTable samples={rows} selectedId={selectedId} onSelect={handleSelect} />
            )}
          </AsyncBoundary>
        </div>

        <SampleInspector
          sample={selected}
          onChanged={samples.reload}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </>
  );
}
