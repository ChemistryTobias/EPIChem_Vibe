/**
 * Route → screen. That's the whole of it: the shell owns the chrome, each
 * screen owns its own header, fetching and layout.
 *
 * The layout screen is lazy-loaded because it pulls in `@joint/core`, which
 * is bigger than everything else here put together (~435 kB of a 656 kB
 * bundle). Splitting it means the three list screens don't pay for a
 * diagramming library they never touch — and it's a one-import change
 * precisely because routing is this simple.
 */

import { Suspense, lazy } from "react";

import { AppShell } from "./components/AppShell";
import { useHashRoute } from "./hooks/useHashRoute";
import { DevicesScreen } from "./screens/devices/DevicesScreen";
import { SamplesScreen } from "./screens/samples/SamplesScreen";
import { TopologyScreen } from "./screens/topology/TopologyScreen";

const LayoutScreen = lazy(() =>
  import("./screens/layout/LayoutScreen").then((m) => ({ default: m.LayoutScreen })),
);

export function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route === "layout" && (
        <Suspense fallback={<div className="async async--loading label">Loading floor plan…</div>}>
          <LayoutScreen />
        </Suspense>
      )}
      {route === "topology" && <TopologyScreen />}
      {route === "devices" && <DevicesScreen />}
      {route === "samples" && <SamplesScreen />}
    </AppShell>
  );
}
