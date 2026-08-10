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
 * controls float over it in `.canvas-overlay`. Zones (ADR 0015) are a separate
 * flat-2D layer here — drawn under the boxes, selected into their own inspector,
 * and written immediately (not through the box draft), so they're only editable
 * with a clean draft. Not here: the live-status layers (they need live device state).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { deleteNode, fetchTopology } from "../../api/topology";
import type { ZoneRect } from "../../api/topology";
import { listDevices } from "../../api/devices";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useNotify } from "../../components/Notifications";
import { useAsync } from "../../hooks/useAsync";
import { useStickyState } from "../../hooks/useStickyState";
import { LocationPath } from "./LocationPath";
import type { BoxFill, CanvasModel, FloorPos, Projection, RectGeom } from "./isometric";
import { boxProblems, clampToFloor, overlapsAny, placeNextSlot, projectOutline, rectContainsBox, round3, slidePos, sortBoxes } from "./isometric";
import { LayoutInspector } from "./LayoutInspector";
import { ZoneInspector, ZoneRectForm } from "./ZoneInspector";
import { FloorForm, GeometryForm } from "./layoutForms";
import { buildLevel } from "./levels";
import type { BoxGeometry, FloorGeometry, LayoutData, LevelConfig, LevelContext } from "./levels";
import { DEFAULT_SNAP_PX, useIsometricPaper } from "./useIsometricPaper";

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
  // Navigation + edit state is *sticky* (ADR 0014, req): leaving the layout
  // screen and coming back lands on the same level and the same edit session,
  // rather than reloading from scratch. A full page reload still resets it.
  const [siteCode, setSiteCode] = useStickyState<string | null>("layout.site", null);
  const [floor, setFloor] = useStickyState("layout.floor", 0);
  const [labCode, setLabCode] = useStickyState<string | null>("layout.lab", null);
  const [stationCode, setStationCode] = useStickyState<string | null>("layout.station", null);
  const [selectedCode, setSelectedCode] = useStickyState<string | null>("layout.selected", null);
  const [selectedZoneCode, setSelectedZoneCode] = useStickyState<string | null>("layout.selectedZone", null);
  const [editingZoneRect, setEditingZoneRect] = useState(false);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [projection, setProjection] = useStickyState<Projection>("layout.projection", "iso");
  // Move soft-snap tolerance, px. Held in state (not a fixed literal) so a
  // settings panel can tune it later (req); gentle by default.
  const [snapPx] = useState<number>(DEFAULT_SNAP_PX);
  const [editable, setEditable] = useStickyState("layout.editable", false);
  const [draft, setDraft] = useStickyState<Draft>("layout.draft", EMPTY_DRAFT);
  const [bump, setBump] = useState(0); // forces a canvas redraw (snap-back on reject)
  const [editingGeom, setEditingGeom] = useState(false);
  // A live geometry-edit session (ADR 0014, req #5): dragging/resizing a box opens
  // the geometry editor, `preview` feeds it the box's position *during* the drag,
  // and `revert` is the geometry Cancel restores (this box only).
  const [preview, setPreview] = useState<{ code: string; geom: BoxGeometry } | null>(null);
  const [editSession, setEditSession] = useState<{
    code: string;
    revert: BoxGeometry;
    wasEdited: boolean;
    wasCreate: boolean;
  } | null>(null);
  const [geomSync, setGeomSync] = useState(0); // bumps when a drag pushes new values into the form
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
  // Memoised so the live geometry preview (which re-renders on every mousemove)
  // doesn't churn `level`/`effModel` and force a canvas rebuild mid-drag.
  const ctx: LevelContext = useMemo(() => ({ site, lab, station, floor }), [site, lab, station, floor]);
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
    const boxes = sortBoxes([...base, ...created]);
    // Grandchild hints follow the draft: re-place each outline against its
    // parent box's *effective* (draft-aware) geometry, so a moved/resized lab or
    // station carries its child footprints with it and they don't snap back to
    // the persisted position on redraw (req: children move with the parent).
    const outlines = (level.outlines ?? []).flatMap((o) => {
      if (draft.removes.includes(o.parentCode)) return [];
      const eff = boxes.find((b) => b.code === o.parentCode);
      const base = level.geometryOf(o.parentCode);
      if (!eff || !base) return eff ? [o] : [];
      return [projectOutline(o, base, { pos: eff.pos, size: eff.size, height: eff.height })];
    });
    // Recompute zone membership against the *effective* (draft-aware) boxes, so a
    // station dragged into a zone counts as a member immediately, before Save (req #7).
    const zones = level.zones.map((z) => ({
      ...z,
      members: boxes.filter((b) => rectContainsBox(z.pos, z.size, b.pos, b.size)).map((b) => b.code),
    }));
    return {
      widthU: floorEff.widthU,
      depthU: floorEff.depthU,
      gridU: floorEff.gridU,
      boxes,
      outlines,
      zones,
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

  // Don't let a full page reload/close silently drop an unsaved edit session
  // (req: "I should not be able to leave if I am in edit mode"). In-app
  // navigation keeps the draft (sticky state), so this guards the browser leave.
  useEffect(() => {
    if (!(editable && isDirty)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editable, isDirty]);

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
    setSelectedZoneCode(null);
    setEditingZoneRect(false);
    // Switching selection ends any geometry session (its staged change is kept —
    // only an explicit Cancel reverts it).
    setEditSession(null);
    setPreview(null);
  }, []);

  // Effective geometry with the live drag preview layered on top, so the editor
  // and inspector show the box's *current* position as it's dragged (req #5).
  const displayGeometry = useCallback(
    (code: string): BoxGeometry | null =>
      preview && preview.code === code ? preview.geom : effGeometry(code),
    [preview, effGeometry],
  );

  // Open (or keep) a geometry-edit session for a box, capturing what Cancel
  // restores. Idempotent per box, so it's safe to call on every drag tick.
  const beginGeomSession = useCallback(
    (code: string) => {
      setSelectedCode(code);
      setEditingGeom(true);
      setEditSession((prev) => {
        if (prev?.code === code) return prev;
        const g = effGeometry(code);
        if (!g) return prev;
        return {
          code,
          revert: g,
          wasEdited: Boolean(draft.edits[code]),
          wasCreate: draft.creates.some((c) => c.code === code),
        };
      });
    },
    [effGeometry, draft],
  );

  // Inspect-mode "Edit geometry" (req): flip the whole canvas into edit mode and
  // open the geometry editor for the box in one press, keeping the selection.
  const enterEditGeometry = useCallback(
    (code: string) => {
      setEditable(true);
      setSelectedZoneCode(null);
      setEditingZoneRect(false);
      beginGeomSession(code);
    },
    [beginGeomSession, setEditable, setSelectedZoneCode],
  );

  // End a session keeping the staged change (Apply, or clicking elsewhere).
  const endGeomSession = useCallback(() => {
    setEditSession(null);
    setPreview(null);
    setEditingGeom(false);
  }, []);

  // End a session reverting *only this box* to where it started (Cancel, req #5).
  const revertGeomSession = useCallback(() => {
    const s = editSession;
    if (s) {
      setDraft((d) => {
        if (s.wasCreate) {
          return { ...d, creates: d.creates.map((c) => (c.code === s.code ? { ...c, geom: s.revert } : c)) };
        }
        const edits = { ...d.edits };
        if (s.wasEdited) edits[s.code] = s.revert;
        else delete edits[s.code];
        return { ...d, edits };
      });
      setBump((b) => b + 1); // redraw so the box snaps back to `revert`
    }
    setEditSession(null);
    setPreview(null);
    setEditingGeom(false);
  }, [editSession]);

  const selectZone = useCallback((code: string | null) => {
    setSelectedZoneCode(code);
    setEditingZoneRect(false);
    if (code) {
      setSelectedCode(null);
      setEditingGeom(false);
      setEditingFloor(false);
    }
  }, []);

  // Live geometry while a drag/resize is in flight — opens the editor and feeds
  // it the box's current position without touching the draft (req #5).
  const onGeomPreview = useCallback(
    (code: string, geom: BoxGeometry) => {
      beginGeomSession(code);
      setPreview({ code, geom });
      setGeomSync((n) => n + 1);
    },
    [beginGeomSession],
  );

  const onMove = useCallback(
    (code: string, pos: FloorPos) => {
      const cur = effGeometry(code);
      if (!cur) return;
      // Slide the box up against whatever it ran into rather than snapping it
      // back to where the drag started (the isometric-diagram affordance).
      const others = effModel.boxes.filter((b) => b.code !== code).map(toRect);
      const next = slidePos({ pos, size: cur.size, height: cur.height }, floorEff, others, cur.pos);
      beginGeomSession(code);
      setPreview(null);
      setGeomSync((n) => n + 1);
      stageGeometry(code, next);
    },
    [effGeometry, effModel, floorEff, stageGeometry, beginGeomSession],
  );

  const onReshape = useCallback(
    (code: string, size: { x: number; y: number }, height: number) => {
      const cur = effGeometry(code);
      if (!cur) return;
      const next = constrain(code, { pos: cur.pos, size, height });
      beginGeomSession(code);
      setPreview(null);
      setGeomSync((n) => n + 1);
      if (!next) return rejected("resize", code);
      stageGeometry(code, next);
    },
    [effGeometry, constrain, stageGeometry, level.childLabel, beginGeomSession],
  );

  // Drag/resize a zone on the canvas (ADR 0015) — the immediate-write mirror of
  // the numeric form, so a zone relocates/resizes by hand, not only via the
  // inspector. Gated on a clean box draft by `runZoneWrite` (hoisted below); a
  // rejected write snaps the zone back on the next redraw.
  const onMoveZone = (code: string, pos: FloorPos) => {
    const z = effModel.zones?.find((zz) => zz.code === code);
    if (!z) return;
    setSelectedZoneCode(code);
    setEditingZoneRect(true); // auto-open the zone geometry editor, like a box drag (req)
    void runZoneWrite(() =>
      level.placeZone(code, clampZoneRect({ pos_x: pos.x, pos_y: pos.y, width_m: z.size.x, depth_m: z.size.y })),
    );
  };
  const onReshapeZone = (code: string, size: { x: number; y: number }) => {
    const z = effModel.zones?.find((zz) => zz.code === code);
    if (!z) return;
    setSelectedZoneCode(code);
    setEditingZoneRect(true); // auto-open the zone geometry editor, like a box resize (req)
    void runZoneWrite(() =>
      level.placeZone(code, clampZoneRect({ pos_x: z.pos.x, pos_y: z.pos.y, width_m: size.x, depth_m: size.y })),
    );
  };

  const { containerRef, zoomIn, zoomOut, resetView } = useIsometricPaper({
    model: effModel,
    projection,
    selectedCode,
    selectedZoneCode,
    showLabels: true,
    editable,
    heightHandle: level.level !== "site", // labs are flat — no height handle
    onSelect: selectBox,
    onSelectZone: selectZone,
    onActivate: (code) => {
      if (editable) return selectBox(code); // no drilling while editing
      if (level.drillInto(code)) enter(code);
      else selectBox(code);
    },
    onMove,
    onReshape,
    onMoveZone,
    onReshapeZone,
    onGeomPreview,
    snapPx,
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

  // ---- zones (ADR 0015) ----------------------------------------------------
  //
  // Zones are a separate layer from the staged box draft: their writes are
  // immediate (create/resize/delete then reload), so they're only allowed when
  // the box draft is clean — otherwise a reload would fight the unsaved boxes.
  const zoneRow = selectedZoneCode ? level.zoneRowOf(selectedZoneCode) : null;

  async function runZoneWrite(fn: () => Promise<unknown>, after?: () => void): Promise<string | null> {
    if (isDirty) {
      const msg = "Save or cancel your layout changes before editing zones.";
      notify({ kind: "info", key: "zone-lock", message: msg });
      return msg;
    }
    setZoneBusy(true);
    try {
      await fn();
      layout.reload();
      after?.();
      return null;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      notify({ kind: "error", message: msg });
      return msg;
    } finally {
      setZoneBusy(false);
    }
  }

  const addZone = () => {
    const code = level.nextZoneCode();
    // A sensible starting rectangle: half the floor at the origin, at least a cell.
    const w = Math.max(floorEff.gridU, floorEff.widthU / 2);
    const d = Math.max(floorEff.gridU, floorEff.depthU / 2);
    void runZoneWrite(
      () => level.createZone(code, { pos_x: 0, pos_y: 0, width_m: w, depth_m: d }),
      () => setSelectedZoneCode(code),
    );
  };

  const removeZone = () => {
    if (!selectedZoneCode) return;
    void runZoneWrite(() => deleteNode("Zone", selectedZoneCode), () => selectZone(null));
  };

  // Clamp a zone rectangle inside the floor, at 3-decimal precision.
  const clampZoneRect = (rect: ZoneRect): ZoneRect => {
    const width_m = round3(Math.min(rect.width_m, floorEff.widthU));
    const depth_m = round3(Math.min(rect.depth_m, floorEff.depthU));
    return {
      width_m,
      depth_m,
      pos_x: round3(Math.min(Math.max(rect.pos_x, 0), Math.max(floorEff.widthU - width_m, 0))),
      pos_y: round3(Math.min(Math.max(rect.pos_y, 0), Math.max(floorEff.depthU - depth_m, 0))),
    };
  };

  // Clamp a zone rectangle inside the floor, then write it. Returns an error
  // string (shown in the form) or null on success.
  const saveZoneRect = async (rect: ZoneRect): Promise<string | null> => {
    if (!selectedZoneCode) return "No zone selected.";
    if (rect.width_m <= 0 || rect.depth_m <= 0) return "Zone width and depth must be positive.";
    const err = await runZoneWrite(() => level.placeZone(selectedZoneCode, clampZoneRect(rect)));
    if (!err) setEditingZoneRect(false);
    return err;
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
      // Reconcile the hierarchy with geometric zone membership (ADR 0016) — a
      // station drawn inside a zone gets that zone_id, so the tree/API agree with
      // the drawing. Computed from the final (draft-aware) boxes.
      await l.syncZoneMembership?.(effModel.boxes);
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
    setEditSession(null);
    setPreview(null);
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
                        {level.zonesEnabled && (
                          <Button size="sm" onClick={addZone} disabled={saving || zoneBusy}>
                            Add zone
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
        ) : editingZoneRect && zoneRow ? (
          <ZoneRectForm
            // Re-key on the rect so a canvas drag/resize (which writes then
            // reloads) refreshes the form's fields to the new values (req).
            key={`${zoneRow.code}:${zoneRow.pos_x},${zoneRow.pos_y},${zoneRow.width_m},${zoneRow.depth_m}`}
            code={zoneRow.code}
            initial={{
              pos_x: zoneRow.pos_x,
              pos_y: zoneRow.pos_y,
              width_m: zoneRow.width_m,
              depth_m: zoneRow.depth_m,
            }}
            busy={zoneBusy}
            onSave={saveZoneRect}
            onCancel={() => setEditingZoneRect(false)}
          />
        ) : selectedZoneCode ? (
          <ZoneInspector
            zone={effModel.zones?.find((z) => z.code === selectedZoneCode) ?? null}
            childLabel={level.childLabel}
            editable={editable}
            busy={zoneBusy}
            onEditRect={() => setEditingZoneRect(true)}
            onRemove={removeZone}
            onClose={() => selectZone(null)}
          />
        ) : editingGeom && selectedCode ? (
          <GeometryForm
            code={selectedCode}
            live={displayGeometry(selectedCode) ?? { pos: { x: 0, y: 0 }, size: level.standardSize, height: level.nominalHeight }}
            syncVersion={geomSync}
            showHeight={level.level !== "site"}
            onStage={(geom) => stageGeometryForm(selectedCode, geom)}
            onApply={endGeomSession}
            onCancel={revertGeomSession}
          />
        ) : (
          <LayoutInspector
            level={level}
            code={selectedCode}
            geom={selectedCode ? displayGeometry(selectedCode) : null}
            zones={effModel.zones ?? []}
            isNew={selectedCode ? isNew(selectedCode) : false}
            editable={editable}
            onEditGeometry={() => {
              if (!selectedCode) return;
              // In inspect mode this flips the canvas into edit mode first (req).
              if (editable) beginGeomSession(selectedCode);
              else enterEditGeometry(selectedCode);
            }}
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
