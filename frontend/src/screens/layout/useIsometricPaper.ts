/**
 * All the JointJS lifecycle in one place: create a graph and paper, redraw
 * when the data changes, tear both down on unmount.
 *
 * The rule from plan §10.3 — "never let the canvas hold authoritative state;
 * reload it from the model and it must render identically" — is what shapes
 * this hook. It renders *from* props on every change and owns nothing. A drag
 * doesn't update the canvas's idea of where a station is; it reports a new
 * metric position, the screen writes it to the registry and refetches, and the
 * redraw is what moves the box. If the write fails, the box snaps back, because
 * the canvas never believed the drag in the first place (ADR 0010).
 */

import { useEffect, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

import type { Lab } from "../../api/types";
import type { FloorPos, PlacedStation, TileMetrics } from "./isometric";
import { DEFAULT_METRICS, canvasExtent, snap, toFloor } from "./isometric";
import {
  FloorGrid,
  StationTile,
  floorGridPath,
  floorSurfacePoints,
  stationBox,
  stationFill,
} from "./shapes";

export interface IsometricPaperOptions {
  lab: Lab | null;
  placed: PlacedStation[];
  metrics?: TileMetrics;
  selectedCode: string | null;
  showLabels: boolean;
  showFloor: boolean;
  /** False puts the canvas in read-only "operations" mode (§10.3). */
  editable: boolean;
  onSelect: (code: string | null) => void;
  onMove: (placed: PlacedStation, pos: FloorPos) => void;
}

const CELL_NAMESPACE = { ...shapes, epi: { FloorGrid, Station: StationTile } };

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
      // Only stations move, and only in edit mode. The floor is scenery.
      interactive: (cellView) =>
        handlers.current.editable && cellView.model.get("type") === "epi.Station",
    });

    paper.on("element:pointerclick", (view) => {
      handlers.current.onSelect((view.model.get("stationCode") as string) ?? null);
    });
    paper.on("blank:pointerclick", () => handlers.current.onSelect(null));

    paper.on("element:pointerup", (view) => {
      const { lab, metrics = DEFAULT_METRICS, placed } = handlers.current;
      const code = view.model.get("stationCode") as string | undefined;
      const target = placed.find((p) => p.station.code === code);
      if (!lab || !code || !target) return;

      const { origin } = canvasExtent(lab.width_m, lab.depth_m, metrics);
      const anchor = view.model.get("anchor") as { x: number; y: number };
      const position = view.model.position();
      // The floor anchor moved with the box; invert it back to metres, then
      // snap to the grid (soft — the write stores whatever we send).
      const dropped = toFloor(
        { x: position.x + anchor.x, y: position.y + anchor.y },
        origin,
        metrics,
      );
      const next = snap(dropped, lab.grid_size_m);

      if (
        Math.abs(next.x - target.station.pos_x) < 1e-6 &&
        Math.abs(next.y - target.station.pos_y) < 1e-6
      ) {
        return;
      }
      handlers.current.onMove(target, next);
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
  const { lab, placed, metrics = DEFAULT_METRICS, selectedCode, showLabels, showFloor } = options;

  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper || !lab) return;

    const { width, height, origin } = canvasExtent(lab.width_m, lab.depth_m, metrics);
    // Extra headroom for the tallest station box, so nothing is clipped.
    const tallest = placed.reduce((max, p) => Math.max(max, p.station.height_m), 0);
    const lift = tallest * metrics.heightUnit;
    paper.setDimensions(width + MARGIN * 2, height + lift + MARGIN * 2);
    paper.translate(MARGIN, lift + MARGIN);

    // Full rebuild rather than a diff: a lab is tens of cells, and a rebuild
    // can't drift out of sync with the data the way a diff can.
    graph.clear();

    if (showFloor) {
      const floor = new FloorGrid({ position: { x: 0, y: 0 }, size: { width, height } });
      floor.attr({
        surface: { points: floorSurfacePoints(lab, origin, metrics) },
        grid: { d: floorGridPath(lab, origin, metrics) },
      });
      graph.addCell(floor);
    }

    // `placed` is already sorted back-to-front (painter's algorithm, §10.3),
    // and JointJS paints in insertion order.
    for (const item of placed) {
      const box = stationBox(item.station, origin, metrics);
      const fill = stationFill(item.device?.operational_mode ?? null);
      const selected = item.station.code === selectedCode;

      const tile = new StationTile({ position: box.position, size: box.size });
      tile.set("stationCode", item.station.code);
      tile.set("anchor", box.anchor);
      tile.attr({
        top: {
          points: box.faces.top,
          fill: fill.top,
          stroke: selected ? "#00B1EA" : "#FFFFFF",
          strokeWidth: selected ? 3 : 1,
        },
        left: { points: box.faces.left, fill: fill.left },
        right: { points: box.faces.right, fill: fill.right },
        label: { text: showLabels ? item.station.code : "", x: box.label.x, y: box.label.y },
        badge: {
          cx: box.badge.x,
          cy: box.badge.y,
          fill: item.device ? "#C6D325" : "transparent",
          stroke: item.device ? "#FFFFFF" : "transparent",
        },
      });
      graph.addCell(tile);
    }
    // `container` is a dep so this re-runs in the same commit the paper is
    // created in — effects fire in declaration order, so the paper exists by
    // the time this reads it.
  }, [container, lab, placed, metrics, selectedCode, showLabels, showFloor]);

  return setContainer;
}
