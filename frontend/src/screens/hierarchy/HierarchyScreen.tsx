/**
 * Hierarchy screen: the registry's containment hierarchy as an expandable
 * tree, with a detail panel for the selected node.
 *
 * A tree, not the plan's isometric lab layout (§10.2). That view is a later
 * milestone and is still blocked on the JointJS+ vs @joint/core licensing
 * question (docs/adr/0003 Q1) — see PROJECT_MILESTONES.md. Nothing here
 * forecloses it: this screen reads the same six endpoints an isometric view
 * would.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { fetchTopology } from "../../api/topology";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import { CreatePanel } from "./create/CreatePanel";
import type { CreateKind } from "./create/nodeCreate";
import { HierarchyInspector } from "./HierarchyInspector";
import { HierarchyNode } from "./HierarchyNode";
import { buildHierarchyTree, collectNodeIds, countByKind } from "./hierarchyTree";
import type { TreeNode } from "./hierarchyTree";

import "./HierarchyScreen.css";

/** The "+ Add" menu, in order: the common targets first, the rare ones last. */
const ADD_KINDS: CreateKind[] = ["Station", "Site", "Lab", "Zone"];

export function HierarchyScreen() {
  const state = useAsync(useCallback(() => fetchTopology(), []));
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [creating, setCreating] = useState<CreateKind | null>(null);
  // The <details> "+ Add" menu — closed after a pick so it doesn't linger open.
  const addMenu = useRef<HTMLDetailsElement>(null);

  const startCreate = (kind: CreateKind) => {
    setCreating(kind);
    if (addMenu.current) addMenu.current.open = false;
  };
  // null = "not touched yet", which means "expanded", so a freshly loaded
  // tree shows itself instead of six collapsed site rows.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  const tree = useMemo(
    () => (state.data ? buildHierarchyTree(state.data) : null),
    [state.data],
  );

  const allIds = useMemo(() => (tree ? collectNodeIds(tree.roots) : []), [tree]);
  const effectiveExpanded = expanded ?? new Set(allIds);

  const toggle = (id: string) => {
    const next = new Set(effectiveExpanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const counts = tree ? countByKind(tree.roots) : null;
  const subtitle = counts
    ? `${counts.Site} sites · ${counts.Lab} labs · ${counts.Zone} zones · ` +
      `${counts.Station} stations · ${counts.Device} devices`
    : "Site → Lab → Zone → Station → Device";

  return (
    <>
      <ScreenHeader
        title="Device management — Hierarchy"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="primary" onClick={() => startCreate("Device")}>
              New device
            </Button>
            <details className="add-menu" ref={addMenu}>
              <summary className="add-menu__summary">Add</summary>
              <div className="add-menu__list">
                {ADD_KINDS.map((kind) => (
                  <button
                    key={kind}
                    className="add-menu__item"
                    onClick={() => startCreate(kind)}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </details>
          </>
        }
      />

      <div className="screen">
        <div className="screen__content">
          {creating && state.data && (
            <CreatePanel
              target={creating}
              snapshot={state.data}
              onCreated={state.reload}
              onClose={() => setCreating(null)}
            />
          )}

          <AsyncBoundary
            state={state}
            isEmpty={(data) => data.sites.length === 0}
            empty={
              <p>
                Nothing registered yet. Use <strong>New device</strong> above — it walks you
                through the site, lab and station it needs — or import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {() =>
              tree && (
                <>
                  <ul className="tree">
                    {tree.roots.map((node) => (
                      <HierarchyNode
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedId={selected?.id ?? null}
                        expanded={effectiveExpanded}
                        onSelect={setSelected}
                        onToggle={toggle}
                      />
                    ))}
                  </ul>

                  {/* Surfaced rather than hidden: a row pointing at a parent
                      that isn't there is a registry problem to fix. */}
                  {tree.orphans.length > 0 && (
                    <div className="tree__orphans" role="alert">
                      <p className="label">Not shown in the tree</p>
                      <p className="tree__orphans-note">
                        These rows name a parent that isn&apos;t in the registry:
                      </p>
                      <ul>
                        {tree.orphans.map((o) => (
                          <li key={`${o.kind}-${o.code}`} className="mono">
                            {o.kind} {o.code} → missing parent {o.parentId}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )
            }
          </AsyncBoundary>
        </div>

        <HierarchyInspector node={selected} onClose={() => setSelected(null)} />
      </div>
    </>
  );
}
