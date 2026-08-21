/** Route -> screen. Hierarchy/Device Status/Lab Layout are scaffolding only for now. */

import { Suspense, lazy } from "react";

import { AppShell } from "./components/AppShell";
import { Placeholder } from "./components/Placeholder";
import { useHashRoute } from "./hooks/useHashRoute";
import { SamplesScreen } from "./screens/samples/SamplesScreen";

const WorkflowScreen = lazy(() =>
  import("./screens/workflow/WorkflowScreen").then((m) => ({ default: m.WorkflowScreen })),
);

export function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route === "hierarchy" && <Placeholder title="Hierarchy" />}
      {route === "device-status" && <Placeholder title="Device Status" />}
      {route === "lab-layout" && <Placeholder title="Lab Layout" />}
      {route === "samples" && <SamplesScreen />}
      {route === "workflow" && (
        <Suspense fallback={<div className="label">Loading…</div>}>
          <WorkflowScreen />
        </Suspense>
      )}
    </AppShell>
  );
}
