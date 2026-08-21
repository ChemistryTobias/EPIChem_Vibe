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
 * flat-2D layer here — drawn under the boxes and selected into their own inspector
 * — but they now stage into the *same* draft as boxes and edit identically (req):
 * dragging opens a live editor, per-zone **Apply** writes just that zone (and
 * reconciles station↔zone membership, ADR 0016), and the header **Save** writes
 * everything. Not here: the live-status layers (they need live device state).
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
import { setLeaveGuard } from "../../hooks/useHashRoute";
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

/** A zone created in the draft but not yet persisted (ADR 0015). */
interface ZoneCreate {
  code: string;
  rect: ZoneRect;
}

/** The unsaved edits for the current level, applied over the fetched data. Zones
 * are staged here too now (req: zone edits work exactly like box edits — nothing
 * writes until Save). */
interface Draft {
  creates: DraftCreate[];
  edits: Record<string, BoxGeometry>;
  removes: string[];
  floor: FloorGeometry | null;
  zoneCreates: ZoneCreate[];
  zoneEdits: Record<string, ZoneRect>;
  zoneRemoves: string[];
}

const EMPTY_DRAFT: Draft = {
  creates: [],
  edits: {},
  removes: [],
  floor: null,
  zoneCreates: [],
  zoneEdits: {},
  zoneRemoves: [],
};

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
  // A live zone-edit session, the zone counterpart of preview/editSession above
  // (req: zones edit exactly like boxes now).
  const [zonePreview, setZonePreview] = useState<{ code: string; rect: ZoneRect } | null>(null);
  const [zoneSession, setZoneSession] = useState<{
    code: string;
    revert: ZoneRect;
    wasEdited: boolean;
    wasCreate: boolean;
  } | null>(null);
  const [zoneSync, setZoneSync] = useState(0);
  const [editingFloor, setEditingFloor] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ code: string; kind: "box" | "zone" } | null>(null);
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
    // Zones are draft-aware like boxes now (req): drop staged removes, apply
    // staged rect edits, add staged creates, then recompute membership against
    // the effective boxes — all before anything is written.
    const zoneBase = level.zones
      .filter((z) => !draft.zoneRemoves.includes(z.code))
      .map((z) => {
        const e = draft.zoneEdits[z.code];
        return e ? { ...z, pos: { x: e.pos_x, y: e.pos_y }, size: { x: e.width_m, y: e.depth_m } } : z;
      });
    const zoneCreated = draft.zoneCreates.map((c) => ({
      code: c.code,
      label: c.code,
      purpose: "area",
      pos: { x: c.rect.pos_x, y: c.rect.pos_y },
      size: { x: c.rect.width_m, y: c.rect.depth_m },
      members: [] as string[],
    }));
    const zones = [...zoneBase, ...zoneCreated].map((z) => ({
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
    draft.floor !== null ||
    draft.zoneCreates.length > 0 ||
    Object.keys(draft.zoneEdits).length > 0 ||
    draft.zoneRemoves.length > 0;

  // Warn before leaving edit mode with unsaved changes (req): a browser
  // reload/close is caught by `beforeunload`, and an in-app section switch by a
  // `navigate` leave-guard that asks to confirm.
  useEffect(() => {
    if (!(editable && isDirty)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    setLeaveGuard(() =>
      window.confirm("You have unsaved layout changes. Leave edit mode and discard them?"),
    );
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setLeaveGuard(null);
    };
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

  // Apply a box's geometry edit: **write it immediately** (req — Apply saves, it
  // doesn't just stage), reconcile zone membership, then drop it from the draft
  // and reload. The committed geometry is passed in from the form so this doesn't
  // read the not-yet-flushed draft. Only this box is written; anything else stays
  // staged until its own Apply or the header Save.
  const applyGeomSession = useCallback(
    async (geom: BoxGeometry) => {
      const code = editSession?.code ?? selectedCode;
      if (!code) return;
      const isCreate = draft.creates.some((c) => c.code === code);
      setSaving(true);
      try {
        if (isCreate) await level.create({ code, geom });
        else await level.setGeometry(code, geom);
        await level.syncZoneMembership?.(effModel.boxes, effModel.zones ?? []);
        setDraft((d) => ({
          ...d,
          creates: d.creates.filter((c) => c.code !== code),
          edits: Object.fromEntries(Object.entries(d.edits).filter(([k]) => k !== code)),
        }));
        layout.reload();
        notify({ kind: "success", message: `Saved ${code}.` });
      } catch (cause) {
        notify({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
        setSaving(false);
        return; // keep the session open so the user can retry
      }
      setSaving(false);
      setEditSession(null);
      setPreview(null);
      setEditingGeom(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editSession, selectedCode, draft, level, effModel, layout, notify],
  );

  const selectZone = useCallback((code: string | null) => {
    setSelectedZoneCode(code);
    setEditingZoneRect(false);
    // Leaving/selecting ends any zone session (its staged change is kept — only an
    // explicit Cancel reverts it), mirroring selectBox.
    setZoneSession(null);
    setZonePreview(null);
    if (code) {
      setSelectedCode(null);
      setEditingGeom(false);
      setEditingFloor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- zones, staged exactly like boxes (req) ------------------------------
  //
  // The zone counterpart of effGeometry/displayGeometry/onMove/onReshape above:
  // drag/resize stages into the zone draft and opens the live editor; Apply keeps
  // it, Cancel reverts this zone, and the header Save writes everything at once.

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

  const effZoneRect = (code: string): ZoneRect | null => {
    const created = draft.zoneCreates.find((c) => c.code === code);
    if (created) return created.rect;
    if (draft.zoneRemoves.includes(code)) return null;
    const edited = draft.zoneEdits[code];
    if (edited) return edited;
    const z = level.zones.find((zz) => zz.code === code);
    return z ? { pos_x: z.pos.x, pos_y: z.pos.y, width_m: z.size.x, depth_m: z.size.y } : null;
  };

  const displayZoneRect = (code: string): ZoneRect | null =>
    zonePreview && zonePreview.code === code ? zonePreview.rect : effZoneRect(code);

  const stageZoneRect = (code: string, rect: ZoneRect) => {
    setDraft((d) =>
      d.zoneCreates.some((c) => c.code === code)
        ? { ...d, zoneCreates: d.zoneCreates.map((c) => (c.code === code ? { ...c, rect } : c)) }
        : { ...d, zoneEdits: { ...d.zoneEdits, [code]: rect } },
    );
  };

  const beginZoneSession = (code: string) => {
    setSelectedZoneCode(code);
    setSelectedCode(null);
    setEditingGeom(false);
    setEditingZoneRect(true);
    setZoneSession((prev) => {
      if (prev?.code === code) return prev;
      const r = effZoneRect(code);
      if (!r) return prev;
      return {
        code,
        revert: r,
        wasEdited: Boolean(draft.zoneEdits[code]),
        wasCreate: draft.zoneCreates.some((c) => c.code === code),
      };
    });
  };

  const revertZoneSession = () => {
    if (zoneSession) {
      const s = zoneSession;
      setDraft((d) => {
        if (s.wasCreate) {
          return { ...d, zoneCreates: d.zoneCreates.map((c) => (c.code === s.code ? { ...c, rect: s.revert } : c)) };
        }
        const zoneEdits = { ...d.zoneEdits };
        if (s.wasEdited) zoneEdits[s.code] = s.revert;
        else delete zoneEdits[s.code];
        return { ...d, zoneEdits };
      });
      setBump((b) => b + 1);
    }
    setZoneSession(null);
    setZonePreview(null);
    setEditingZoneRect(false);
  };

  // Apply a zone edit: **write it immediately** (req — the zone counterpart of
  // applyGeomSession), then reconcile station↔zone membership so the hierarchy
  // reflects the new/moved zone, drop it from the draft, and reload. The committed
  // rect is passed in from the form, so it doesn't read the not-yet-flushed draft.
  const applyZoneSession = useCallback(
    async (rect: ZoneRect) => {
      const code = zoneSession?.code ?? selectedZoneCode;
      if (!code) return;
      const isCreate = draft.zoneCreates.some((c) => c.code === code);
      setSaving(true);
      try {
        if (isCreate) await level.createZone(code, rect);
        else await level.placeZone(code, rect);
        await level.syncZoneMembership?.(effModel.boxes, effModel.zones ?? []);
        setDraft((d) => ({
          ...d,
          zoneCreates: d.zoneCreates.filter((c) => c.code !== code),
          zoneEdits: Object.fromEntries(Object.entries(d.zoneEdits).filter(([k]) => k !== code)),
        }));
        layout.reload();
        notify({ kind: "success", message: `Saved zone ${code}.` });
      } catch (cause) {
        notify({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
        setSaving(false);
        return;
      }
      setSaving(false);
      setZoneSession(null);
      setZonePreview(null);
      setEditingZoneRect(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoneSession, selectedZoneCode, draft, level, effModel, layout, notify],
  );

  // Live zone geometry while a drag/resize is in flight — opens the editor and
  // feeds it the zone's current rect without touching the draft (req).
  const onZoneGeomPreview = (code: string, geom: { pos: FloorPos; size: { x: number; y: number } }) => {
    beginZoneSession(code);
    setZonePreview({ code, rect: { pos_x: geom.pos.x, pos_y: geom.pos.y, width_m: geom.size.x, depth_m: geom.size.y } });
    setZoneSync((n) => n + 1);
  };

  const onMoveZone = (code: string, pos: FloorPos) => {
    const r = effZoneRect(code);
    if (!r) return;
    beginZoneSession(code);
    setZonePreview(null);
    setZoneSync((n) => n + 1);
    stageZoneRect(code, clampZoneRect({ pos_x: pos.x, pos_y: pos.y, width_m: r.width_m, depth_m: r.depth_m }));
  };

  const onReshapeZone = (code: string, size: { x: number; y: number }) => {
    const r = effZoneRect(code);
    if (!r) return;
    beginZoneSession(code);
    setZonePreview(null);
    setZoneSync((n) => n + 1);
    stageZoneRect(code, clampZoneRect({ pos_x: r.pos_x, pos_y: r.pos_y, width_m: size.x, depth_m: size.y }));
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
    onZoneGeomPreview,
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

  // ---- zones (ADR 0015), staged into the draft like boxes ------------------

  // Next free zone code, avoiding both persisted rows and staged creates.
  const nextZoneCode = (): string => {
    const taken = new Set([...data.zones.map((z) => z.code), ...draft.zoneCreates.map((c) => c.code)]);
    for (let n = 1; ; n++) {
      const c = `ZONE-${String(n).padStart(2, "0")}`;
      if (!taken.has(c)) return c;
    }
  };

  const addZone = () => {
    const code = nextZoneCode();
    // A sensible starting rectangle: half the floor at the origin, at least a cell.
    const rect = clampZoneRect({
      pos_x: 0,
      pos_y: 0,
      width_m: Math.max(floorEff.gridU, floorEff.widthU / 2),
      depth_m: Math.max(floorEff.gridU, floorEff.depthU / 2),
    });
    setDraft((d) => ({ ...d, zoneCreates: [...d.zoneCreates, { code, rect }] }));
    setSelectedCode(null);
    setSelectedZoneCode(code);
    setEditingZoneRect(true);
    setZoneSession({ code, revert: rect, wasEdited: false, wasCreate: true });
    setZonePreview(null);
    setZoneSync((n) => n + 1);
  };

  // Stage a zone removal (drop a staged create, or record a remove of a saved
  // zone), mirroring `removeSelected` for boxes.
  const removeZoneStaged = (code: string) => {
    setDraft((d) =>
      d.zoneCreates.some((c) => c.code === code)
        ? { ...d, zoneCreates: d.zoneCreates.filter((c) => c.code !== code) }
        : {
            ...d,
            zoneRemoves: [...d.zoneRemoves, code],
            zoneEdits: Object.fromEntries(Object.entries(d.zoneEdits).filter(([k]) => k !== code)),
          },
    );
    selectZone(null);
  };

  // Validate + stage a zone rect from the numeric form (the Apply path).
  const stageZoneRectForm = (code: string, rect: ZoneRect): string | null => {
    if (rect.width_m <= 0 || rect.depth_m <= 0) return "Zone width and depth must be positive.";
    stageZoneRect(code, clampZoneRect(rect));
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
      // Zones write from the same draft now (req): creates, rect edits, removes.
      for (const c of d.zoneCreates) await l.createZone(c.code, c.rect);
      for (const [code, rect] of Object.entries(d.zoneEdits)) {
        if (d.zoneRemoves.includes(code)) continue;
        await l.placeZone(code, rect);
      }
      for (const code of d.zoneRemoves) await deleteNode("Zone", code);
      // Reconcile the hierarchy with geometric zone membership (ADR 0016) — a
      // station drawn inside a zone gets that zone_id, so the tree/API agree with
      // the drawing. Computed from the final (draft-aware) boxes.
      await l.syncZoneMembership?.(effModel.boxes, effModel.zones ?? []);
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
    setSelectedZoneCode(null);
    setEditingGeom(false);
    setEditingFloor(false);
    setEditingZoneRect(false);
    setEditSession(null);
    setPreview(null);
    setZoneSession(null);
    setZonePreview(null);
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
                  onClick={() => {
                    // Save everything staged but *stay in edit mode* (req): on
                    // success `save` clears the draft, so this button and every
                    // Apply grey out. Leaving is the separate "Inspector mode".
                    void save(level, draft);
                  }}
                  disabled={!isDirty || saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="secondary" onClick={cancel} disabled={saving}>
                  Inspector mode
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
                          <Button size="sm" onClick={addZone} disabled={saving}>
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

                {confirmRemove && (
                  <div className="layout-confirm" role="dialog" aria-modal="true" aria-label="Remove component?">
                    <div className="layout-confirm__box">
                      <p className="layout-confirm__title">
                        {confirmRemove.kind === "zone" ? "Delete zone" : `${level.removeVerb} ${level.childLabel}`}?
                      </p>
                      <p className="layout-confirm__body">
                        {confirmRemove.kind === "zone" ? "Delete" : level.removeVerb}{" "}
                        <strong className="mono">{confirmRemove.code}</strong>?{" "}
                        {confirmRemove.kind === "zone" || level.removeVerb === "Delete"
                          ? "It's staged until you Save, and stays reversible from the revision history."
                          : "This hides it from the canvas (staged until Save) — reversible from the revision history."}
                      </p>
                      <div className="layout-confirm__actions">
                        <Button
                          variant="danger"
                          onClick={() => {
                            if (confirmRemove.kind === "zone") removeZoneStaged(confirmRemove.code);
                            else removeSelected(confirmRemove.code);
                            setConfirmRemove(null);
                          }}
                        >
                          {confirmRemove.kind === "zone" ? "Delete" : level.removeVerb}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

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
        ) : editingZoneRect && selectedZoneCode && displayZoneRect(selectedZoneCode) ? (
          <ZoneRectForm
            code={selectedZoneCode}
            live={displayZoneRect(selectedZoneCode)!}
            syncVersion={zoneSync}
            staged={
              Boolean(draft.zoneEdits[selectedZoneCode]) ||
              draft.zoneCreates.some((c) => c.code === selectedZoneCode)
            }
            onStage={(rect) => stageZoneRectForm(selectedZoneCode, rect)}
            onApply={applyZoneSession}
            onCancel={revertZoneSession}
          />
        ) : selectedZoneCode ? (
          <ZoneInspector
            zone={effModel.zones?.find((z) => z.code === selectedZoneCode) ?? null}
            childLabel={level.childLabel}
            editable={editable}
            busy={false}
            onEditRect={() => beginZoneSession(selectedZoneCode)}
            onRemove={() => setConfirmRemove({ code: selectedZoneCode, kind: "zone" })}
            onClose={() => selectZone(null)}
          />
        ) : editingGeom && selectedCode ? (
          <GeometryForm
            code={selectedCode}
            live={displayGeometry(selectedCode) ?? { pos: { x: 0, y: 0 }, size: level.standardSize, height: level.nominalHeight }}
            syncVersion={geomSync}
            showHeight={level.level !== "site"}
            staged={Boolean(draft.edits[selectedCode]) || isNew(selectedCode)}
            onStage={(geom) => stageGeometryForm(selectedCode, geom)}
            onApply={applyGeomSession}
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
            onRemove={() => selectedCode && setConfirmRemove({ code: selectedCode, kind: "box" })}
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
