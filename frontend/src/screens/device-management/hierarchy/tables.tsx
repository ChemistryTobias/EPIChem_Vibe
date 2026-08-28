/**
 * One table page per level — what the level bar links to.
 *
 * Each is a sortable table of that entity, with parent references resolved to
 * the parent's name so a row reads without cross-referencing UUIDs by hand,
 * and narrowed by the bar's search. Modules and devices share the innermost
 * table: both are station children of the same shape, told apart by a Kind
 * column rather than by which endpoint they came from.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  devicesApi,
  labsApi,
  modulesApi,
  sitesApi,
  stationsApi,
  zonesApi,
} from "../../../api/entities";
import type { Lab, Module, Site, Station, Zone } from "../../../api/types";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { formatDate, matchesQuery, nameMap, orDash } from "../../format";
import { useHierarchySearch, useSelect } from "./HierarchyLayout";

/** The name is the control that opens the inspector on that row. */
const nameCell = (name: string, onSelect: () => void) => (
  <button type="button" data-inspects className="table__name" onClick={onSelect}>
    {name}
  </button>
);

const updatedColumn = {
  id: "updated",
  header: "Updated",
  accessorFn: (row: { updated_at: string }) => row.updated_at,
  cell: (c: { row: { original: { updated_at: string } } }) => formatDate(c.row.original.updated_at),
};

export function SitesTable() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const search = useHierarchySearch();
  const select = useSelect();

  const columns: Columns<Site> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name, () => select({ kind: "Site", row: c.row.original })) },
      { accessorKey: "organisation", header: "Organisation", cell: (c) => orDash(c.row.original.organisation) },
      { accessorKey: "address", header: "Address", cell: (c) => orDash(c.row.original.address) },
      { accessorKey: "timezone", header: "Timezone", cell: (c) => orDash(c.row.original.timezone) },
      { id: "floors", header: "Floors", accessorFn: (row) => row.object_geometry.length },
      updatedColumn,
    ],
    [select],
  );

  return (
    <QueryBoundary query={sites}>
      {(rows) => (
        <DataTable
          data={rows.filter((r) =>
            matchesQuery(search, r.name, r.description, r.organisation, r.address, r.timezone),
          )}
          columns={columns}
          empty="No sites here."
        />
      )}
    </QueryBoundary>
  );
}

export function LabsTable() {
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const siteNames = useMemo(() => nameMap(sites.data), [sites.data]);
  const search = useHierarchySearch();
  const select = useSelect();

  const columns: Columns<Lab> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name, () => select({ kind: "Lab", row: c.row.original })) },
      {
        id: "site",
        header: "Site",
        accessorFn: (row) => siteNames.get(row.site_uuid) ?? "",
        cell: (c) => orDash(siteNames.get(c.row.original.site_uuid)),
      },
      { accessorKey: "room_number", header: "Room", cell: (c) => orDash(c.row.original.room_number) },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [siteNames, select],
  );

  return (
    <QueryBoundary query={labs}>
      {(rows) => (
        <DataTable
          data={rows.filter((r) =>
            matchesQuery(search, r.name, r.description, r.room_number, siteNames.get(r.site_uuid)),
          )}
          columns={columns}
          empty="No labs here."
        />
      )}
    </QueryBoundary>
  );
}

export function ZonesTable() {
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  // A zone hangs off either a site or a lab, so resolving its parent means
  // looking in both.
  const parentNames = useMemo(
    () => new Map([...nameMap(sites.data), ...nameMap(labs.data)]),
    [sites.data, labs.data],
  );
  const search = useHierarchySearch();
  const select = useSelect();

  const columns: Columns<Zone> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name, () => select({ kind: "Zone", row: c.row.original })) },
      { accessorKey: "tag", header: "Tag", cell: (c) => orDash(c.row.original.tag) },
      {
        id: "parent",
        header: "Parent",
        accessorFn: (row) => parentNames.get(row.parent_uuid) ?? "",
        cell: (c) => orDash(parentNames.get(c.row.original.parent_uuid)),
      },
      { accessorKey: "parent_type", header: "Parent kind", cell: (c) => orDash(c.row.original.parent_type) },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [parentNames, select],
  );

  return (
    <QueryBoundary query={zones}>
      {(rows) => (
        <DataTable
          data={rows.filter((r) =>
            matchesQuery(search, r.name, r.description, r.tag, r.parent_type, parentNames.get(r.parent_uuid)),
          )}
          columns={columns}
          empty="No zones here."
        />
      )}
    </QueryBoundary>
  );
}

export function StationsTable() {
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const labNames = useMemo(() => nameMap(labs.data), [labs.data]);
  const search = useHierarchySearch();
  const select = useSelect();

  const columns: Columns<Station> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name, () => select({ kind: "Station", row: c.row.original })) },
      {
        id: "lab",
        header: "Lab",
        accessorFn: (row) => labNames.get(row.lab_uuid) ?? "",
        cell: (c) => orDash(labNames.get(c.row.original.lab_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [labNames, select],
  );

  return (
    <QueryBoundary query={stations}>
      {(rows) => (
        <DataTable
          data={rows.filter((r) =>
            matchesQuery(search, r.name, r.description, labNames.get(r.lab_uuid)),
          )}
          columns={columns}
          empty="No stations here."
        />
      )}
    </QueryBoundary>
  );
}

/** A module or device, tagged with which one it is. */
type StationChild = Module & { kind: "Module" | "Device" };

export function ModulesTable() {
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);
  const search = useHierarchySearch();
  const select = useSelect();

  const rows: StationChild[] = useMemo(
    () => [
      ...(modules.data ?? []).map((m) => ({ ...m, kind: "Module" as const })),
      ...(devices.data ?? []).map((d) => ({ ...d, kind: "Device" as const })),
    ],
    [modules.data, devices.data],
  );

  const columns: Columns<StationChild> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name, () => select({ kind: c.row.original.kind, row: c.row.original })) },
      { accessorKey: "kind", header: "Kind" },
      {
        id: "station",
        header: "Station",
        accessorFn: (row) => stationNames.get(row.station_uuid) ?? "",
        cell: (c) => orDash(stationNames.get(c.row.original.station_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [stationNames, select],
  );

  return (
    <QueryBoundary query={modules}>
      {() => (
        <DataTable
          data={rows.filter((r) =>
            matchesQuery(search, r.name, r.description, r.kind, stationNames.get(r.station_uuid)),
          )}
          columns={columns}
          empty="No modules or devices here."
        />
      )}
    </QueryBoundary>
  );
}
