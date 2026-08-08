/**
 * Lab layout (plan §10): the isometric floor plan, one editor over three levels
 * (ADR 0012) — Site → Lab → Station, drilling down by clicking a box's label and
 * back up via the location path. Each level is the *same* canvas; only the data and
 * the write endpoints differ (`levels.ts`).
 *
 * Editing is **staged** (ADR 0014): in edit mode, add/move/resize/remove and
 * floor changes accumulate in a local draft and nothing is written until **Save**;
 * **Cancel** (or trying to leave edit mode) discards them, after a confirm. Level
 * changes are disabled while editing — you save or switch to inspect first. Placement
 * is constrained: a box can't be dragged, resized or typed outside its floor or onto
 * another box, and a new box tiles into the first free slot rather than stacking.
 *
 * The canvas is full-bleed and re-fits to its container (`useIsometricPaper`); the
 * controls float over it in `.canvas-overlay`. Not here: zones (they classify, they
 * aren't placed), and the live-status layers (they need live device state).
 */

import { useCallback, useMemo, useState } from "react";

import { fetchTopology } from "../../api/topology";
import { listDevices } from "../../api/devices";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useNotify } from "../../components/Notifications";
import { useAsync } from "../../hooks/useAsync";
import { LocationPath } from "./LocationPath";
import type { BoxFill, CanvasModel, FloorPos, Projection, RectGeom } from "./isometric";
import { boxProblems, clampToFloor, overlapsAny, placeNextSlot, slidePos, sortBoxes } from "./isometric";
import { LayoutInspector } from "./LayoutInspector";
import { FloorForm, GeometryForm } from "./layoutForms";
import { buildLevel } from "./levels";
import type { BoxGeometry, FloorGeometry, LayoutData, LevelConfig, LevelContext } from "./levels";
import { useIsometricPaper } from "./useIsometricPaper";

import "./LayoutScreen.css";

/** One fetch for the whole screen: topology plus devices for every level. */
async function fetchLayout() {
  const [topology, devices] = await Promise.all([fetchTopology(), listDevices({ limit: 1000 })]);
  return { topology, devices: devices.items };
}

const EMPTY: LayoutData = { sites: [], labs: [], zones: [], stations: [], devices: [] };

/** A box created in the draft but not yet persisted — carries its future code. */
interface DraftCreate {
  code: string;
  geom: BoxGeometry;
}

/** The unsaved edits for the current level, applied over the fetched data. */
interface Draft {
  creates: DraftCreate[];
  edits: Record<string, BoxGeometry>;
  removes: string[];
  floor: FloorGeometry | null;
}

const EMPTY_DRAFT: Draft = { creates: [], edits: {}, removes: [], floor: null };

/** Distinct fill so an unsaved (draft) box reads as "not written yet" — MPG green. */
const NEW_FILL: BoxFill = { top: "#C6D325", left: "#A9B41F", right: "#8C9519" };

const toRect = (b: { pos: FloorPos; size: { x: number; y: number }; height: number }): RectGeom => ({
  pos: b.pos,
  size: b.size,
  height: b.height,
});

