/**
 * Route tree, defined in code (not file-based) — the route set is small
 * enough to read in one screen, and code-based routing needs no codegen step.
 *
 * Device Management is a real nested route: `/devices/hierarchy`,
 * `/devices/layout`, `/devices/monitoring` all render inside one parent that
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
import { HierarchyScreen } from "./screens/device-management/hierarchy/HierarchyScreen";
import { LayoutScreen } from "./screens/device-management/layout/LayoutScreen";
import { DeviceMonitoringScreen } from "./screens/device-management/monitoring/DeviceMonitoringScreen";
import { SamplesScreen } from "./screens/samples/SamplesScreen";

const LAST_DEVICE_ROUTE_KEY = "epichem.lastDeviceRoute";
export const DEFAULT_DEVICE_ROUTE = "/devices/hierarchy";

export const DEVICE_ROUTES = [
  DEFAULT_DEVICE_ROUTE,
  "/devices/layout",
  "/devices/monitoring",
] as const;

/**
 * Which Device Management subpage to land on when entering the section.
 * Validated against the current route set, so a path stored before a route
 * was renamed falls back rather than redirecting into a 404.
 */
export function lastDeviceRoute(): string {
  try {
    const stored = window.localStorage.getItem(LAST_DEVICE_ROUTE_KEY);
    return (DEVICE_ROUTES as readonly string[]).includes(stored ?? "")
      ? (stored as string)
      : DEFAULT_DEVICE_ROUTE;
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

const monitoringRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "monitoring",
  component: DeviceMonitoringScreen,
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
  deviceMgmtRoute.addChildren([deviceMgmtIndexRoute, hierarchyRoute, layoutRoute, monitoringRoute]),
  samplesRoute,
  workflowRoute,
]);

export const router = createRouter({
  routeTree,
  // An unknown URL (or one stored before a route was renamed) should say so
  // and offer a way back, not dead-end on the library's bare default.
  defaultNotFoundComponent: () => (
    <div className="screen__content">
      <h1>Not found</h1>
      <p className="muted">
        No such page. <a href={DEFAULT_DEVICE_ROUTE}>Back to Hierarchy</a>
      </p>
    </div>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
