/** The whole registry as one expandable tree. */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  devicesApi,
  labsApi,
  modulesApi,
  sitesApi,
  stationsApi,
  zonesApi,
} from "../../../api/entities";
import { Alert } from "../../../components/Alert";
import { useHierarchySearch, useSelect } from "./HierarchyLayout";
import { buildTree, collectUuids, filterTree } from "./hierarchyTree";
import { TreeRow } from "./TreeRow";

export function HierarchyTree() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });

  const queries = [sites, labs, zones, stations, modules, devices];
  const loading = queries.some((q) => q.isPending);
  const failed = queries.find((q) => q.isError);

  const search = useHierarchySearch();
  const select = useSelect();

  const tree = useMemo(
    () =>
      buildTree({
        sites: sites.data ?? [],
        labs: labs.data ?? [],
        zones: zones.data ?? [],
        stations: stations.data ?? [],
        modules: modules.data ?? [],
        devices: devices.data ?? [],
      }),
    [sites.data, labs.data, zones.data, stations.data, modules.data, devices.data],
  );

  const shown = useMemo(() => filterTree(tree, search), [tree, search]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Everything starts expanded — a registry this size is more useful open
  // than as a row of collapsed sites. Re-expands whatever a search narrowed
  // to, so matches deep in the tree aren't hidden behind a collapsed parent.
  useEffect(() => {
    setExpanded(new Set(collectUuids(shown)));
  }, [shown]);

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
  if (shown.length === 0) return <p className="muted">Nothing matches “{search}”.</p>;

  return (
    <ul className="tree">
      {shown.map((node) => (
        <TreeRow
          key={node.uuid}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onSelect={(n) => select({ kind: n.kind, row: n.row })}
        />
      ))}
    </ul>
  );
}
