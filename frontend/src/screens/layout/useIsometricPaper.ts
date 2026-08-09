/**
 * All the JointJS lifecycle in one place, generic over the level (ADR 0012): it
 * renders a `CanvasModel` — a floor plus boxes — in either projection, reports
 * drags back as new floor positions, and (edit mode) puts resize handles on the
 * selected box.
 *
 * The rule from plan §10.3 — "never let the canvas hold authoritative state;
 * reload it from the model and it must render identically" — is what shapes
 * this hook. It renders *from* props on every change and owns nothing. A drag or
 * a handle-resize doesn't update the canvas's idea of the box; it reports new
 * geometry, the screen writes it to the registry and refetches, and the redraw
 * is what commits the change. If the write fails, the box snaps back, because the
 * canvas never believed the drag in the first place (ADR 0010). The one bit of
 * transient local state is the *live preview* while a handle is dragged, which is
 * discarded on release in favour of the reloaded model.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

import type { Box, CanvasModel, FloorPos, Outline, Point, Projection, TileMetrics } from "./isometric";
import { DEFAULT_METRICS, TARGET_PX, canvasExtent, metricsFor, softSnap, toFloor, toScreen } from "./isometric";
import {
  BoxTile,
  FloorGrid,
  HandleDot,
  OutlineTile,
  ZoneArea,
  boxShape,
  floorGridPath,
  floorSurfacePoints,
} from "./shapes";

export interface IsometricPaperOptions {
  model: CanvasModel;
  projection: Projection;
  selectedCode: string | null;
  showLabels: boolean;
  /** False puts the canvas in read-only "operations" mode (§10.3). */
  editable: boolean;
  /** Whether the selected box gets a height handle — false at the site level,
   * where labs are flat (req: only stations are 3D). */
  heightHandle: boolean;
  onSelect: (code: string | null) => void;
  /** The box's label was clicked — the screen may drill into it (inspect mode). */
  onActivate: (code: string) => void;
  /** The currently-selected zone (ADR 0015), for the accent border. */
  selectedZoneCode: string | null;
  /** A zone area was clicked (or the blank, clearing it). */
  onSelectZone: (code: string | null) => void;
  /** A box was dragged to a new floor position (snapped), in canvas units. */
  onMove: (code: string, pos: FloorPos) => void;
  /** A box was resized via a handle: new footprint + height, in canvas units. */
  onReshape: (code: string, size: { x: number; y: number }, height: number) => void;
}

const CELL_NAMESPACE = {
  ...shapes,
  epi: { FloorGrid, Box: BoxTile, Handle: HandleDot, Outline: OutlineTile, Zone: ZoneArea },
};

const MARGIN = 24;
const HANDLE = 12; // handle square side (shapes.ts)
const ZOOM_STEP = 1.2; // per button press; the wheel uses a gentler factor
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;

/** The bits of a pointer/wheel event the pan/zoom handlers need. */
type PointerLike = { clientX: number; clientY: number; preventDefault?: () => void };

/** A handle drag in progress: which handle, and the box it resizes. */
interface Drag {
  kind: "foot" | "height";
  box: Box;
  origin: Point;
  metrics: TileMetrics;
  /** Screen y of the box's top-face centre at height 0 — the height reference. */
  centreBaseY: number;
  /** Live preview, committed on release. */
  size: { x: number; y: number };
  height: number;
}

