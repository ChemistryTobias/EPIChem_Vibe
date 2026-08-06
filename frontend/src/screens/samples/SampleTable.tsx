/**
 * The samples table.
 *
 * A table, deliberately — samples are a list of rows with the same columns,
 * and that is what a table is for. The lineage *graph* §7.4 asks the UI to
 * render is a different screen for a different milestone (M4), and the
 * procedure/workflow editor that will use React Flow is M3. Neither belongs
 * here.
 */

import { StatusDot } from "../../components/StatusDot";
import type { Sample } from "../../api/types";
import { formatAmount, humanState, sampleTone } from "./sampleTone";

interface SampleTableProps {
  samples: Sample[];
  selectedId: string | null;
  onSelect: (sample: Sample) => void;
}

export function SampleTable({ samples, selectedId, onSelect }: SampleTableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="label">State</th>
            <th className="label">Code</th>
            <th className="label">Name</th>
            <th className="label">Substance</th>
            <th className="label">Amount</th>
            <th className="label">Location</th>
            <th className="label">Owner</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr
              key={sample.id}
              className={sample.id === selectedId ? "table__row table__row--selected" : "table__row"}
              onClick={() => onSelect(sample)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(sample);
                }
              }}
            >
              <td>
                <StatusDot tone={sampleTone(sample.state)} label={humanState(sample.state)} />
              </td>
              <td className="mono table__code">{sample.code}</td>
              <td>{sample.name}</td>
              <td>{sample.substance ?? <span className="muted">—</span>}</td>
              <td className="mono">
                {formatAmount(sample.amount_value, sample.amount_unit) ?? (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="mono">{sample.location ?? <span className="muted">—</span>}</td>
              <td>{sample.owner ?? <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
