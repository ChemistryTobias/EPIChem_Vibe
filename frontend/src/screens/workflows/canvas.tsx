/**
 * The designer's canvas parts, n8n-style: a Start node, one tile per step (its
 * pictogram large, its name and what it does underneath, a status badge), an
 * end "+" to append, and edges carrying a "+" to insert between two steps.
 * Flow left to right; the canvas holds no state of its own (plan §10.3).
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getStraightPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";

import { Glyph } from "../../components/glyphs";

export interface StepTileData extends Record<string, unknown> {
  index: number;
  glyph: string;
  title: string;
  subtitle: string;
  control: boolean;
  errors: number;
  warnings: number;
  status?: string;
}

export type StepTileNode = Node<StepTileData, "step">;
export type AddNode = Node<{ onAdd: () => void; empty: boolean }, "add">;
export type StartNode = Node<Record<string, never>, "start">;

export function StepTile({ data, selected }: NodeProps<StepTileNode>) {
  const state = data.errors > 0 ? "error" : data.warnings > 0 ? "warning" : "ok";
  return (
    <div className={`tile${selected ? " tile--selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className={`tile__box${data.control ? " tile__box--control" : ""} tile__box--${state}`}>
        <Glyph name={data.glyph} size={34} />
        <span className="tile__index mono">{data.index + 1}</span>
        {state !== "ok" && (
          <span className={`tile__badge tile__badge--${state}`} title={`${data.errors} error(s), ${data.warnings} warning(s)`}>
            {data.errors || data.warnings}
          </span>
        )}
      </div>
      <div className="tile__title">{data.title}</div>
      <div className="tile__subtitle">{data.subtitle}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
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

export type PlusEdgeType = Edge<{ onInsert?: () => void }, "plus">;

/** A straight connector with a "+" in the middle that inserts a step there. */
export function PlusEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps<PlusEdgeType>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {data?.onInsert && (
        <EdgeLabelRenderer>
          <button
            className="edge-plus nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={data.onInsert}
            title="Insert a step here"
          >
            <Glyph name="plus" size={12} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const nodeTypes = { step: StepTile, start: StartTile, add: AddTile };
export const edgeTypes = { plus: PlusEdge };
