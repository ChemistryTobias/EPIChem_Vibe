/**
 * Topology screen: the registry's containment hierarchy as an expandable
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
import { CreateInspector } from "./create/CreateInspector";
import type { CreateKind } from "./create/nodeCreate";
import { TopologyInspector } from "./TopologyInspector";
import { TopologyNode } from "./TopologyNode";
import {
  ancestorIds,
  buildParentIndex,
  buildTopologyTree,
  collectNodeIds,
  countByKind,
  injectDraft,
} from "./topologyTree";
import type { DraftNode, TreeNode } from "./topologyTree";

import "./TopologyScreen.css";

/** The "Add" menu, in containment order (outermost to innermost). */
const ADD_KINDS: CreateKind[] = ["Site", "Lab", "Zone", "Station"];

export function TopologyScreen() {
  const state = useAsync(useCallback(() => fetchTopology(), []));
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [creating, setCreating] = useState<CreateKind | null>(null);
  // The live draft the Create inspector is typing, previewed in the tree.
  const [preview, setPreview] = useState<DraftNode | null>(null);
  const onPreview = useCallback((draft: DraftNode | null) => setPreview(draft), []);
  // The <details> "Add" menu — closed after a pick so it doesn't linger open.
  const addMenu = useRef<HTMLDetailsElement>(null);

  const startCreate = (kind: CreateKind) => {
    setCreating(kind);
    if (addMenu.current) addMenu.current.open = false;
  };
  const stopCreate = () => setCreating(null);
  // null = "not touched yet", which means "expanded", so a freshly loaded
  // tree shows itself instead of six collapsed site rows.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  // The real tree, plus the live draft row grafted in at its future position.
  const tree = useMemo(
    () => (state.data ? injectDraft(buildTopologyTree(state.data), preview) : null),
    [state.data, preview],
  );

  const allIds = useMemo(() => (tree ? collectNodeIds(tree.roots) : []), [tree]);
  const parentIndex = useMemo(
    () => (state.data ? buildParentIndex(state.data) : new Map<string, string | null>()),
    [state.data],
  );

  // Clone the expansion set (never mutate the stored one), then force the draft's
  // whole lineage open so the new row stays visible even under a collapsed branch.
  const effectiveExpanded = useMemo(() => {
    const set = new Set(expanded ?? allIds);
    if (preview?.parentId) for (const id of ancestorIds(parentIndex, preview.parentId)) set.add(id);
    return set;
  }, [expanded, allIds, preview, parentIndex]);

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
          <AsyncBoundary
            state={state}
            isEmpty={(data) => data.sites.length === 0 && !creating}
            empty={
              <p>
                Nothing registered yet. Use <strong>New device</strong> or <strong>Add</strong>{" "}
                above — the form opens on the right and the new row previews here as you type — or
                import the example lab with{" "}
                <code className="mono">epichem import-dir --descriptors-dir ./descriptors</code>.
              </p>
            }
          >
            {() =>
              tree && (
                <>
                  <ul className="tree">
                    {tree.roots.map((node) => (
                      <TopologyNode
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

        {creating && state.data ? (
          <CreateInspector
            key={creating}
            kind={creating}
            snapshot={state.data}
            onPreview={onPreview}
            onCreated={() => {
              stopCreate();
              state.reload();
            }}
            onCancel={stopCreate}
            onSwitchKind={setCreating}
          />
        ) : (
          <TopologyInspector node={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </>
  );
}
