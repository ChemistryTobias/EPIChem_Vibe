/**
 * Lab layout (plan §10): the isometric floor plan, one editor over three levels
 * (ADR 0012) — Site → Lab → Station, drilling down by clicking a box and back up
 * via the breadcrumb. Each level is the *same* canvas; only the data and the
 * write endpoints differ (`levels.ts`).
 *
 * The canvas is full-bleed: it fills everything the shell leaves it (header, nav,
 * inspector) and re-fits as that space changes (`useIsometricPaper`). The
 * controls — a drill-down breadcrumb, Back, add/edit-floor, and the 2D/isometric
 * toggle — float over the canvas in a `.canvas-overlay`, so the drawing owns the
 * whole area. The one thing in the screen header is the Edit ↔ Inspect toggle.
 *
 * Scope, stated plainly:
 * - Renders one level's floor at a time (a metric canvas, ADR 0010): the site
 *   holds labs, a lab holds stations, a station holds devices/modules — each a
 *   box placed in metres (the station level converts device mm at its boundary).
 *   A multi-floor site (ADR 0013) shows a floor picker; only that floor's labs
 *   draw.
 * - The editor (edit mode) does the §10.3 affordances: add a standard-size child
 *   at the origin; drag a box to move it; edit a box's geometry (position,
 *   footprint, height) numerically or with drag handles; remove a box (hard for
 *   labs, soft-hide for stations/devices, ADR 0011); resize the floor/grid.
 * - Not here: zones (they classify, they aren't placed — ADR 0010/0012), and the
 *   live-status/occupancy/utilisation layers, which need live device state.
 */

import { useCallback, useMemo, useState } from "react";

import { fetchTopology } from "../../api/topology";
import { listDevices } from "../../api/devices";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import { Breadcrumb } from "./Breadcrumb";
import type { FloorPos, Projection } from "./isometric";
import { boxProblems } from "./isometric";
import { LayoutInspector } from "./LayoutInspector";
import { FloorForm, GeometryForm } from "./layoutForms";
import { buildLevel } from "./levels";
import type { LayoutData, LevelContext } from "./levels";
import { useIsometricPaper } from "./useIsometricPaper";

import "./LayoutScreen.css";

/** One fetch for the whole screen: topology plus devices for every level. */
async function fetchLayout() {
  const [topology, devices] = await Promise.all([
    fetchTopology(),
    // High limit rather than paging: the canvas needs every device that might be
    // placed at some level, and a lab has tens.
    listDevices({ limit: 1000 }),
  ]);
  return { topology, devices: devices.items };
}

const EMPTY: LayoutData = { sites: [], labs: [], zones: [], stations: [], devices: [] };