export function LayoutScreen() {
  const layout = useAsync(useCallback(fetchLayout, []));
  const [siteCode, setSiteCode] = useState<string | null>(null);
  const [floor, setFloor] = useState(0);
  const [labCode, setLabCode] = useState<string | null>(null);
  const [stationCode, setStationCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [projection, setProjection] = useState<Projection>("iso");
  const [editable, setEditable] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [bump, setBump] = useState(0); // forces a canvas redraw (snap-back on reject)
  const [editingGeom, setEditingGeom] = useState(false);
  const [editingFloor, setEditingFloor] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saving, setSaving] = useState(false);
  const notify = useNotify();

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

  const site = data.sites.find((s) => s.code === siteCode) ?? data.sites[0] ?? null;
  const lab = labCode ? (data.labs.find((l) => l.code === labCode) ?? null) : null;
  const station = stationCode ? (data.stations.find((s) => s.code === stationCode) ?? null) : null;
  const ctx: LevelContext = { site, lab, station, floor };
  const level = useMemo(() => buildLevel(ctx, data), [ctx, data]);

  // ---- draft-aware effective model -----------------------------------------

  const floorEff: FloorGeometry = draft.floor ?? level.floor;

  const effModel: CanvasModel = useMemo(() => {
    const base = level.model.boxes
      .filter((b) => !draft.removes.includes(b.code))
      .map((b) => {
        const e = draft.edits[b.code];
        return e ? { ...b, pos: e.pos, size: e.size, height: e.height } : b;
      });
    const created = draft.creates.map((c) => ({
      code: c.code,
      pos: c.geom.pos,
      size: c.geom.size,
      height: c.geom.height,
      fill: NEW_FILL,
      label: c.code,
      badge: false,
    }));
    return {
      widthU: floorEff.widthU,
      depthU: floorEff.depthU,
      gridU: floorEff.gridU,
      boxes: sortBoxes([...base, ...created]),
      outlines: level.outlines,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, draft, floorEff.widthU, floorEff.depthU, floorEff.gridU, bump]);

  const problems = useMemo(
    () => boxProblems(effModel.boxes, effModel.widthU, effModel.depthU),
    [effModel],
  );

  const isNew = (code: string) => draft.creates.some((c) => c.code === code);
  const isDirty =
    draft.creates.length > 0 ||
    Object.keys(draft.edits).length > 0 ||
    draft.removes.length > 0 ||
    draft.floor !== null;

  const effGeometry = useCallback(
    (code: string): BoxGeometry | null => {
      const created = draft.creates.find((c) => c.code === code);
      if (created) return created.geom;
      if (draft.removes.includes(code)) return null;
      return draft.edits[code] ?? level.geometryOf(code);
    },
    [draft, level],
  );

  // Pull a geometry inside the floor and reject it if it lands on another box.
  const constrain = useCallback(
    (code: string, candidate: BoxGeometry): BoxGeometry | null => {
      const clamped = clampToFloor(candidate, floorEff);
      const others = effModel.boxes.filter((b) => b.code !== code).map(toRect);
      return overlapsAny(clamped, others) ? null : clamped;
    },
    [effModel, floorEff],
  );

  const stageGeometry = useCallback((code: string, geom: BoxGeometry) => {
    setDraft((d) =>
      d.creates.some((c) => c.code === code)
        ? { ...d, creates: d.creates.map((c) => (c.code === code ? { ...c, geom } : c)) }
        : { ...d, edits: { ...d.edits, [code]: geom } },
    );
  }, []);

  const rejected = (verb: string, code: string) => {
    setBump((b) => b + 1); // redraw from the draft → the box snaps back
    notify({
      kind: "warning",
      key: "placement",
      message: `Can't ${verb} ${code} there — it would leave the floor or overlap another ${level.childLabel}.`,
    });
  };

  // ---- canvas interactions (staged) ----------------------------------------

  const selectBox = useCallback((code: string | null) => {
    setSelectedCode(code);
    setEditingGeom(false);
    setEditingFloor(false);
  }, []);

  const onMove = useCallback(
    (code: string, pos: FloorPos) => {
      const cur = effGeometry(code);
      if (!cur) return;
      // Slide the box up against whatever it ran into rather than snapping it
      // back to where the drag started (the isometric-diagram affordance).
      const others = effModel.boxes.filter((b) => b.code !== code).map(toRect);
      const next = slidePos({ pos, size: cur.size, height: cur.height }, floorEff, others, cur.pos);
      stageGeometry(code, next);
    },
    [effGeometry, effModel, floorEff, stageGeometry],
  );

  const onReshape = useCallback(
    (code: string, size: { x: number; y: number }, height: number) => {
      const cur = effGeometry(code);
      if (!cur) return;
      const next = constrain(code, { pos: cur.pos, size, height });
      if (!next) return rejected("resize", code);
      stageGeometry(code, next);
    },
    [effGeometry, constrain, stageGeometry, level.childLabel],
  );

  const { containerRef, zoomIn, zoomOut, resetView } = useIsometricPaper({
    model: effModel,
    projection,
    selectedCode,
    showLabels: true,
    editable,
    onSelect: selectBox,
    onActivate: (code) => {
      if (editable) return selectBox(code); // no drilling while editing
      if (level.drillInto(code)) enter(code);
      else selectBox(code);
    },
    onMove,
    onReshape,
  });

  // ---- navigation (inspect mode only; LocationPath is `locked` in edit) -----

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

  // ---- staged edit actions -------------------------------------------------

  const addChild = () => {
    const size = level.standardSize;
    const pos = placeNextSlot(size, floorEff, effModel.boxes.map(toRect));
    if (!pos) {
      notify({
        kind: "warning",
        key: "placement",
        message: `No room for another ${level.childLabel} — the ${level.level} floor is full.`,
      });
      return;
    }
    const code = level.nextChildCode(draft.creates.map((c) => c.code));
    setDraft((d) => ({
      ...d,
      creates: [...d.creates, { code, geom: { pos, size: { ...size }, height: level.nominalHeight } }],
    }));
    selectBox(code);
  };

  const removeSelected = (code: string) => {
    setDraft((d) =>
      d.creates.some((c) => c.code === code)
        ? { ...d, creates: d.creates.filter((c) => c.code !== code) }
        : {
            ...d,
            removes: [...d.removes, code],
            edits: Object.fromEntries(Object.entries(d.edits).filter(([k]) => k !== code)),
          },
    );
    selectBox(null);
  };

  const stageGeometryForm = (code: string, geom: BoxGeometry): string | null => {
    const next = constrain(code, geom);
    if (!next) return `That would leave the floor or overlap another ${level.childLabel}.`;
    stageGeometry(code, next);
    return null;
  };

  const stageFloor = (f: FloorGeometry): string | null => {
    if (f.widthU <= 0 || f.depthU <= 0 || f.gridU <= 0) return "Floor width, depth and grid must be positive.";
    setDraft((d) => ({ ...d, floor: f }));
    return null;
  };

  // ---- persist / mode transitions ------------------------------------------

  async function save(l: LevelConfig, d: Draft): Promise<boolean> {
    setSaving(true);
    try {
      for (const c of d.creates) await l.create({ code: c.code, geom: c.geom });
      for (const [code, geom] of Object.entries(d.edits)) {
        if (d.removes.includes(code)) continue;
        await l.setGeometry(code, geom);
      }
      for (const code of d.removes) await l.remove(code);
      if (d.floor) await l.resizeFloor(d.floor);
      setDraft(EMPTY_DRAFT);
      setSelectedCode(null);
      layout.reload();
      notify({ kind: "success", message: "Layout changes saved." });
      return true;
    } catch (cause) {
      notify({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      return false;
    } finally {
      setSaving(false);
    }
  }

  const enterEdit = () => {
    setEditable(true);
    setDraft(EMPTY_DRAFT);
    selectBox(null);
  };
  const exitToInspect = () => {
    setEditable(false);
    setDraft(EMPTY_DRAFT);
    setSelectedCode(null);
    setEditingGeom(false);
    setEditingFloor(false);
  };
  const cancel = () => {
    if (isDirty) setConfirmLeave(true);
    else exitToInspect();
  };

  const canEditFloor = level.level !== "station";

  return (
    <>
      <ScreenHeader
        title="Device management — Lab layout"
        subtitle={
          site
            ? `${level.level} · ${effModel.widthU}×${effModel.depthU} m · ${effModel.boxes.length} ${level.childLabel}s${isDirty ? " · unsaved changes" : ""}`
            : "Isometric floor plan (§10)"
        }
        actions={
          site ? (
            editable ? (
              <>
                <Button
                  variant="primary"
                  onClick={async () => {
                    const ok = await save(level, draft);
                    if (ok) exitToInspect();
                  }}
                  disabled={!isDirty || saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="secondary" onClick={cancel} disabled={saving}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={enterEdit}>
                Edit layout
              </Button>
            )
          ) : undefined
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
                    <LocationPath
                      sites={data.sites}
                      labs={data.labs}
                      stations={data.stations}
                      site={site}
                      lab={lab}
                      station={station}
                      floor={floor}
                      level={level.level}
                      locked={editable}
                      onLocked={() =>
                        notify({
                          kind: "info",
                          key: "level-lock",
                          message:
                            "Changing level is only possible in inspect mode. Save your changes, or Cancel to switch to inspect mode.",
                        })
                      }
                      onPickSite={pickSite}
                      onPickFloor={pickFloor}
                      onEnterLab={enterLab}
                      onEnterStation={enterStation}
                      onGoToSite={goToSite}
                      onGoToLab={goToLab}
                    />

                    <span className="canvas-overlay__spacer" />

                    {editable && (
                      <>
                        <Button size="sm" onClick={addChild} disabled={saving}>
                          Add {level.childLabel}
                        </Button>
                        {canEditFloor && (
                          <Button
                            size="sm"
                            onClick={() => {
                              selectBox(null);
                              setEditingFloor(true);
                            }}
                            disabled={saving}
                          >
                            Edit {level.level}
                          </Button>
                        )}
                      </>
                    )}
                  </div>

                  {problems.length > 0 && (
                    <div className="notice notice--warning canvas-overlay__note" role="status">
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

                  {/* Bottom-right view controls: zoom in / out / reset, then the
                      projection toggle. Location-path styling, but no border or
                      fill. (Zoom is wired in the next commit; 2D/ISO works now.) */}
                  <div className="zoombar">
                    <button type="button" className="zoombar__btn" title="Zoom in" onClick={zoomIn}>
                      +
                    </button>
                    <span className="zoombar__sep" aria-hidden="true">
                      |
                    </span>
                    <button type="button" className="zoombar__btn" title="Zoom out" onClick={zoomOut}>
                      −
                    </button>
                    <span className="zoombar__sep" aria-hidden="true">
                      |
                    </span>
                    <button type="button" className="zoombar__btn" title="Reset view" onClick={resetView}>
                      [ ]
                    </button>
                    <span className="zoombar__sep" aria-hidden="true">
                      |
                    </span>
                    <button
                      type="button"
                      className="zoombar__btn"
                      title={projection === "iso" ? "Switch to 2D" : "Switch to isometric"}
                      onClick={() => setProjection((p) => (p === "iso" ? "2d" : "iso"))}
                    >
                      {projection === "iso" ? "2D" : "ISO"}
                    </button>
                  </div>
                </div>

                {confirmLeave && (
                  <ConfirmLeave
                    childLabel={level.childLabel}
                    saving={saving}
                    onSave={async () => {
                      const ok = await save(level, draft);
                      if (ok) {
                        setConfirmLeave(false);
                        exitToInspect();
                      }
                    }}
                    onDiscard={() => {
                      setConfirmLeave(false);
                      exitToInspect();
                    }}
                  />
                )}
              </>
            )}
          </AsyncBoundary>
        </div>

        {editingFloor ? (
          <FloorForm
            levelName={level.level}
            initial={floorEff}
            onStage={stageFloor}
            onDone={() => setEditingFloor(false)}
            onCancel={() => setEditingFloor(false)}
          />
        ) : editingGeom && selectedCode ? (
          <GeometryForm
            code={selectedCode}
            initial={effGeometry(selectedCode) ?? { pos: { x: 0, y: 0 }, size: level.standardSize, height: level.nominalHeight }}
            showHeight={level.level !== "site"}
            onStage={(geom) => stageGeometryForm(selectedCode, geom)}
            onDone={() => setEditingGeom(false)}
            onCancel={() => setEditingGeom(false)}
          />
        ) : (
          <LayoutInspector
            level={level}
            code={selectedCode}
            geom={selectedCode ? effGeometry(selectedCode) : null}
            isNew={selectedCode ? isNew(selectedCode) : false}
            editable={editable}
            onEnter={enter}
            onEditGeometry={() => setEditingGeom(true)}
            onRemove={() => selectedCode && removeSelected(selectedCode)}
            onClose={() => selectBox(null)}
          />
        )}
      </div>
    </>
  );
}

/** Save-or-discard confirm shown when leaving edit mode with unsaved changes. */
function ConfirmLeave({
  childLabel,
  saving,
  onSave,
  onDiscard,
}: {
  childLabel: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="layout-confirm" role="dialog" aria-modal="true" aria-label="Save changes?">
      <div className="layout-confirm__box">
        <p className="layout-confirm__title">Save changes?</p>
        <p className="layout-confirm__body">
          You have unsaved {childLabel} changes. <strong>Yes</strong> writes them to the registry as
          a new revision (reversible from the history). <strong>Discard</strong> throws away
          everything changed since you entered edit mode.
        </p>
        <div className="layout-confirm__actions">
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Yes"}
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
