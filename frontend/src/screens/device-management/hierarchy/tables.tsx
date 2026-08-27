/**
 * One table page per level — what the level bar links to.
 *
 * Each is a plain sortable table of that entity, with parent references
 * resolved to the parent's name so a row reads without cross-referencing
 * UUIDs by hand.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { labsApi, modulesApi, sitesApi, stationsApi, zonesApi } from "../../../api/entities";
import type { Lab, Module, Site, Station, Zone } from "../../../api/types";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { formatDate, nameMap, orDash } from "../../format";

const nameCell = (name: string) => <span className="table__name">{name}</span>;

const updatedColumn = {
  id: "updated",
  header: "Updated",
  accessorFn: (row: { updated_at: string }) => row.updated_at,
  cell: (c: { row: { original: { updated_at: string } } }) => formatDate(c.row.original.updated_at),
};

export function SitesTable() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });

  const columns: Columns<Site> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name) },
      { accessorKey: "organisation", header: "Organisation", cell: (c) => orDash(c.row.original.organisation) },
      { accessorKey: "address", header: "Address", cell: (c) => orDash(c.row.original.address) },
      { accessorKey: "timezone", header: "Timezone", cell: (c) => orDash(c.row.original.timezone) },
      { id: "floors", header: "Floors", accessorFn: (row) => row.object_geometry.length },
      updatedColumn,
    ],
    [],
  );

  return (
    <QueryBoundary query={sites}>
      {(rows) => <DataTable data={rows} columns={columns} empty="No sites yet." />}
    </QueryBoundary>
  );
}

export function LabsTable() {
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const siteNames = useMemo(() => nameMap(sites.data), [sites.data]);

  const columns: Columns<Lab> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name) },
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
    [siteNames],
  );

  return (
    <QueryBoundary query={labs}>
      {(rows) => <DataTable data={rows} columns={columns} empty="No labs yet." />}
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

  const columns: Columns<Zone> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name) },
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
    [parentNames],
  );

  return (
    <QueryBoundary query={zones}>
      {(rows) => <DataTable data={rows} columns={columns} empty="No zones yet." />}
    </QueryBoundary>
  );
}

export function StationsTable() {
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const labNames = useMemo(() => nameMap(labs.data), [labs.data]);

  const columns: Columns<Station> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name) },
      {
        id: "lab",
        header: "Lab",
        accessorFn: (row) => labNames.get(row.lab_uuid) ?? "",
        cell: (c) => orDash(labNames.get(c.row.original.lab_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [labNames],
  );

  return (
    <QueryBoundary query={stations}>
      {(rows) => <DataTable data={rows} columns={columns} empty="No stations yet." />}
    </QueryBoundary>
  );
}

export function ModulesTable() {
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);

  const columns: Columns<Module> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => nameCell(c.row.original.name) },
      {
        id: "station",
        header: "Station",
        accessorFn: (row) => stationNames.get(row.station_uuid) ?? "",
        cell: (c) => orDash(stationNames.get(c.row.original.station_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      updatedColumn,
    ],
    [stationNames],
  );

  return (
    <QueryBoundary query={modules}>
      {(rows) => <DataTable data={rows} columns={columns} empty="No modules yet." />}
    </QueryBoundary>
  );
}
