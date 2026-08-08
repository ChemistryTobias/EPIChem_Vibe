/**
 * All the JointJS lifecycle in one place, generic over the level (ADR 0012): it
 * renders a `CanvasModel` — a floor plus boxes — in either projection, and
 * reports drags back as new floor positions. It knows nothing about
 * sites/labs/stations/devices; `levels.ts` turns rows into boxes.
 *
 * The rule from plan §10.3 — "never let the canvas hold authoritative state;
 * reload it from the model and it must render identically" — is what shapes
 * this hook. It renders *from* props on every change and owns nothing. A drag
 * doesn't update the canvas's idea of where a box is; it reports a new position,
 * the screen writes it to the registry and refetches, and the redraw is what
 * moves the box. If the write fails, the box snaps back, because the canvas
 * never believed the drag in the first place (ADR 0010).
 */

import { useEffect, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

import type { CanvasModel, FloorPos, Projection } from "./isometric";
import { canvasExtent, metricsFor, snap, toFloor } from "./isometric";
import {
  BoxTile,
  FloorGrid,
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
  /** A box was dragged to a new floor position (snapped), in canvas units. */
  onMove: (code: string, pos: FloorPos) => void;
}

const CELL_NAMESPACE = { ...shapes, epi: { FloorGrid, Box: BoxTile } };

const MARGIN = 24;

export function useIsometricPaper(options: IsometricPaperOptions) {
  // A callback ref held in state, not a plain useRef. The container div is
  // rendered inside the screen's AsyncBoundary, so on first mount it doesn't
  // exist yet — a useRef would still be null when a `[]`-dep effect ran, and
  // the paper would never be created at all. State makes the arrival of the
  // node itself the thing that triggers creation.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);

  // Handlers live in a ref so the paper's listeners always call the latest
  // ones without the paper itself having to be rebuilt on every render.
  const handlers = useRef(options);
  handlers.current = options;

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
      // Only boxes move, and only in edit mode. The floor is scenery.
      interactive: (cellView) =>
        handlers.current.editable && cellView.model.get("type") === "epi.Box",
    });

    paper.on("element:pointerclick", (view) => {
      handlers.current.onSelect((view.model.get("boxCode") as string) ?? null);
    });
    paper.on("blank:pointerclick", () => handlers.current.onSelect(null));

    paper.on("element:pointerup", (view) => {
      const { model, projection } = handlers.current;
      const code = view.model.get("boxCode") as string | undefined;
      const box = model.boxes.find((b) => b.code === code);
      if (!code || !box) return;

      const metrics = metricsFor(model.widthU, model.depthU);
      const { origin } = canvasExtent(model.widthU, model.depthU, metrics, projection);
      const anchor = view.model.get("anchor") as { x: number; y: number };
      const position = view.model.position();
      // The floor anchor moved with the box; invert it back to units, then snap
      // to the grid (soft — the write stores whatever we send).
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
      paper.remove();
      graphRef.current = null;
      paperRef.current = null;
    };
  }, [container]);

  // Redraw whenever anything visible changes.
  const { model, projection, selectedCode, showLabels } = options;

  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper) return;

    const metrics = metricsFor(model.widthU, model.depthU);
    const { width, height, origin } = canvasExtent(model.widthU, model.depthU, metrics, projection);
    // Extra headroom for the tallest box, so nothing is clipped (iso only).
    const tallest = model.boxes.reduce((max, b) => Math.max(max, b.height), 0);
    const lift = projection === "2d" ? 0 : tallest * metrics.heightUnit;
    paper.setDimensions(width + MARGIN * 2, height + lift + MARGIN * 2);
    paper.translate(MARGIN, lift + MARGIN);

    // Full rebuild rather than a diff: a level is tens of boxes, and a rebuild
    // can't drift out of sync with the data the way a diff can.
    graph.clear();

    const floor = new FloorGrid({ position: { x: 0, y: 0 }, size: { width, height } });
    floor.attr({
      surface: { points: floorSurfacePoints(model.widthU, model.depthU, origin, metrics, projection) },
      grid: { d: floorGridPath(model.widthU, model.depthU, model.gridU, origin, metrics, projection) },
    });
    graph.addCell(floor);

    // `boxes` are already sorted back-to-front (painter's algorithm, §10.3),
    // and JointJS paints in insertion order.
    for (const box of model.boxes) {
      const shape = boxShape(box.pos, box.size, box.height, origin, metrics, projection);
      const selected = box.code === selectedCode;

      const tile = new BoxTile({ position: shape.position, size: shape.size });
      tile.set("boxCode", box.code);
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
      graph.addCell(tile);
    }
    // `container` is a dep so this re-runs in the same commit the paper is
    // created in — effects fire in declaration order, so the paper exists by
    // the time this reads it.
  }, [container, model, projection, selectedCode, showLabels]);

  return setContainer;
}
