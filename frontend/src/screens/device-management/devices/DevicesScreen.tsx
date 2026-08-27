/**
 * Devices and modules, both hanging off a station.
 *
 * They are separate sections rather than one list because they are separate
 * backend entities — though today their schemas are identical, since the
 * descriptor fields (ophyd/transport/network/safety) aren't built yet.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { devicesApi, modulesApi, stationsApi } from "../../../api/entities";
import type { Module } from "../../../api/types";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { formatDate, nameMap, orDash } from "../../format";

export function DevicesScreen() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);

  // Device and Module share a shape, so one column set serves both tables.
  const columns: Columns<Module> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      {
        id: "station",
        header: "Station",
        accessorFn: (row) => stationNames.get(row.station_uuid) ?? "",
        cell: (c) => orDash(stationNames.get(c.row.original.station_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      {
        id: "geometry",
        header: "Shape",
        accessorFn: (row) => row.object_geometry?.shape ?? "",
        cell: (c) => orDash(c.row.original.object_geometry?.shape),
      },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [stationNames],
  );

  return (
    <>
      <ScreenHeader title="Devices" subtitle="Devices and modules, by station" />

      <div className="screen">
        <div className="screen__content">
          <section className="section">
            <h2 className="section__title">Devices</h2>
            <QueryBoundary query={devices}>
              {(rows) => <DataTable data={rows} columns={columns} empty="No devices yet." />}
            </QueryBoundary>
          </section>

          <section className="section">
            <h2 className="section__title">Modules</h2>
            <QueryBoundary query={modules}>
              {(rows) => <DataTable data={rows} columns={columns} empty="No modules yet." />}
            </QueryBoundary>
          </section>
        </div>
      </div>
    </>
  );
}
