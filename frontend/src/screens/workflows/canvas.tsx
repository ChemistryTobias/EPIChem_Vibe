/**
 * The designer's canvas parts, n8n-style: a Start node, one tile per step (its
 * pictogram large, its name and what it does underneath, a status badge, and
 * on hover its own Duplicate / Delete), an end "+" to append, and edges with a
 * "+" to insert between two steps and a "×" to cut the link. Tiles are wired
 * by dragging from a tile's right handle to another's left one; a tile wired
 * to nothing reads as loose (dashed) and won't run. Flow is left to right;
 * the canvas holds no state of its own (plan §10.3).
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";

import { Glyph } from "../../components/glyphs";

export interface StepTileData extends Record<string, unknown> {
  /** Position in the run, or null for a loose step. */
  index: number | null;
  glyph: string;
  title: string;
  subtitle: string;
  control: boolean;
  errors: number;
  warnings: number;
  onDuplicate: () => void;
  onDelete: () => void;
}

export type StepTileNode = Node<StepTileData, "step">;
export type AddNode = Node<{ onAdd: () => void; empty: boolean }, "add">;
export type StartNode = Node<Record<string, never>, "start">;

export function StepTile({ data, selected }: NodeProps<StepTileNode>) {
  const loose = data.index === null;
  // A loose step's only "issue" is that it's loose; the dashed frame says so.
  const errors = loose ? 0 : data.errors;
  const warnings = loose ? 0 : data.warnings;
  const state = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
  return (
    <div className={`tile${selected ? " tile--selected" : ""}${loose ? " tile--loose" : ""}`}>
      <div className="tile__tools nodrag">
        <button onClick={(e) => (e.stopPropagation(), data.onDuplicate())} title="Duplicate" aria-label="Duplicate step">
          <Glyph name="copy" size={13} />
        </button>
        <button
          className="tile__tool--danger"
          onClick={(e) => (e.stopPropagation(), data.onDelete())}
          title="Delete"
          aria-label="Delete step"
        >
          <Glyph name="trash" size={13} />
        </button>
      </div>
      <Handle type="target" position={Position.Left} className="tile__handle" />
      <div className={`tile__box${data.control ? " tile__box--control" : ""} tile__box--${state}`}>
        <Glyph name={data.glyph} size={34} />
        {!loose && <span className="tile__index mono">{data.index! + 1}</span>}
        {state !== "ok" && (
          <span className={`tile__badge tile__badge--${state}`} title={`${errors} error(s), ${warnings} warning(s)`}>
            {errors || warnings}
          </span>
        )}
      </div>
      <div className="tile__title">{data.title}</div>
      <div className="tile__subtitle">{loose ? "not connected" : data.subtitle}</div>
      <Handle type="source" position={Position.Right} className="tile__handle" />
    </div>
  );
}

export function StartTile() {
  return (
    <div className="tile tile--start" title="A run starts here">
      <div className="tile__start">
        <Glyph name="play" size={20} />
      </div>
      <div className="tile__subtitle">Start</div>
      <Handle type="source" position={Position.Right} className="tile__handle" />
    </div>
  );
}

export function AddTile({ data }: NodeProps<AddNode>) {
  return (
    <div className="tile tile--add">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button className="tile__add" onClick={data.onAdd} title="Add a step">
        <Glyph name="plus" size={24} />
      </button>
      <div className="tile__subtitle">{data.empty ? "Add the first step" : "Add a step"}</div>
    </div>
  );
}

export type PlusEdgeType = Edge<{ onInsert?: () => void; onCut?: () => void }, "plus">;

/** A connector with "+" (insert a step here) and "×" (cut) in the middle. */
export function PlusEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected }: EdgeProps<PlusEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={selected ? "edge--selected" : undefined} />
      {(data?.onInsert || data?.onCut) && (
        <EdgeLabelRenderer>
          <div
            className="edge-tools nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.onInsert && (
              <button className="edge-plus" onClick={data.onInsert} title="Insert a step here">
                <Glyph name="plus" size={12} />
              </button>
            )}
            {data.onCut && (
              <button className="edge-plus edge-plus--cut" onClick={data.onCut} title="Disconnect">
                <Glyph name="close" size={10} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const nodeTypes = { step: StepTile, start: StartTile, add: AddTile };
export const edgeTypes = { plus: PlusEdge };
