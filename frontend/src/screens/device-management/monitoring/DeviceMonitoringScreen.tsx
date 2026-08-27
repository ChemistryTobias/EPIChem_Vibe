/**
 * Device monitoring: every device and the state it is currently in.
 *
 * The registry half is real; the live half is not. The backend has no device
 * plane yet — no runtime state to read — so Status is a placeholder column
 * rather than a made-up value. Modules aren't listed here: this screen is
 * about controllable devices, and modules live in the Hierarchy.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { devicesApi, stationsApi } from "../../../api/entities";
import type { Device } from "../../../api/types";
import { Alert } from "../../../components/Alert";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { formatDate, nameMap, orDash } from "../../format";

export function DeviceMonitoringScreen() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);

  const columns: Columns<Device> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      {
        id: "station",
        header: "Station",
        accessorFn: (row) => stationNames.get(row.station_uuid) ?? "",
        cell: (c) => orDash(stationNames.get(c.row.original.station_uuid)),
      },
      {
        id: "status",
        header: "Status",
        // No live state exists to read yet — an em dash is honest, a green
        // "OK" dot would not be.
        accessorFn: () => "",
        cell: () => <span className="muted">not monitored yet</span>,
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [stationNames],
  );

  return (
    <>
      <ScreenHeader title="Device Monitoring" subtitle="Devices and their current state" />

      <div className="screen">
        <div className="screen__content">
          <section className="section">
            <Alert kind="info">
              Live device state isn't built yet — these are the registry records, and the Status
              column is a placeholder.
            </Alert>
          </section>

          <section className="section">
            <QueryBoundary query={devices}>
              {(rows) => <DataTable data={rows} columns={columns} empty="No devices yet." />}
            </QueryBoundary>
          </section>
        </div>
      </div>
    </>
  );
}
