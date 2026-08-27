/**
 * Sample tracking. Static demo data — the backend has no Sample entity yet
 * (see docs/API.md "What's not here yet"), so this reads from mockSamples.ts
 * rather than the network. The table itself is the real one.
 */

import { useMemo } from "react";

import { Alert } from "../../components/Alert";
import { DataTable } from "../../components/DataTable";
import type { Columns } from "../../components/DataTable";
import { ScreenHeader } from "../../components/ScreenHeader";
import { MOCK_SAMPLES } from "./mockSamples";
import type { Sample } from "./mockSamples";

export function SamplesScreen() {
  const columns: Columns<Sample> = useMemo(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="mono">{c.row.original.code}</span> },
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      { accessorKey: "state", header: "State" },
      { accessorKey: "substance", header: "Substance", cell: (c) => <span className="mono">{c.row.original.substance}</span> },
      { accessorKey: "amount", header: "Amount", cell: (c) => <span className="mono">{c.row.original.amount}</span> },
      { accessorKey: "location", header: "Location", cell: (c) => <span className="mono">{c.row.original.location}</span> },
    ],
    [],
  );

  return (
    <>
      <ScreenHeader title="Samples" subtitle="Sample tracking — mockup" />

      <div className="screen">
        <div className="screen__content">
          <section className="section">
            <Alert kind="info">
              Demo data — the Sample entity doesn't exist in the backend yet. These rows are static.
            </Alert>
          </section>

          <section className="section">
            <DataTable data={MOCK_SAMPLES} columns={columns} />
          </section>
        </div>
      </div>
    </>
  );
}
