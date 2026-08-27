/**
 * The registry hierarchy, one section per level: Sites, Labs, Stations.
 *
 * Each section is a sortable table of what the backend actually holds today
 * — parent references are resolved to the parent's name so a row reads
 * without cross-referencing UUIDs by hand.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { labsApi, sitesApi, stationsApi } from "../../../api/entities";
import type { Lab, Site, Station } from "../../../api/types";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { formatDate, nameMap, orDash } from "../../format";

export function HierarchyScreen() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const siteNames = useMemo(() => nameMap(sites.data), [sites.data]);
  const labNames = useMemo(() => nameMap(labs.data), [labs.data]);

  const siteColumns: Columns<Site> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      { accessorKey: "organisation", header: "Organisation", cell: (c) => orDash(c.row.original.organisation) },
      { accessorKey: "address", header: "Address", cell: (c) => orDash(c.row.original.address) },
      { accessorKey: "timezone", header: "Timezone", cell: (c) => orDash(c.row.original.timezone) },
      {
        id: "floors",
        header: "Floors",
        accessorFn: (row) => row.object_geometry.length,
      },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [],
  );

  const labColumns: Columns<Lab> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      {
        id: "site",
        header: "Site",
        accessorFn: (row) => siteNames.get(row.site_uuid) ?? "",
        cell: (c) => orDash(siteNames.get(c.row.original.site_uuid)),
      },
      { accessorKey: "room_number", header: "Room", cell: (c) => orDash(c.row.original.room_number) },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [siteNames],
  );

  const stationColumns: Columns<Station> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      {
        id: "lab",
        header: "Lab",
        accessorFn: (row) => labNames.get(row.lab_uuid) ?? "",
        cell: (c) => orDash(labNames.get(c.row.original.lab_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [labNames],
  );

  return (
    <>
      <ScreenHeader title="Hierarchy" subtitle="Site → Lab → Station" />

      <div className="screen">
        <div className="screen__content">
          <section className="section">
            <h2 className="section__title">Sites</h2>
            <QueryBoundary query={sites}>
              {(rows) => <DataTable data={rows} columns={siteColumns} empty="No sites yet." />}
            </QueryBoundary>
          </section>

          <section className="section">
            <h2 className="section__title">Labs</h2>
            <QueryBoundary query={labs}>
              {(rows) => <DataTable data={rows} columns={labColumns} empty="No labs yet." />}
            </QueryBoundary>
          </section>

          <section className="section">
            <h2 className="section__title">Stations</h2>
            <QueryBoundary query={stations}>
              {(rows) => <DataTable data={rows} columns={stationColumns} empty="No stations yet." />}
            </QueryBoundary>
          </section>
        </div>
      </div>
    </>
  );
}
