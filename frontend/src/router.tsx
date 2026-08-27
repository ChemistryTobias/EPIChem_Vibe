/**
 * Route tree, defined in code (not file-based) — the route set is small
 * enough to read in one screen, and code-based routing needs no codegen step.
 *
 * Device Management is a real nested route: `/devices/hierarchy`,
 * `/devices/layout`, `/devices/status` all render inside one parent that
 * remembers which subpage you were last on.
 */

import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";

import { AppShell } from "./components/AppShell";
import { DevicesScreen } from "./screens/device-management/devices/DevicesScreen";
import { HierarchyScreen } from "./screens/device-management/hierarchy/HierarchyScreen";
import { LayoutScreen } from "./screens/device-management/layout/LayoutScreen";
import { SamplesScreen } from "./screens/samples/SamplesScreen";

const LAST_DEVICE_ROUTE_KEY = "epichem.lastDeviceRoute";
export const DEFAULT_DEVICE_ROUTE = "/devices/hierarchy";

/** Which Device Management subpage to land on when entering the section. */
export function lastDeviceRoute(): string {
  try {
    return window.localStorage.getItem(LAST_DEVICE_ROUTE_KEY) ?? DEFAULT_DEVICE_ROUTE;
  } catch {
    return DEFAULT_DEVICE_ROUTE;
  }
}

export function rememberDeviceRoute(path: string): void {
  try {
    window.localStorage.setItem(LAST_DEVICE_ROUTE_KEY, path);
  } catch {
    // nothing useful to do — the section just won't remember
  }
}

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: lastDeviceRoute() });
  },
});

const deviceMgmtRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: Outlet,
});

/** Bare `/devices` resolves to whichever subpage you were last on. */
const deviceMgmtIndexRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: lastDeviceRoute() });
  },
});

const hierarchyRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "hierarchy",
  component: HierarchyScreen,
});

const layoutRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "layout",
  component: LayoutScreen,
});

const statusRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "status",
  component: DevicesScreen,
});

const samplesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/samples",
  component: SamplesScreen,
});

// Lazy: this screen pulls in the diagramming library, which is bigger than
// the rest of the app put together. The other screens shouldn't pay for it.
const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflow",
  component: lazyRouteComponent(() => import("./screens/workflow/WorkflowScreen"), "WorkflowScreen"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  deviceMgmtRoute.addChildren([deviceMgmtIndexRoute, hierarchyRoute, layoutRoute, statusRoute]),
  samplesRoute,
  workflowRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
