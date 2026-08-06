/**
 * All the JointJS lifecycle in one place: create a graph and paper, redraw
 * when the data changes, tear both down on unmount.
 *
 * The rule from plan §10.3 — "never let the canvas hold authoritative state;
 * reload it from the model and it must render identically" — is what shapes
 * this hook. It renders *from* props on every change and owns nothing. A
 * drag doesn't update the canvas's idea of where a station is; it reports a
 * new grid cell, the screen writes it to the registry and refetches, and the
 * redraw is what moves the tile. If the write fails, the tile snaps back,
 * because the canvas never believed the drag in the first place.
 */

import { useEffect, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

import type { GridCell, PlacedStation, TileMetrics } from "./isometric";
import { DEFAULT_METRICS, benchCells, benchExtent, toGrid, toScreen } from "./isometric";
import { FloorTile, StationTile, floorPoints, stationFaces, stationFill } from "./shapes";

export interface IsometricPaperOptions {
  cols: number;
  rows: number;
  placed: PlacedStation[];
  metrics?: TileMetrics;
  selectedCode: string | null;
  showLabels: boolean;
  showFloor: boolean;
  /** False puts the canvas in read-only "operations" mode (§10.3). */
  editable: boolean;
  onSelect: (code: string | null) => void;
  onMove: (placed: PlacedStation, cell: GridCell) => void;
}

const CELL_NAMESPACE = { ...shapes, epi: { FloorTile, Station: StationTile } };

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
      // Only stations move, and only in edit mode. Floor tiles are scenery.
      interactive: (cellView) =>
        handlers.current.editable && cellView.model.get("type") === "epi.Station",
    });

    paper.on("element:pointerclick", (view) => {
      handlers.current.onSelect((view.model.get("stationCode") as string) ?? null);
    });
    paper.on("blank:pointerclick", () => handlers.current.onSelect(null));

    paper.on("element:pointerup", (view) => {
      const { cols, rows, metrics = DEFAULT_METRICS, placed } = handlers.current;
      const code = view.model.get("stationCode") as string | undefined;
      const target = placed.find((p) => p.station.code === code);
      if (!code || !target) return;

      const { origin } = benchExtent(cols, rows, metrics);
      const position = view.model.position();
      const cell = toGrid(
        { x: position.x + metrics.tileW / 2, y: position.y },
        origin,
        metrics,
        target.station.stack_height,
      );

      if (cell.col === target.cell.col && cell.row === target.cell.row) return;
      handlers.current.onMove(target, cell);
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
  const { cols, rows, placed, metrics = DEFAULT_METRICS, selectedCode, showLabels, showFloor } =
    options;

  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper) return;

    const { width, height, origin } = benchExtent(cols, rows, metrics);
    // Extra headroom for the tallest station box, so nothing is clipped.
    const tallest = placed.reduce((max, p) => Math.max(max, p.station.stack_height), 0);
    paper.setDimensions(width + metrics.tileW, height + metrics.tileH + tallest * metrics.stackUnit);
    paper.translate(0, tallest * metrics.stackUnit);

    // Full rebuild rather than a diff: a bench is tens of cells, and a
    // rebuild can't drift out of sync with the data the way a diff can.
    graph.clear();

    if (showFloor) {
      graph.addCells(
        benchCells(cols, rows).map((cell) => {
          const screen = toScreen(cell, origin, metrics);
          const tile = new FloorTile({
            position: { x: screen.x - metrics.tileW / 2, y: screen.y },
            size: { width: metrics.tileW, height: metrics.tileH },
          });
          tile.attr("body/points", floorPoints(metrics));
          return tile;
        }),
      );
    }

    // `placed` is already sorted back-to-front (painter's algorithm, §10.3),
    // and JointJS paints in insertion order.
    for (const item of placed) {
      const boxHeight = item.station.stack_height * metrics.stackUnit;
      const screen = toScreen(item.cell, origin, metrics, item.station.stack_height);
      const faces = stationFaces(metrics, boxHeight);
      const fill = stationFill(item.device?.operational_mode ?? null);
      const selected = item.station.code === selectedCode;

      const tile = new StationTile({
        position: { x: screen.x - metrics.tileW / 2, y: screen.y },
        size: { width: metrics.tileW, height: metrics.tileH + boxHeight },
      });
      tile.set("stationCode", item.station.code);
      tile.attr({
        top: {
          points: faces.top,
          fill: fill.top,
          stroke: selected ? "#00B1EA" : "#FFFFFF",
          strokeWidth: selected ? 3 : 1,
        },
        left: { points: faces.left, fill: fill.left },
        right: { points: faces.right, fill: fill.right },
        label: {
          text: showLabels ? item.station.code : "",
          x: metrics.tileW / 2,
          y: metrics.tileH / 2,
        },
        badge: {
          cx: metrics.tileW / 2,
          cy: metrics.tileH / 2 - 12,
          fill: item.device ? "#C6D325" : "transparent",
          stroke: item.device ? "#FFFFFF" : "transparent",
        },
      });
      graph.addCell(tile);
    }
    // `container` is a dep so this re-runs in the same commit the paper is
    // created in — effects fire in declaration order, so the paper exists by
    // the time this reads it.
  }, [container, cols, rows, placed, metrics, selectedCode, showLabels, showFloor]);

  return setContainer;
}
