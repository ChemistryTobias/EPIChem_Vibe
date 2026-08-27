/**
 * The Hierarchy section's frame: a bar of views, then whichever one is open.
 *
 * The bar is the tree plus one entry per level, all sharing a button design,
 * and a search that narrows whatever is currently open — the whole tree on
 * the tree view, that level's rows on a table. The query lives in a context
 * because the views render through an `<Outlet />`, which can't take props.
 */

import { createContext, useContext, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

import { ScreenHeader } from "../../../components/ScreenHeader";
import { SearchIcon, TreeIcon } from "../../../components/icons";
import { LEVELS } from "./hierarchyTree";

import "./hierarchy.css";

const TREE_PATH = "/devices/hierarchy";

/** Level -> the table route that lists it, and the label the bar shows. */
const LEVEL_PATHS: Record<string, string> = {
  Site: `${TREE_PATH}/sites`,
  Lab: `${TREE_PATH}/labs`,
  Zone: `${TREE_PATH}/zones`,
  Station: `${TREE_PATH}/stations`,
  Module: `${TREE_PATH}/modules`,
};

const SearchContext = createContext("");

/** The current search text, for whichever view is open. */
export const useHierarchySearch = () => useContext(SearchContext);

export function HierarchyLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const onTree = pathname === TREE_PATH;
  const current = onTree
    ? "Tree"
    : (Object.entries(LEVEL_PATHS).find(([, path]) => path === pathname)?.[0] ?? "Tree");

  return (
    <>
      <ScreenHeader title="Hierarchy" subtitle={onTree ? "Tree" : `${current}s`} />

      <div className="screen">
        <div className="screen__content">
          <nav className="levels" aria-label="Hierarchy views">
            <Link
              to={TREE_PATH}
              className={onTree ? "levels__item levels__item--active" : "levels__item"}
              title="Tree"
              aria-label="Tree"
            >
              <TreeIcon />
            </Link>

            {LEVELS.map((level) => {
              const path = LEVEL_PATHS[level];
              return (
                <Link
                  key={level}
                  to={path}
                  className={
                    pathname === path ? "levels__item levels__item--active" : "levels__item"
                  }
                >
                  {level}s
                </Link>
              );
            })}

            <button
              type="button"
              className={searching ? "levels__item levels__item--active" : "levels__item"}
              // Closing the search clears it, so a hidden query can't keep
              // filtering a view that looks unfiltered.
              onClick={() => {
                setSearching((open) => !open);
                if (searching) setQuery("");
              }}
              title="Search"
              aria-label="Search"
              aria-expanded={searching}
            >
              <SearchIcon />
            </button>

            {searching && (
              <input
                className="levels__search"
                type="search"
                value={query}
                autoFocus
                placeholder={onTree ? "Search everything" : `Search ${current.toLowerCase()}s`}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </nav>

          <SearchContext.Provider value={query}>
            <Outlet />
          </SearchContext.Provider>
        </div>
      </div>
    </>
  );
}
