/**
 * The Hierarchy section's frame: a one-line bar of views, then whichever one
 * is open.
 *
 * The bar is the tree, one entry per level, and a search — all one height,
 * all always present.
 *
 * The search query and the selected row live in contexts because the views
 * render through an `<Outlet />`, which can't take props. The inspector is
 * owned here rather than per-view, so it sits beside the content whichever
 * view is open.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

import { Button } from "../../../components/Button";
import { Inspector } from "../../../components/Inspector";
import { EntityInspector } from "../../../components/inspectors";
import { Menu } from "../../../components/Menu";
import { ADDABLE, CreatePanel, useCreator } from "../../../components/inspectors/create";
import { EditContext } from "../../../components/inspectors/edit";
import { InspectorNavContext } from "../../../components/inspectors/nav";
import { API_BY_KIND } from "../../../api/entities";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { SearchIcon, TreeIcon } from "../../../components/icons";
import { LEVELS } from "./hierarchyTree";
import type { EntityKind, EntityRow } from "../../../api/types";

import "./hierarchy.css";

const TREE_PATH = "/devices/hierarchy";

/** Level -> the table route that lists it. */
const LEVEL_PATHS: Record<string, string> = {
  Site: `${TREE_PATH}/sites`,
  Lab: `${TREE_PATH}/labs`,
  Station: `${TREE_PATH}/stations`,
  Module: `${TREE_PATH}/modules`,
  Zone: `${TREE_PATH}/zones`,
};

const SearchContext = createContext("");

/** The current search text, for whichever view is open. */
export const useHierarchySearch = () => useContext(SearchContext);

/** The row the inspector is showing, if any. */
export interface Selection {
  kind: EntityKind;
  row: EntityRow;
}

const SelectContext = createContext<(selection: Selection | null) => void>(() => {});

/** Open the inspector on a row — call from a name in a tree row or a table. */
export const useSelect = () => useContext(SelectContext);

export function HierarchyLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const creator = useCreator();
  /** The inspector's editor: whether it's open, and what it's changed. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const queryClient = useQueryClient();
  const dirty = Object.keys(draft).length > 0;

  // A row selected on one view isn't the row you're looking at on the next.
  useEffect(() => setSelected(null), [pathname]);

  const save = useMutation({
    mutationFn: (): Promise<unknown> =>
      selected
        ? API_BY_KIND[selected.kind].update(selected.row.uuid, draft)
        : Promise.resolve(null),
    onSuccess: async () => {
      setDraft({});
      setEditing(false);
      await queryClient.invalidateQueries();
    },
  });

  /** Leaving the editor with unsaved work asks first. */
  function leaveEditing() {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    setDraft({});
    setEditing(false);
  }

  /** Moving the panel to another record ends the edit it was in. */
  function show(next: Selection | null) {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    setDraft({});
    setEditing(false);
    setSelected(next);
  }

  const onTree = pathname === TREE_PATH;
  const current = onTree
    ? "Tree"
    : (Object.entries(LEVEL_PATHS).find(([, path]) => path === pathname)?.[0] ?? "Tree");

  return (
    <>
      <ScreenHeader
        title="Hierarchy"
        subtitle={onTree ? "Tree" : `${current}s`}
        actions={
          <>
            <Button variant="primary" onClick={() => creator.open("Device")}>
              New device
            </Button>
            {/* Everything but a device, which has its own control beside it. */}
            <Menu
              label="Add"
              items={ADDABLE.map((kind) => ({ id: kind, label: kind }))}
              onPick={(kind) => creator.open(kind as EntityKind)}
            />
            <Button disabled title="Importing isn't possible yet">
              Import
            </Button>
          </>
        }
      />

      <div className="screen">
        <div className="screen__content">
          <nav className="levels" aria-label="Hierarchy views">
            <Link
              to={TREE_PATH}
              className={
                onTree
                  ? "levels__item levels__item--icon levels__item--active"
                  : "levels__item levels__item--icon"
              }
              title="Tree"
              aria-label="Tree"
            >
              <TreeIcon />
            </Link>

            <div className="levels__list">
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
            </div>

            <div className="levels__search">
              <SearchIcon />
              <input
                type="search"
                value={query}
                placeholder={onTree ? "Search everything" : `Search ${current.toLowerCase()}s`}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </nav>

          <SearchContext.Provider value={query}>
            <SelectContext.Provider value={show}>
              <Outlet />
            </SelectContext.Provider>
          </SearchContext.Provider>
        </div>

        <Inspector
          open={creator.kind !== null || selected !== null}
          kind={creator.kind ?? selected?.kind ?? "Inspector"}
          title={
            creator.kind
              ? ((creator.draft.name as string | undefined) ?? "")
              : ((draft.name as string | undefined) ?? selected?.row.name)
          }
          subtitle={creator.kind ? undefined : selected?.row.uuid}
          onClose={() => (creator.kind ? creator.close() : show(null))}
          edit={creator.kind ? creator.edit : {
            editing,
            dirty,
            saving: save.isPending,
            onToggle: () => (editing ? leaveEditing() : setEditing(true)),
            onSave: () => save.mutate(),
            onCancel: leaveEditing,
            onRename: (name) => setDraft((d) => ({ ...d, name })),
          }}
        >
          {creator.kind ? (
            <CreatePanel
              kind={creator.kind}
              draft={creator.draft}
              set={creator.set}
              error={creator.error}
            />
          ) : (
          <InspectorNavContext.Provider value={show}>
            <EditContext.Provider
              value={{
                editing,
                draft,
                set: (field, value) => setDraft((d) => ({ ...d, [field]: value })),
              }}
            >
              {selected && <EntityInspector kind={selected.kind} row={selected.row} />}
            </EditContext.Provider>
          </InspectorNavContext.Provider>
          )}
        </Inspector>
      </div>
    </>
  );
}
