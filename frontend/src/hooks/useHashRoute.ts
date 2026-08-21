/** Hand-rolled hash routing — no route params, no nesting. */

import { useEffect, useState } from "react";

export const ROUTES = ["hierarchy", "devices", "layout", "samples", "workflow"] as const;
export type Route = (typeof ROUTES)[number];
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
