import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Alert } from "../../components/Alert";
import { ScreenHeader } from "../../components/ScreenHeader";
import { MOCK_EDGES, MOCK_NODES } from "./mockWorkflow";

import "./WorkflowScreen.css";

export function WorkflowScreen() {
  return (
    <>
      <ScreenHeader title="Workflow Designer" subtitle="Node-based procedure editor — mockup" />
      <div className="screen">
        <div className="screen__content workflow-canvas">
          <Alert kind="info">
            Static mockup of a plausible procedure — no procedure IR or backend exists yet.
          </Alert>
          <div className="workflow-canvas__flow">
            <ReactFlow nodes={MOCK_NODES} edges={MOCK_EDGES} fitView>
              <Background color="var(--color-grey-semilight)" />
            </ReactFlow>
          </div>
        </div>
      </div>
    </>
  );
}
