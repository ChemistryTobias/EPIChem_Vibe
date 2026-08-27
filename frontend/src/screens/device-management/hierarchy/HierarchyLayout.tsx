/**
 * The Hierarchy section's frame: the level bar, then whichever view is open.
 *
 * The bar lists the levels in containment order, each stepped right by the
 * same indent the tree uses for that depth — so it reads as a key to the tree
 * below it. Clicking a level leaves the tree and opens that level's own table.
 */

import { Link, Outlet, useRouterState } from "@tanstack/react-router";

import { ScreenHeader } from "../../../components/ScreenHeader";
import { LEVELS } from "./hierarchyTree";
import { indentFor } from "./indent";

import "./hierarchy.css";

/** Level -> the table route that lists it. */
const LEVEL_PATHS: Record<string, string> = {
  Site: "/devices/hierarchy/sites",
  Lab: "/devices/hierarchy/labs",
  Zone: "/devices/hierarchy/zones",
  Station: "/devices/hierarchy/stations",
  Module: "/devices/hierarchy/modules",
};

export function HierarchyLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onTree = pathname === "/devices/hierarchy";

  return (
    <>
      <ScreenHeader
        title="Hierarchy"
        subtitle="Site → Lab → Zone → Station → Module"
        actions={
          !onTree && (
            <Link to="/devices/hierarchy" className="btn btn--sm">
              Back to tree
            </Link>
          )
        }
      />

      <div className="screen">
        <div className="screen__content">
          <nav className="levels" aria-label="Levels">
            {LEVELS.map((level, depth) => {
              const path = LEVEL_PATHS[level];
              return (
                <Link
                  key={level}
                  to={path}
                  className={
                    pathname === path ? "levels__item levels__item--active" : "levels__item"
                  }
                  style={{ marginLeft: `${indentFor(depth)}px` }}
                >
                  {level}s
                </Link>
              );
            })}
          </nav>

          <Outlet />
        </div>
      </div>
    </>
  );
}
