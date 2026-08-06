/**
 * Route → screen. That's the whole of it: the shell owns the chrome, each
 * screen owns its own header, fetching and layout.
 */

import { AppShell } from "./components/AppShell";
import { useHashRoute } from "./hooks/useHashRoute";
import { DevicesScreen } from "./screens/devices/DevicesScreen";
import { SamplesScreen } from "./screens/samples/SamplesScreen";
import { TopologyScreen } from "./screens/topology/TopologyScreen";

export function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route === "topology" && <TopologyScreen />}
      {route === "devices" && <DevicesScreen />}
      {route === "samples" && <SamplesScreen />}
    </AppShell>
  );
}