export function useIsometricPaper(options: IsometricPaperOptions) {
  // A callback ref held in state, not a plain useRef. The container div is
  // rendered inside the screen's AsyncBoundary, so on first mount it doesn't
  // exist yet — a useRef would still be null when a `[]`-dep effect ran, and
  // the paper would never be created at all. State makes the arrival of the
  // node itself the thing that triggers creation.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // The container's measured size, so the drawing fits the full-bleed canvas and
  // re-fits when it resizes (a ResizeObserver feeds this — see below).
  const [size, setSize] = useState({ w: 0, h: 0 });
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);
  // The metrics the last redraw fitted to the container; the drag handlers read
  // it so their floor↔screen inversion matches what's on screen.
  const metricsRef = useRef<TileMetrics>(DEFAULT_METRICS);
  // User view transform layered on top of the fit: `scale` (wheel / ± buttons)
  // and `pan` (dragging the floor or the blank around it), in screen px. `base`
  // is the fit that centres the drawing — the redraw recomputes it, and every
  // view change is expressed relative to it so a redraw preserves zoom/pan.
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const baseRef = useRef({ tx: 0, ty: 0, dimW: 1, dimH: 1 });

  // Handlers live in a ref so the paper's listeners always call the latest
  // ones without the paper itself having to be rebuilt on every render.
  const handlers = useRef(options);
  handlers.current = options;

  // Live-drag state and the elements a handle drag mutates in place.
  const tilesRef = useRef(new Map<string, dia.Element>());
  // Grandchild hint elements grouped by their parent box's code, so a box drag
  // (or a height/foot resize) can move/re-elevate its hints live with it.
  const outlinesRef = useRef(new Map<string, { el: dia.Element; o: Outline }[]>());
  // The origin/metrics/projection the last redraw used — the change:position
  // handler needs them to re-project outlines while a box drags.
  const drawRef = useRef<{ origin: Point; metrics: TileMetrics; projection: Projection }>({
    origin: { x: 0, y: 0 },
    metrics: DEFAULT_METRICS,
    projection: "iso",
  });
  // True only during a full redraw, so the change:position listener doesn't treat
  // the redraw's own position sets as user drags.
  const redrawingRef = useRef(false);
  const handleRef = useRef<{ foot: dia.Element | null; height: dia.Element | null }>({
    foot: null,
    height: null,
  });
  const dragRef = useRef<Drag | null>(null);

  // Paint a box tile (main render and live preview both go through this).
  const paintTile = (
    tile: dia.Element,
    box: Box,
    geom: { pos: FloorPos; size: { x: number; y: number }; height: number },
    origin: Point,
    metrics: TileMetrics,
    projection: Projection,
    selected: boolean,
    showLabels: boolean,
  ) => {
    const shape = boxShape(geom.pos, geom.size, geom.height, origin, metrics, projection);
    tile.position(shape.position.x, shape.position.y);
    tile.resize(shape.size.width, shape.size.height);
    tile.set("anchor", shape.anchor);
    tile.attr({
      top: {
        points: shape.faces.top,
        fill: box.fill.top,
        stroke: selected ? "#00B1EA" : "#FFFFFF",
        strokeWidth: selected ? 3 : 1,
      },
      left: { points: shape.faces.left, fill: box.fill.left },
      right: { points: shape.faces.right, fill: box.fill.right },
      label: { text: showLabels ? box.label : "", x: shape.label.x, y: shape.label.y },
      badge: {
        cx: shape.badge.x,
        cy: shape.badge.y,
        fill: box.badge ? "#C6D325" : "transparent",
        stroke: box.badge ? "#FFFFFF" : "transparent",
      },
    });
    return shape;
  };

  // Paint a grandchild hint polygon at its parent's height (on the top face).
  const paintOutline = (
    el: dia.Element,
    o: Outline,
    origin: Point,
    metrics: TileMetrics,
    projection: Projection,
  ) => {
    const shape = boxShape(o.pos, o.size, o.height, origin, metrics, projection);
    el.position(shape.position.x, shape.position.y);
    el.resize(shape.size.width, shape.size.height);
    el.attr("face/points", shape.faces.top);
  };

  // Push the current scale+pan onto the paper. Final transform (JointJS applies
  // translate·scale, so screen = scale·content + translate): zoom is around the
  // viewport centre, then pan shifts it. At scale 1 / pan 0 this is just the fit.
  const applyView = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const s = scaleRef.current;
    const { tx, ty, dimW, dimH } = baseRef.current;
    const pan = panRef.current;
    paper.scale(s, s);
    paper.translate((1 - s) * (dimW / 2) + s * tx + pan.x, (1 - s) * (dimH / 2) + s * ty + pan.y);
  }, []);

  const zoomIn = useCallback(() => {
    scaleRef.current = Math.min(scaleRef.current * ZOOM_STEP, ZOOM_MAX);
    applyView();
  }, [applyView]);
  const zoomOut = useCallback(() => {
    scaleRef.current = Math.max(scaleRef.current / ZOOM_STEP, ZOOM_MIN);
    applyView();
  }, [applyView]);
  const resetView = useCallback(() => {
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    applyView();
  }, [applyView]);

  // Create the paper once the container exists.
  useEffect(() => {
    if (!container) return;

    const graph = new dia.Graph({}, { cellNamespace: CELL_NAMESPACE });
    const paper = new dia.Paper({
      el: container,
      model: graph,
      cellViewNamespace: CELL_NAMESPACE,
      width: "100%",
      height: "100%",
      background: { color: "transparent" },
      gridSize: 1,
      interactive: (cellView) => {
        const type = cellView.model.get("type");
        if (type === "epi.Handle") return true; // draggable; we read its position
        return handlers.current.editable && type === "epi.Box";
      },
    });

    // Drags invert screen→floor with the *fitted* metrics the last redraw used,
    // not a fresh fixed-target one, or a resized canvas would drop boxes off-place.
    const dimsFor = (model: CanvasModel, projection: Projection) => {
      const metrics = metricsRef.current;
      const { origin } = canvasExtent(model.widthU, model.depthU, metrics, projection);
      return { metrics, origin };
    };

    // Re-fit whenever the container resizes (window, inspector open/close, …).
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(container);

    paper.on("element:pointerclick", (view, evt) => {
      const type = view.model.get("type");
      if (type === "epi.Handle") return; // a handle isn't a selection
      if (type === "epi.Zone") {
        // A zone selects into the zone inspector; it never selects a box.
        handlers.current.onSelectZone((view.model.get("zoneCode") as string) ?? null);
        return;
      }
      const code = (view.model.get("boxCode") as string) ?? null;
      // A click on the label is a drill request; anywhere else on the box selects.
      // The hit target is the transparent `labelHit` <rect> over the label (the
      // only rect in a box tile); accept the <text>/<tspan> glyphs too as a
      // fallback. JointJS wraps label text in <tspan>, which is why matching only
      // <text> silently failed.
      const tag = (evt?.target as Element | undefined)?.tagName?.toLowerCase();
      const isLabel = tag === "rect" || tag === "text" || tag === "tspan";
      if (code && isLabel) handlers.current.onActivate(code);
      else handlers.current.onSelect(code);
    });
    paper.on("blank:pointerclick", () => {
      handlers.current.onSelect(null);
      handlers.current.onSelectZone(null);
    });

    // ---- resize handles (ADR 0012, the isometric-diagram demo affordance) ---
    //
    // A handle is a free-moving element; we read its position as it drags to
    // recompute the box's footprint (far-corner handle) or height (apex handle),
    // preview it live, and commit the snapped result on release.
    paper.on("element:pointerdown", (view) => {
      const kind = view.model.get("handle") as "foot" | "height" | undefined;
      if (!kind) return;
      const { model, projection, selectedCode } = handlers.current;
      const box = model.boxes.find((b) => b.code === selectedCode);
      if (!box) return;
      const { metrics, origin } = dimsFor(model, projection);
      const centre = { x: box.pos.x + box.size.x / 2, y: box.pos.y + box.size.y / 2 };
      dragRef.current = {
        kind,
        box,
        origin,
        metrics,
        centreBaseY: toScreen(centre, origin, metrics, 0, projection).y,
        size: { ...box.size },
        height: box.height,
      };
    });

    graph.on("change:position", (cell) => {
      const drag = dragRef.current;
      if (!drag || cell.get("handle") !== drag.kind) return;
      const { projection, model, showLabels } = handlers.current;
      const gridU = model.gridU;
      const centreScreen = cell.position(); // handle top-left
      const px = centreScreen.x + HANDLE / 2;
      const py = centreScreen.y + HANDLE / 2;

      if (drag.kind === "foot") {
        // The footprint handle sits at the far corner at height 0 (the box's
        // lowest vertex — "at the bottom"), so invert there, not on the top face.
        const far = toFloor({ x: px, y: py }, drag.origin, drag.metrics, 0, projection);
        drag.size = {
          x: Math.max(gridU, roundTo(far.x - drag.box.pos.x, gridU)),
          y: Math.max(gridU, roundTo(far.y - drag.box.pos.y, gridU)),
        };
      } else {
        // Only the vertical delta matters: height rises as the handle goes up.
        drag.height = Math.max(gridU, roundTo((drag.centreBaseY - py) / drag.metrics.heightUnit, gridU));
      }

      const tile = tilesRef.current.get(drag.box.code);
      if (tile) {
        paintTile(tile, drag.box, { pos: drag.box.pos, size: drag.size, height: drag.height }, drag.origin, drag.metrics, projection, true, showLabels);
      }
      // Raising/lowering the box lifts its child hints to the new top face too, so
      // they keep riding on top of it during the resize (req: same goes for handles).
      if (drag.kind === "height") {
        for (const child of outlinesRef.current.get(drag.box.code) ?? []) {
          paintOutline(child.el, { ...child.o, height: drag.height }, drag.origin, drag.metrics, projection);
        }
      }
    });

    // A plain box move (native JointJS drag): translate the box's child hints by
    // the same delta so they travel with it (req). Skipped during a redraw (the
    // rebuild sets positions itself) and during a handle drag (that repaints the
    // hints from the live height instead).
    graph.on("change:position", (cell) => {
      if (redrawingRef.current || dragRef.current) return;
      if (cell.get("type") !== "epi.Box") return;
      const code = cell.get("boxCode") as string | undefined;
      const group = code ? outlinesRef.current.get(code) : undefined;
      if (!group || group.length === 0) return;
      const prev = cell.previous("position") as { x: number; y: number } | undefined;
      const now = cell.position();
      const dx = now.x - (prev?.x ?? now.x);
      const dy = now.y - (prev?.y ?? now.y);
      if (dx === 0 && dy === 0) return;
      for (const child of group) child.el.translate(dx, dy);
    });

    paper.on("element:pointerup", (view) => {
      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        handlers.current.onReshape(drag.box.code, drag.size, drag.height);
        return;
      }

      // Otherwise it's a box move: invert the dropped anchor back to floor units.
      const { model, projection } = handlers.current;
      const code = view.model.get("boxCode") as string | undefined;
      const box = model.boxes.find((b) => b.code === code);
      if (!code || !box) return;
      const { metrics, origin } = dimsFor(model, projection);
      const anchor = view.model.get("anchor") as { x: number; y: number };
      const position = view.model.position();
      const dropped = toFloor(
        { x: position.x + anchor.x, y: position.y + anchor.y },
        origin,
        metrics,
        0,
        projection,
      );
      // Soft snap: only pull an edge onto a grid line / neighbour edge if it lands
      // within a few px of one — otherwise keep the free float position (req).
      const pxTol = 10;
      const pxPerUnit = projection === "2d" ? metrics.scale2d : Math.hypot(metrics.mHalfW, metrics.mHalfH);
      const others = model.boxes
        .filter((b) => b.code !== code)
        .map((b) => ({ pos: b.pos, size: b.size, height: b.height }));
      const next = softSnap(dropped, box.size, model, others, pxTol / pxPerUnit);
      if (Math.abs(next.x - box.pos.x) < 1e-6 && Math.abs(next.y - box.pos.y) < 1e-6) return;
      handlers.current.onMove(code, next);
    });

    // ---- pan (drag the floor or the blank around it) ------------------------
    //
    // Panning shifts the view, not the model, so it's pure screen-px translation
    // (independent of scale). Tracked on the document so a fast drag that leaves
    // the paper doesn't drop the gesture. Boxes/handles keep their own drag — pan
    // only starts on the blank paper or the floor tile.
    const startPan = (down: PointerLike) => {
      const start = { x: down.clientX, y: down.clientY, pan: { ...panRef.current } };
      const onMove = (e: PointerEvent) => {
        panRef.current = { x: start.pan.x + (e.clientX - start.x), y: start.pan.y + (e.clientY - start.y) };
        applyView();
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };
    paper.on("blank:pointerdown", (evt) => startPan(evt as unknown as PointerLike));
    paper.on("element:pointerdown", (view, evt) => {
      if (view.model.get("type") === "epi.FloorGrid") startPan(evt as unknown as PointerLike);
    });

    // ---- zoom (mouse wheel, around the cursor) ------------------------------
    const onWheel = (evt: PointerLike, delta: number) => {
      evt.preventDefault?.();
      const p = paperRef.current;
      if (!p) return;
      const rect = (p.el as HTMLElement).getBoundingClientRect();
      const q = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      const s = scaleRef.current;
      const ns = Math.min(Math.max(s * (delta > 0 ? 1.1 : 0.9), ZOOM_MIN), ZOOM_MAX);
      if (ns === s) return;
      const b = baseRef.current;
      const pan = panRef.current;
      // Keep the content point under the cursor fixed: invert to content, rescale,
      // solve for the pan that lands it back under the cursor.
      const trX = (1 - s) * (b.dimW / 2) + s * b.tx + pan.x;
      const trY = (1 - s) * (b.dimH / 2) + s * b.ty + pan.y;
      const mX = (q.x - trX) / s;
      const mY = (q.y - trY) / s;
      panRef.current = {
        x: q.x - ns * mX - (1 - ns) * (b.dimW / 2) - ns * b.tx,
        y: q.y - ns * mY - (1 - ns) * (b.dimH / 2) - ns * b.ty,
      };
      scaleRef.current = ns;
      applyView();
    };
    paper.on("blank:mousewheel", (evt, _x, _y, delta) => onWheel(evt as unknown as PointerLike, delta));
    paper.on("cell:mousewheel", (_view, evt, _x, _y, delta) => onWheel(evt as unknown as PointerLike, delta));

    graphRef.current = graph;
    paperRef.current = paper;

    return () => {
      ro.disconnect();
      paper.remove();
      graphRef.current = null;
      paperRef.current = null;
    };
  }, [container]);

  // Redraw whenever anything visible changes.
  const { model, projection, selectedCode, selectedZoneCode, showLabels, editable, heightHandle } = options;

  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper) return;

    const metrics = fitMetrics(model, projection, size.w, size.h);
    metricsRef.current = metrics;
    const { width, height, origin } = canvasExtent(model.widthU, model.depthU, metrics, projection);
    const tallest = model.boxes.reduce((max, b) => Math.max(max, b.height), 0);
    const lift = projection === "2d" ? 0 : tallest * metrics.heightUnit;
    // The drawing is `paperW × paperH`; make the paper at least the container so
    // it fills the full-bleed canvas, and centre the drawing in the slack.
    const paperW = width + MARGIN * 2;
    const paperH = height + lift + MARGIN * 2;
    const dimW = Math.max(paperW, size.w || paperW);
    const dimH = Math.max(paperH, size.h || paperH);
    paper.setDimensions(dimW, dimH);
    // The fit (centred) transform; the user's zoom/pan is layered on in applyView.
    baseRef.current = {
      tx: MARGIN + (dimW - paperW) / 2,
      ty: lift + MARGIN + (dimH - paperH) / 2,
      dimW,
      dimH,
    };
    applyView();

    // Full rebuild rather than a diff: a level is tens of boxes, and a rebuild
    // can't drift out of sync with the data the way a diff can.
    drawRef.current = { origin, metrics, projection };
    redrawingRef.current = true; // suppress the drag listener during the rebuild
    graph.clear();
    tilesRef.current.clear();
    outlinesRef.current.clear();
    handleRef.current = { foot: null, height: null };

    const floor = new FloorGrid({ position: { x: 0, y: 0 }, size: { width, height } });
    floor.attr({
      surface: { points: floorSurfacePoints(model.widthU, model.depthU, origin, metrics, projection) },
      grid: { d: floorGridPath(model.widthU, model.depthU, model.gridU, origin, metrics, projection) },
    });
    graph.addCell(floor);

    // Zones (ADR 0015): flat translucent areas under everything else, so boxes
    // and outlines read over them. Selectable; the selected one gets a solid
    // accent border.
    for (const z of model.zones ?? []) {
      const shape = boxShape(z.pos, z.size, 0, origin, metrics, projection);
      const area = new ZoneArea({ position: shape.position, size: shape.size });
      area.set("zoneCode", z.code);
      const selected = z.code === selectedZoneCode;
      area.attr({
        area: {
          points: shape.faces.top,
          stroke: selected ? "#00B1EA" : "rgba(140, 149, 25, 0.9)",
          strokeDasharray: selected ? "0" : "6,4",
          strokeWidth: selected ? 2.5 : 1.5,
        },
        zlabel: { text: z.label, x: shape.label.x, y: shape.label.y },
      });
      graph.addCell(area);
    }

    // `boxes` are already sorted back-to-front (painter's algorithm, §10.3).
    for (const box of model.boxes) {
      const tile = new BoxTile();
      tile.set("boxCode", box.code);
      paintTile(tile, box, { pos: box.pos, size: box.size, height: box.height }, origin, metrics, projection, box.code === selectedCode, showLabels);
      graph.addCell(tile);
      tilesRef.current.set(box.code, tile);
    }

    // Weak grandchild hints, drawn *after* the boxes and at the parent's height,
    // so they sit on the parent box's top face (visible), not hidden under it
    // (req). Non-interactive: context, never a click target. Grouped by parent so
    // a drag/resize can move them with the box.
    for (const o of model.outlines ?? []) {
      const outline = new OutlineTile();
      paintOutline(outline, o, origin, metrics, projection);
      graph.addCell(outline);
      const group = outlinesRef.current.get(o.parentCode) ?? [];
      group.push({ el: outline, o });
      outlinesRef.current.set(o.parentCode, group);
    }

    // Resize handles on the selected box (edit mode): a footprint handle at the
    // far corner, and — isometric only — a height handle at the apex.
    const selected = editable ? model.boxes.find((b) => b.code === selectedCode) : undefined;
    if (selected) {
      const tile = tilesRef.current.get(selected.code)!;
      const p = tile.position();
      const shape = boxShape(selected.pos, selected.size, selected.height, origin, metrics, projection);
      handleRef.current.foot = addHandle(graph, "foot", p.x + shape.farBottom.x, p.y + shape.farBottom.y);
      // No height handle at the site level — labs are flat (req: only stations 3D).
      if (projection === "iso" && heightHandle) {
        handleRef.current.height = addHandle(graph, "height", p.x + shape.apex.x, p.y + shape.apex.y);
      }
    }
    redrawingRef.current = false;
    // `container` is a dep so this re-runs in the same commit the paper is
    // created in — effects fire in declaration order, so the paper exists by
    // the time this reads it.
  }, [container, model, projection, selectedCode, selectedZoneCode, showLabels, editable, heightHandle, size]);

  return { containerRef: setContainer, zoomIn, zoomOut, resetView };
}