export function LayoutScreen() {
  const layout = useAsync(useCallback(fetchLayout, []));
  const [siteCode, setSiteCode] = useState<string | null>(null);
  const [floor, setFloor] = useState(0);
  const [labCode, setLabCode] = useState<string | null>(null);
  const [stationCode, setStationCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [projection, setProjection] = useState<Projection>("iso");
  const [editable, setEditable] = useState(false);
  const [editingGeom, setEditingGeom] = useState(false);
  const [editingFloor, setEditingFloor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data: LayoutData = useMemo(
    () =>
      layout.data
        ? {
            sites: layout.data.topology.sites,
            labs: layout.data.topology.labs,
            zones: layout.data.topology.zones,
            stations: layout.data.topology.stations,
            devices: layout.data.devices,
          }
        : EMPTY,
    [layout.data],
  );

  // The navigation path resolves to rows; the site defaults to the first one.
  const site = data.sites.find((s) => s.code === siteCode) ?? data.sites[0] ?? null;
  const lab = labCode ? (data.labs.find((l) => l.code === labCode) ?? null) : null;
  const station = stationCode ? (data.stations.find((s) => s.code === stationCode) ?? null) : null;
  const ctx: LevelContext = { site, lab, station, floor };

  const level = useMemo(() => buildLevel(ctx, data), [ctx, data]);

  const problems = useMemo(
    () => boxProblems(level.model.boxes, level.model.widthU, level.model.depthU),
    [level],
  );

  const closeForms = () => {
    setEditingGeom(false);
    setEditingFloor(false);
  };

  const selectBox = useCallback((code: string | null) => {
    setSelectedCode(code);
    setEditingGeom(false);
    setEditingFloor(false);
  }, []);

  const onMove = useCallback(
    async (code: string, pos: FloorPos) => {
      const current = level.geometryOf(code);
      if (!current) return;
      setError(null);
      try {
        await level.setGeometry(code, { ...current, pos });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      // Reload either way: the canvas holds no authoritative state (§10.3), so a
      // failed write simply snaps the box back where it was.
      layout.reload();
    },
    [level, layout],
  );

  const onReshape = useCallback(
    async (code: string, size: { x: number; y: number }, height: number) => {
      const current = level.geometryOf(code);
      if (!current) return;
      setError(null);
      try {
        await level.setGeometry(code, { pos: current.pos, size, height });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      layout.reload();
    },
    [level, layout],
  );

  const containerRef = useIsometricPaper({
    model: level.model,
    projection,
    selectedCode,
    showLabels: true,
    editable,
    onSelect: selectBox,
    onMove,
    onReshape,
  });

  // ---- navigation ----------------------------------------------------------

  const enter = (code: string) => {
    const patch = level.drillInto(code);
    if (!patch) return;
    if (patch.lab) setLabCode(patch.lab.code);
    if (patch.station) setStationCode(patch.station.code);
    selectBox(null);
  };

  const goToSite = () => {
    setLabCode(null);
    setStationCode(null);
    selectBox(null);
  };
  const goToLab = () => {
    setStationCode(null);
    selectBox(null);
  };
  const back = () => {
    if (station) goToLab();
    else if (lab) goToSite();
  };

  // Breadcrumb jumps: pick a site/floor resets to that site's plan; enter a lab
  // or a station descends there directly (the breadcrumb can cross levels, so it
  // sets context rather than going through `drillInto`).
  const pickSite = (code: string) => {
    setSiteCode(code);
    setFloor(0);
    goToSite();
  };
  const pickFloor = (f: number) => {
    setFloor(f);
    goToSite();
  };
  const enterLab = (code: string) => {
    setLabCode(code);
    setStationCode(null);
    selectBox(null);
  };
  const enterStation = (code: string) => {
    setStationCode(code);
    selectBox(null);
  };

  const addChild = async () => {
    setError(null);
    try {
      const code = await level.create();
      layout.reload();
      selectBox(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const canEditFloor = level.level !== "station";

  return (
    <>
      <ScreenHeader
        title="Device management — Lab layout"
        subtitle={
          site
            ? `${level.level} · ${level.model.widthU}×${level.model.depthU} m · ${level.model.boxes.length} ${level.childLabel}s`
            : "Isometric floor plan (§10)"
        }
        actions={
          <Button
            variant={editable ? "primary" : "secondary"}
            onClick={() =>
              setEditable((on) => {
                if (on) closeForms();
                return !on;
              })
            }
          >
            {editable ? "Inspect layout" : "Edit layout"}
          </Button>
        }
      />

      <div className="screen">
        <div className="screen__content layout__content">
          <AsyncBoundary
            state={layout}
            isEmpty={(d) => d.topology.sites.length === 0}
            empty={
              <p>
                No sites registered. Import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {() => (
              <>
                <div className="canvas" ref={containerRef} />

                <div className="canvas-overlay">
                  <div className="canvas-overlay__bar">
                    <Breadcrumb
                      sites={data.sites}
                      labs={data.labs}
                      stations={data.stations}
                      site={site}
                      lab={lab}
                      station={station}
                      floor={floor}
                      level={level.level}
                      onPickSite={pickSite}
                      onPickFloor={pickFloor}
                      onEnterLab={enterLab}
                      onEnterStation={enterStation}
                      onGoToSite={goToSite}
                      onGoToLab={goToLab}
                    />

                    <span className="canvas-overlay__spacer" />

                    <Button onClick={back} disabled={!lab && !station}>
                      ← Back
                    </Button>
                    {editable && (
                      <>
                        <Button variant="primary" onClick={addChild}>
                          + Add {level.childLabel}
                        </Button>
                        {canEditFloor && (
                          <Button
                            onClick={() => {
                              selectBox(null);
                              setEditingFloor(true);
                            }}
                          >
                            Edit floor
                          </Button>
                        )}
                      </>
                    )}
                    <Button onClick={() => setProjection((p) => (p === "iso" ? "2d" : "iso"))}>
                      {projection === "iso" ? "2D view" : "Isometric"}
                    </Button>
                  </div>

                  {error && (
                    <div className="canvas-overlay__panel canvas-overlay__panel--error" role="alert">
                      {error}
                    </div>
                  )}

                  {problems.length > 0 && (
                    <div className="canvas-overlay__panel canvas-overlay__panel--warn" role="alert">
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
                </div>
              </>
            )}
          </AsyncBoundary>
        </div>

        {editingFloor ? (
          <FloorForm
            level={level}
            onDone={() => {
              setEditingFloor(false);
              layout.reload();
            }}
            onCancel={() => setEditingFloor(false)}
          />
        ) : editingGeom && selectedCode ? (
          <GeometryForm
            level={level}
            code={selectedCode}
            onDone={() => {
              setEditingGeom(false);
              layout.reload();
            }}
            onCancel={() => setEditingGeom(false)}
          />
        ) : (
          <LayoutInspector
            level={level}
            code={selectedCode}
            editable={editable}
            onEnter={enter}
            onEditGeometry={() => setEditingGeom(true)}
            onRemoved={() => {
              selectBox(null);
              layout.reload();
            }}
            onClose={() => selectBox(null)}
          />
        )}
      </div>
    </>
  );
}
