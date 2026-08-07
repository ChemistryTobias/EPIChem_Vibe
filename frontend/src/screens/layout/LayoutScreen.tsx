/**
 * Lab layout (plan §10): the isometric floor plan of one metric lab canvas,
 * with click-to-inspect and drag-to-move.
 *
 * This is M1's actual exit criterion — "a real lab room is modelled **and
 * renders correctly**". The Topology screen shows the same registry as a
 * tree; this shows it as the room.
 *
 * Scope, stated plainly so it isn't mistaken for the whole of §10:
 * - Renders one lab at a time. The lab is a metric canvas (ADR 0010:
 *   width_m × depth_m floor, grid_size_m raster).
 * - The editor (edit mode) does the backend-backed §10.3 affordances: drag a
 *   station to move it; draw a footprint on empty floor to create one (live
 *   isometric preview, snapped); edit a station's geometry (position, footprint,
 *   height) or delete it from the inspector; and edit the lab's canvas/grid.
 *   All full-replace writes through the same registry the tree writes to.
 * - Not here (no backend fields for them yet): zone rectangles and the
 *   per-station device/module sub-layout — Zone/Device carry no 2-D geometry in
 *   the schema. Nor canvas drag-handles (resize is numeric in the inspector),
 *   multi-select, align/distribute, copy-paste, undo/redo, or the site floorplan.
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
import type { DrawnRect, FloorPos, PlacedStation } from "./isometric";
import { placeStations, placementProblems } from "./isometric";
import { LabCanvasForm } from "./LabCanvasForm";
import { LayoutInspector } from "./LayoutInspector";
import { StationForm } from "./StationForm";
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
  const [labCode, setLabCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which editor form (if any) fills the inspector column. At most one at a time.
  const [editingLab, setEditingLab] = useState(false);
  const [stationDraft, setStationDraft] = useState<DrawnRect | null>(null);
  const [editingGeom, setEditingGeom] = useState(false);

  const closeForms = () => {
    setEditingLab(false);
    setStationDraft(null);
    setEditingGeom(false);
  };

  const labs = layout.data?.topology.labs ?? [];
  // Default to the first lab, but let an explicit choice win.
  const lab = labs.find((l) => l.code === labCode) ?? labs[0] ?? null;

  const placed = useMemo(
    () =>
      lab && layout.data
        ? placeStations(layout.data.topology.stations, layout.data.devices, lab)
        : [],
    [lab, layout.data],
  );

  const problems = useMemo(() => (lab ? placementProblems(placed, lab) : []), [placed, lab]);

  const selected = placed.find((p) => p.station.code === selectedCode) ?? null;

  // The lab's site code — the lab row only carries site_id, but a full-replace
  // PUT of the lab wants the code.
  const siteCode =
    (lab && layout.data?.topology.sites.find((s) => s.id === lab.site_id)?.code) || "";

  // A station's zone code, for the full-replace PUT (a station may sit in a zone).
  const zoneCodeOf = useCallback(
    (zoneId: string | null) =>
      zoneId ? (layout.data?.topology.zones.find((z) => z.id === zoneId)?.code ?? null) : null,
    [layout.data],
  );

  const onMove = useCallback(
    async (target: PlacedStation, pos: FloorPos) => {
      if (!lab) return;
      // Snap-but-not-bound (ADR 0010): a box may land partly off the floor;
      // that's a warning (see placementProblems), not a refused write.
      setError(null);
      try {
        await moveStation(target.station, lab.code, zoneCodeOf(target.station.zone_id), pos);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      // Reload either way: the canvas holds no authoritative state (§10.3),
      // so a failed write simply snaps the box back where it was.
      layout.reload();
    },
    [lab, layout, zoneCodeOf],
  );

  const onDrawStation = useCallback((rect: DrawnRect) => {
    // A footprint was drawn on empty floor: open the create form on it.
    setEditingLab(false);
    setEditingGeom(false);
    setSelectedCode(null);
    setStationDraft(rect);
  }, []);

  const containerRef = useIsometricPaper({
    lab,
    placed,
    selectedCode,
    showLabels,
    showFloor,
    editable,
    onSelect: setSelectedCode,
    onMove,
    onDrawStation,
  });

  return (
    <>
      <ScreenHeader
        title="Device management — Lab layout"
        subtitle={
          lab
            ? `${lab.code} · ${lab.width_m}×${lab.depth_m} m floor · ${lab.grid_size_m} m grid · ${placed.length} stations`
            : "Isometric floor plan (§10)"
        }
        actions={
          <>
            <Button
              variant={editable ? "primary" : "secondary"}
              onClick={() =>
                setEditable((on) => {
                  if (on) closeForms(); // leaving edit mode closes any open form
                  return !on;
                })
              }
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
            isEmpty={(data) => data.topology.labs.length === 0}
            empty={
              <p>
                No labs registered. Import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {() => (
              <>
                <div className="toolbar">
                  <label className="label" htmlFor="layout-lab">
                    Lab
                  </label>
                  <select
                    id="layout-lab"
                    value={lab?.code ?? ""}
                    onChange={(e) => {
                      setLabCode(e.target.value);
                      setSelectedCode(null);
                    }}
                  >
                    {labs.map((l) => (
                      <option key={l.id} value={l.code}>
                        {l.code} — {l.name}
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

                  {editable && lab && (
                    <Button
                      onClick={() => {
                        closeForms();
                        setSelectedCode(null);
                        setEditingLab(true);
                      }}
                    >
                      Edit lab
                    </Button>
                  )}

                  <span className="toolbar__spacer label">
                    {editable
                      ? "Drag empty floor to draw a station · drag a station to move it"
                      : "Read-only"}
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

        {editingLab && lab ? (
          <LabCanvasForm
            lab={lab}
            siteCode={siteCode}
            onDone={() => {
              setEditingLab(false);
              layout.reload();
            }}
            onCancel={() => setEditingLab(false)}
          />
        ) : stationDraft && lab ? (
          <StationForm
            mode="create"
            lab={lab}
            rect={stationDraft}
            onDone={() => {
              setStationDraft(null);
              layout.reload();
            }}
            onCancel={() => setStationDraft(null)}
          />
        ) : editingGeom && selected && lab ? (
          <StationForm
            mode="reshape"
            lab={lab}
            station={selected.station}
            zoneCode={zoneCodeOf(selected.station.zone_id)}
            onDone={() => {
              setEditingGeom(false);
              layout.reload();
            }}
            onCancel={() => setEditingGeom(false)}
          />
        ) : (
          <LayoutInspector
            placed={selected}
            labCode={lab?.code ?? ""}
            editable={editable}
            onClose={() => setSelectedCode(null)}
            onEditGeometry={() => setEditingGeom(true)}
            onDeleted={() => {
              setSelectedCode(null);
              layout.reload();
            }}
          />
        )}
      </div>
    </>
  );
}