/**
 * Metrics scaled so the whole drawing fits the container (minus margins), in
 * either projection. The extent is linear in the target px, so we measure the
 * drawing at the default target and rescale the target by the fit ratio. Falls
 * back to the default target before the container has been measured.
 */
function fitMetrics(
  model: CanvasModel,
  projection: Projection,
  cw: number,
  ch: number,
): TileMetrics {
  const availW = Math.max((cw || TARGET_PX) - MARGIN * 2, 80);
  const availH = Math.max((ch || TARGET_PX) - MARGIN * 2, 80);
  const base = metricsFor(model.widthU, model.depthU);
  const be = canvasExtent(model.widthU, model.depthU, base, projection);
  const tallest = model.boxes.reduce((max, b) => Math.max(max, b.height), 0);
  const baseLift = projection === "2d" ? 0 : tallest * base.heightUnit;
  const scale = Math.min(availW / be.width, availH / (be.height + baseLift));
  return metricsFor(model.widthU, model.depthU, TARGET_PX * scale);
}

/** Round to the nearest multiple of `step` (no-op for a non-positive step). */
function roundTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

/** A handle centred on (cx, cy), tagged with its kind for the drag handlers. */
function addHandle(graph: dia.Graph, kind: "foot" | "height", cx: number, cy: number): dia.Element {
  const handle = new HandleDot({ position: { x: cx - HANDLE / 2, y: cy - HANDLE / 2 } });
  handle.set("handle", kind);
  graph.addCell(handle);
  return handle;
}
