/**
 * Route tree, defined in code (not file-based) — the route set is small
 * enough to read in one screen, and code-based routing needs no codegen step.
 *
 * Device Management is a real nested route: `/devices/hierarchy`,
 * `/devices/layout`, `/devices/monitoring` all render inside one parent that
 * remembers which subpage you were last on. Workflows has two subpages,
 * `/workflows/designer` and `/workflows/runs`.
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
import { HierarchyLayout } from "./screens/device-management/hierarchy/HierarchyLayout";
import { HierarchyTree } from "./screens/device-management/hierarchy/HierarchyTree";
import {
  LabsTable,
  ModulesTable,
  SitesTable,
  StationsTable,
  ZonesTable,
} from "./screens/device-management/hierarchy/tables";
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
    const stored = window.localStorage.getItem(LAST_DEVICE_ROUTE_KEY) ?? "";
    // Prefix match, so a level table under Hierarchy (…/hierarchy/labs) is
    // remembered too, not just the three top-level subpages.
    const known = DEVICE_ROUTES.some(
      (route) => stored === route || stored.startsWith(`${route}/`),
    );
    return known ? stored : DEFAULT_DEVICE_ROUTE;
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

/** The tree, plus one table route per level — all under the level bar. */
const hierarchyRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "hierarchy",
  component: HierarchyLayout,
});

const hierarchyIndexRoute = createRoute({
  getParentRoute: () => hierarchyRoute,
  path: "/",
  component: HierarchyTree,
});

const levelRoutes = (
  [
    ["sites", SitesTable],
    ["labs", LabsTable],
    ["zones", ZonesTable],
    ["stations", StationsTable],
    ["modules", ModulesTable],
  ] as const
).map(([path, component]) =>
  createRoute({ getParentRoute: () => hierarchyRoute, path, component }),
);

const layoutRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "layout",
  // three.js is a large dependency; nobody who never opens the layout pays
  // for it.
  component: lazyRouteComponent(
    () => import("./screens/device-management/layout/LayoutScreen"),
    "LayoutScreen",
  ),
});

/** `?station=<uuid>` picks the station shown. */
const monitoringRoute = createRoute({
  getParentRoute: () => deviceMgmtRoute,
  path: "monitoring",
  validateSearch: (search: Record<string, unknown>): { station?: string } =>
    typeof search.station === "string" ? { station: search.station } : {},
  component: DeviceMonitoringScreen,
});

/** `?sample=SMP-…` opens that sample in the inspector — linkable from runs. */
const samplesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/samples",
  validateSearch: (search: Record<string, unknown>): { sample?: string } =>
    typeof search.sample === "string" ? { sample: search.sample } : {},
  component: SamplesScreen,
});

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows",
  component: Outlet,
});

const LAST_PROCEDURE_KEY = "epichem.lastProcedure";

/** The procedure the designer last had open, for the nav's Designer entry. */
export function lastProcedure(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROCEDURE_KEY);
  } catch {
    return null;
  }
}

export function rememberProcedure(uuid: string | null): void {
  try {
    if (uuid) window.localStorage.setItem(LAST_PROCEDURE_KEY, uuid);
    else window.localStorage.removeItem(LAST_PROCEDURE_KEY);
  } catch {
    // nothing useful to do
  }
}

const workflowsIndexRoute = createRoute({
  getParentRoute: () => workflowsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/workflows/procedures" });
  },
});

/** The library: find, create, duplicate, open. */
const proceduresRoute = createRoute({
  getParentRoute: () => workflowsRoute,
  path: "procedures",
  component: lazyRouteComponent(() => import("./screens/workflows/ProceduresScreen"), "ProceduresScreen"),
});

/** Bare /workflows/designer opens the last procedure, or the library. */
const designerIndexRoute = createRoute({
  getParentRoute: () => workflowsRoute,
  path: "designer",
  beforeLoad: () => {
    const last = lastProcedure();
    throw last
      ? redirect({ to: "/workflows/designer/$procedureId", params: { procedureId: last } })
      : redirect({ to: "/workflows/procedures" });
  },
});

// Lazy: this screen pulls in the diagramming library, which is bigger than
// the rest of the app put together. The other screens shouldn't pay for it.
const designerRoute = createRoute({
  getParentRoute: () => workflowsRoute,
  path: "designer/$procedureId",
  component: lazyRouteComponent(() => import("./screens/workflows/DesignerScreen"), "DesignerScreen"),
});

/** `?run=RUN-…` opens that run in the inspector — where Run lands you. */
const runsRoute = createRoute({
  getParentRoute: () => workflowsRoute,
  path: "runs",
  validateSearch: (search: Record<string, unknown>): { run?: string } =>
    typeof search.run === "string" ? { run: search.run } : {},
  component: lazyRouteComponent(() => import("./screens/workflows/RunsScreen"), "RunsScreen"),
});

/** The old single-page address, kept so bookmarks still land somewhere. */
const legacyWorkflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflow",
  beforeLoad: () => {
    throw redirect({ to: "/workflows/procedures" });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  deviceMgmtRoute.addChildren([
    deviceMgmtIndexRoute,
    hierarchyRoute.addChildren([hierarchyIndexRoute, ...levelRoutes]),
    layoutRoute,
    monitoringRoute,
  ]),
  samplesRoute,
  workflowsRoute.addChildren([workflowsIndexRoute, proceduresRoute, designerIndexRoute, designerRoute, runsRoute]),
  legacyWorkflowRoute,
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
