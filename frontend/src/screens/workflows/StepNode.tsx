/**
 * One procedure step on the canvas (plan §10.4's node, the linear subset):
 * its position in the sequence, the plan it calls, a compact parameter
 * summary, and a badge for what validation found. Flow ports only — material
 * ports arrive with lineage (Roadmap 3's later stages).
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import type { ProcedureStep } from "../../api/types";
import { summarize } from "./plans";

export interface StepNodeData extends Record<string, unknown> {
  step: ProcedureStep;
  index: number;
  group: string;
  errors: number;
  warnings: number;
  unknown: boolean;
}

export type StepNodeType = Node<StepNodeData, "step">;

export function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const { step, index, group, errors, warnings, unknown } = data;
  const state = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
  return (
    <div className={`step-node step-node--${state}${selected ? " step-node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="step-node__top">
        <span className="step-node__index mono">{index + 1}</span>
        <span className="step-node__group">{unknown ? "not on this station" : group}</span>
      </div>
      <div className="step-node__plan">{step.label || step.plan}</div>
      {step.label && <div className="step-node__sub mono">{step.plan}</div>}
      <div className="step-node__summary mono">{summarize(step) || <span className="muted">no parameters set</span>}</div>
      <div className="step-node__badge">
        {errors > 0
          ? `${errors} error${errors === 1 ? "" : "s"}`
          : warnings > 0
            ? `${warnings} warning${warnings === 1 ? "" : "s"}`
            : "ready"}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
