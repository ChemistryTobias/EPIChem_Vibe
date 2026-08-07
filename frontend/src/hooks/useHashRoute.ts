/**
 * Hash routing, hand-rolled.
 *
 * Four routes, no nested routes, no route params, no data loaders. React
 * Router would be a dependency and a set of concepts to learn for something
 * that is genuinely `window.location.hash` plus a listener. Hashes (rather
 * than the History API) also mean the app can be served from any static path
 * with no server rewrite rules.
 *
 * Three of the routes (hierarchy / device-status / lab-layout) are the
 * subsections of the Device Management section (ADR 0009); `DEVICE_MGMT_ROUTES`
 * lets the sidebar know when that section is active. `samples` stands alone.
 *
 * If routing ever grows params or nesting, replace this file with React
 * Router — `AppShell` and the screens don't know how routing works.
 */

import { useEffect, useState } from "react";

/** The three subsections of Device Management, in nav order (ADR 0009). */
export const DEVICE_MGMT_ROUTES = ["hierarchy", "device-status", "lab-layout"] as const;

export const ROUTES = [...DEVICE_MGMT_ROUTES, "samples"] as const;

export type Route = (typeof ROUTES)[number];

/** Landing subsection: the Hierarchy list, the primary way into the tree. */
export const DEFAULT_ROUTE: Route = "hierarchy";

function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE;
}

export function navigate(route: Route): void {
  window.location.hash = `#/${route}`;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
