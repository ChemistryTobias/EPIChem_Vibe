/** Route -> screen. The three Device Management pages are scaffolding only for now. */

import { Suspense, lazy } from "react";

import { AppShell } from "./components/AppShell";
import { useHashRoute } from "./hooks/useHashRoute";
import { DevicesScreen } from "./screens/device-management/devices/DevicesScreen";
import { HierarchyScreen } from "./screens/device-management/hierarchy/HierarchyScreen";
import { LayoutScreen } from "./screens/device-management/layout/LayoutScreen";
import { SamplesScreen } from "./screens/samples/SamplesScreen";

const WorkflowScreen = lazy(() =>
  import("./screens/workflow/WorkflowScreen").then((m) => ({ default: m.WorkflowScreen })),
);

export function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route === "hierarchy" && <HierarchyScreen />}
      {route === "layout" && <LayoutScreen />}
      {route === "devices" && <DevicesScreen />}
      {route === "samples" && <SamplesScreen />}
      {route === "workflow" && (
        <Suspense fallback={<div className="label">Loading…</div>}>
          <WorkflowScreen />
        </Suspense>
      )}
    </AppShell>
  );
}
