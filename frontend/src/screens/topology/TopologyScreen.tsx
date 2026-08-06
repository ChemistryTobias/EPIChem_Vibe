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

import { useCallback, useMemo, useState } from "react";

import { fetchTopology } from "../../api/topology";
import { AsyncBoundary } from "../../components/AsyncBoundary";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAsync } from "../../hooks/useAsync";
import { TopologyInspector } from "./TopologyInspector";
import { TopologyNode } from "./TopologyNode";
import { buildTopologyTree, collectNodeIds, countByKind } from "./topologyTree";
import type { TreeNode } from "./topologyTree";

import "./TopologyScreen.css";

export function TopologyScreen() {
  const state = useAsync(useCallback(() => fetchTopology(), []));
  const [selected, setSelected] = useState<TreeNode | null>(null);
  // null = "not touched yet", which means "expanded", so a freshly loaded
  // tree shows itself instead of six collapsed site rows.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  const tree = useMemo(
    () => (state.data ? buildTopologyTree(state.data) : null),
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
      `${counts.Workcell} workcells · ${counts.Bench} benches · ${counts.Station} stations`
    : "Site → Lab → Zone → Workcell → Bench → Station";

  return (
    <>
      <ScreenHeader
        title="Topology"
        subtitle={subtitle}
        actions={
          <>
            <Button onClick={() => setExpanded(new Set(allIds))}>Expand all</Button>
            <Button onClick={() => setExpanded(new Set())}>Collapse all</Button>
            <Button variant="primary" onClick={state.reload}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="screen">
        <div className="screen__content">
          <AsyncBoundary
            state={state}
            isEmpty={(data) => data.sites.length === 0}
            empty={
              <p>
                No sites registered. Import the example lab with{" "}
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

        <TopologyInspector node={selected} onClose={() => setSelected(null)} />
      </div>
    </>
  );
}
