/**
 * Lab layout (plan §10): the isometric floor plan of one bench, with
 * click-to-inspect and drag-to-move.
 *
 * This is M1's actual exit criterion — "a real lab room is modelled **and
 * renders correctly**". The Topology screen shows the same registry as a
 * tree; this shows it as the room.
 *
 * Scope, stated plainly so it isn't mistaken for the whole of §10:
 * - Renders one bench at a time. Multi-bench rooms and zone drawing are not
 *   here; the bench is the unit that carries a grid in the model (§5.1).
 * - Editing is limited to moving a station between cells. Creating and
 *   deleting stations, resizing benches, multi-select, align/distribute,
 *   copy-paste and undo/redo (§10.3's editor affordances) are not built.
 * - The live-status, sample-occupancy, transport-route and utilisation
 *   layers need the M2 device plane. The layer toggles here cover only what
 *   the registry can actually answer today.
 */

import { useCallback, useMemo, useState } from "react";

import { fetchTopology, moveStation } from "../../api/topology";
import { listDevices } from "../../api/devices";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import type { GridCell, PlacedStation } from "./isometric";
import { placeStations, placementProblems } from "./isometric";
import { LayoutInspector } from "./LayoutInspector";
import { useIsometricPaper } from "./useIsometricPaper";

import "./LayoutScreen.css";

/** One fetch for the whole screen: topology plus devices for the badges. */
async function fetchLayout() {
  const [topology, devices] = await Promise.all([
    fetchTopology(),
    // High limit rather than paging: the canvas needs every device that
    // might be bound to a station on screen, and a lab has tens.
    listDevices({ limit: 1000 }),
  ]);
  return { topology, devices: devices.items };
}

export function LayoutScreen() {
  const layout = useAsync(useCallback(fetchLayout, []));
  const [benchCode, setBenchCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const benches = layout.data?.topology.benches ?? [];
  // Default to the first bench, but let an explicit choice win.
  const bench = benches.find((b) => b.code === benchCode) ?? benches[0] ?? null;

  const placed = useMemo(
    () =>
      bench && layout.data
        ? placeStations(layout.data.topology.stations, layout.data.devices, bench)
        : [],
    [bench, layout.data],
  );

  const problems = useMemo(
    () => (bench ? placementProblems(placed, bench) : []),
    [placed, bench],
  );

  const selected = placed.find((p) => p.station.code === selectedCode) ?? null;

  const onMove = useCallback(
    async (target: PlacedStation, cell: GridCell) => {
      if (!bench) return;
      // Refuse before writing rather than letting the registry hold a
      // station that isn't on its own bench.
      if (cell.col < 0 || cell.col >= bench.grid_cols || cell.row < 0 || cell.row >= bench.grid_rows) {
        setError(
          `${target.station.code} can't move to (${cell.col}, ${cell.row}) — outside the ${bench.grid_cols}×${bench.grid_rows} grid.`,
        );
        layout.reload();
        return;
      }
      setError(null);
      try {
        await moveStation(target.station, bench.code, cell);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      // Reload either way: the canvas holds no authoritative state (§10.3),
      // so a failed write simply snaps the tile back where it was.
      layout.reload();
    },
    [bench, layout],
  );

  const containerRef = useIsometricPaper({
    cols: bench?.grid_cols ?? 0,
    rows: bench?.grid_rows ?? 0,
    placed,
    selectedCode,
    showLabels,
    showFloor,
    editable,
    onSelect: setSelectedCode,
    onMove,
  });

  return (
    <>
      <ScreenHeader
        title="Lab layout"
        subtitle={
          bench
            ? `${bench.code} · ${bench.grid_cols}×${bench.grid_rows} grid · ${placed.length} stations`
            : "Isometric floor plan (§10)"
        }
        actions={
          <>
            <Button
              variant={editable ? "primary" : "secondary"}
              onClick={() => setEditable((on) => !on)}
            >
              {editable ? "Editing" : "Operations"}
            </Button>
            <Button onClick={layout.reload}>Refresh</Button>
          </>
        }
      />

      <div className="screen">
        <div className="screen__content layout__content">
          <AsyncBoundary
            state={layout}
            isEmpty={(data) => data.topology.benches.length === 0}
            empty={
              <p>
                No benches registered. Import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {() => (
              <>
                <div className="toolbar">
                  <label className="label" htmlFor="layout-bench">
                    Bench
                  </label>
                  <select
                    id="layout-bench"
                    value={bench?.code ?? ""}
                    onChange={(e) => {
                      setBenchCode(e.target.value);
                      setSelectedCode(null);
                    }}
                  >
                    {benches.map((b) => (
                      <option key={b.id} value={b.code}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>

                  <span className="label">Layers</span>
                  <label className="layout__toggle">
                    <input
                      type="checkbox"
                      checked={showFloor}
                      onChange={(e) => setShowFloor(e.target.checked)}
                    />
                    Floor grid
                  </label>
                  <label className="layout__toggle">
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={(e) => setShowLabels(e.target.checked)}
                    />
                    Labels
                  </label>

                  <span className="toolbar__spacer label">
                    {editable ? "Drag a station to move it" : "Read-only"}
                  </span>
                </div>

                {error && (
                  <p className="layout__error" role="alert">
                    {error}
                  </p>
                )}

                {problems.length > 0 && (
                  <div className="layout__problems" role="alert">
                    <p className="label">Not drawn correctly</p>
                    <ul>
                      {problems.map((p) => (
                        <li key={p.code} className="mono">
                          {p.code}: {p.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="layout__paper" ref={containerRef} />

                <dl className="layout__legend">
                  <div>
                    <dt className="layout__swatch layout__swatch--ok" />
                    <dd className="label">Read/write</dd>
                  </div>
                  <div>
                    <dt className="layout__swatch layout__swatch--info" />
                    <dd className="label">Read only</dd>
                  </div>
                  <div>
                    <dt className="layout__swatch layout__swatch--warn" />
                    <dd className="label">Maintenance</dd>
                  </div>
                  <div>
                    <dt className="layout__swatch layout__swatch--off" />
                    <dd className="label">Disabled</dd>
                  </div>
                  <div>
                    <dt className="layout__swatch layout__swatch--empty" />
                    <dd className="label">No device bound</dd>
                  </div>
                </dl>
              </>
            )}
          </AsyncBoundary>
        </div>

        <LayoutInspector
          placed={selected}
          benchCode={bench?.code ?? ""}
          onClose={() => setSelectedCode(null)}
        />
      </div>
    </>
  );
}
