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

import { useEffect, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

import type { Box, CanvasModel, FloorPos, Point, Projection, TileMetrics } from "./isometric";
import { DEFAULT_METRICS, TARGET_PX, canvasExtent, metricsFor, snap, toFloor, toScreen } from "./isometric";
import {
  BoxTile,
  FloorGrid,
  HandleDot,
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
  onSelect: (code: string | null) => void;
  /** The box's label was clicked — the screen may drill into it (inspect mode). */
  onActivate: (code: string) => void;
  /** A box was dragged to a new floor position (snapped), in canvas units. */
  onMove: (code: string, pos: FloorPos) => void;
  /** A box was resized via a handle: new footprint + height, in canvas units. */
  onReshape: (code: string, size: { x: number; y: number }, height: number) => void;
}

const CELL_NAMESPACE = { ...shapes, epi: { FloorGrid, Box: BoxTile, Handle: HandleDot } };

const MARGIN = 24;
const HANDLE = 12; // handle square side (shapes.ts)

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

  // Handlers live in a ref so the paper's listeners always call the latest
  // ones without the paper itself having to be rebuilt on every render.
  const handlers = useRef(options);
  handlers.current = options;

  // Live-drag state and the elements a handle drag mutates in place.
  const tilesRef = useRef(new Map<string, dia.Element>());
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
      if (view.model.get("type") === "epi.Handle") return; // a handle isn't a selection
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
    paper.on("blank:pointerclick", () => handlers.current.onSelect(null));

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
        // The far corner sits on the top face (height = box height); invert there.
        const far = toFloor({ x: px, y: py }, drag.origin, drag.metrics, drag.box.height, projection);
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
      const next = snap(dropped, model.gridU);
      if (Math.abs(next.x - box.pos.x) < 1e-6 && Math.abs(next.y - box.pos.y) < 1e-6) return;
      handlers.current.onMove(code, next);
    });

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
  const { model, projection, selectedCode, showLabels, editable } = options;

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
    paper.translate(MARGIN + (dimW - paperW) / 2, lift + MARGIN + (dimH - paperH) / 2);

    // Full rebuild rather than a diff: a level is tens of boxes, and a rebuild
    // can't drift out of sync with the data the way a diff can.
    graph.clear();
    tilesRef.current.clear();
    handleRef.current = { foot: null, height: null };

    const floor = new FloorGrid({ position: { x: 0, y: 0 }, size: { width, height } });
    floor.attr({
      surface: { points: floorSurfacePoints(model.widthU, model.depthU, origin, metrics, projection) },
      grid: { d: floorGridPath(model.widthU, model.depthU, model.gridU, origin, metrics, projection) },
    });
    graph.addCell(floor);

    // `boxes` are already sorted back-to-front (painter's algorithm, §10.3).
    for (const box of model.boxes) {
      const tile = new BoxTile();
      tile.set("boxCode", box.code);
      paintTile(tile, box, { pos: box.pos, size: box.size, height: box.height }, origin, metrics, projection, box.code === selectedCode, showLabels);
      graph.addCell(tile);
      tilesRef.current.set(box.code, tile);
    }

    // Resize handles on the selected box (edit mode): a footprint handle at the
    // far corner, and — isometric only — a height handle at the apex.
    const selected = editable ? model.boxes.find((b) => b.code === selectedCode) : undefined;
    if (selected) {
      const tile = tilesRef.current.get(selected.code)!;
      const p = tile.position();
      const shape = boxShape(selected.pos, selected.size, selected.height, origin, metrics, projection);
      handleRef.current.foot = addHandle(graph, "foot", p.x + shape.farCorner.x, p.y + shape.farCorner.y);
      if (projection === "iso") {
        handleRef.current.height = addHandle(graph, "height", p.x + shape.apex.x, p.y + shape.apex.y);
      }
    }
    // `container` is a dep so this re-runs in the same commit the paper is
    // created in — effects fire in declaration order, so the paper exists by
    // the time this reads it.
  }, [container, model, projection, selectedCode, showLabels, editable, size]);

  return setContainer;
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
