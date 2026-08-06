/**
 * Hash routing, hand-rolled.
 *
 * Three screens, no nested routes, no route params, no data loaders. React
 * Router would be a dependency and a set of concepts to learn for something
 * that is genuinely `window.location.hash` plus a listener. Hashes (rather
 * than the History API) also mean the app can be served from any static path
 * with no server rewrite rules.
 *
 * If routing ever grows params or nesting, replace this file with React
 * Router — `AppShell` and the screens don't know how routing works.
 */

import { useEffect, useState } from "react";

export const ROUTES = ["layout", "topology", "devices", "samples"] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = "layout";

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
