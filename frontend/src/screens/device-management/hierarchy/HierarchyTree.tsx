/** The whole registry as one expandable tree. */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { labsApi, modulesApi, sitesApi, stationsApi, zonesApi } from "../../../api/entities";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { buildTree, collectUuids } from "./hierarchyTree";
import { TreeRow } from "./TreeRow";

export function HierarchyTree() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });

  const loading = [sites, labs, zones, stations, modules].some((q) => q.isPending);
  const failed = [sites, labs, zones, stations, modules].find((q) => q.isError);

  const tree = useMemo(
    () =>
      buildTree({
        sites: sites.data ?? [],
        labs: labs.data ?? [],
        zones: zones.data ?? [],
        stations: stations.data ?? [],
        modules: modules.data ?? [],
      }),
    [sites.data, labs.data, zones.data, stations.data, modules.data],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Everything starts expanded — a registry this size is more useful open
  // than as a row of collapsed sites.
  useEffect(() => {
    setExpanded(new Set(collectUuids(tree)));
  }, [tree]);

  function toggle(uuid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  if (failed) return <Alert kind="error">{failed.error.message}</Alert>;
  if (loading) return <p className="muted">Loading…</p>;
  if (tree.length === 0) return <p className="muted">No sites yet.</p>;

  return (
    <>
      <div className="tree__actions">
        <Button size="sm" onClick={() => setExpanded(new Set(collectUuids(tree)))}>
          Expand all
        </Button>
        <Button size="sm" onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
      </div>

      <ul className="tree">
        {tree.map((node) => (
          <TreeRow key={node.uuid} node={node} depth={0} expanded={expanded} onToggle={toggle} />
        ))}
      </ul>
    </>
  );
}
