/**
 * The registry, one level at a time.
 *
 * Each level is a collapsible table and only one is open at a time — picking
 * a level from the stack is how you choose what to look at. Clicking a row's
 * name drills into its children (site → labs → stations → modules), which
 * opens that level filtered to the parent you came from; the chip above the
 * table clears the filter. Zones are a grouping rather than a level of the
 * containment chain, so they list their parent instead of drilling.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { labsApi, modulesApi, sitesApi, stationsApi, zonesApi } from "../../../api/entities";
import type { Lab, Module, Site, Station, Zone } from "../../../api/types";
import { CollapsibleSection } from "../../../components/CollapsibleSection";
import { DataTable } from "../../../components/DataTable";
import type { Columns } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { formatDate, nameMap, orDash } from "../../format";

import "./HierarchyScreen.css";

type Level = "sites" | "labs" | "zones" | "stations" | "modules";

/** Narrows a level to the children of one parent row. */
interface Filter {
  level: Level;
  parentUuid: string;
  parentName: string;
}

export function HierarchyScreen() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });

  const [openLevel, setOpenLevel] = useState<Level>("sites");
  const [filter, setFilter] = useState<Filter | null>(null);

  const siteNames = useMemo(() => nameMap(sites.data), [sites.data]);
  const labNames = useMemo(() => nameMap(labs.data), [labs.data]);
  const stationNames = useMemo(() => nameMap(stations.data), [stations.data]);
  // A zone hangs off either a site or a lab, so resolving its parent means
  // looking in both.
  const parentNames = useMemo(
    () => new Map([...siteNames, ...labNames]),
    [siteNames, labNames],
  );

  /** Opening a level from the stack means browsing all of it. */
  function openWholeLevel(level: Level) {
    setOpenLevel(level);
    setFilter(null);
  }

  function drillTo(level: Level, parentUuid: string, parentName: string) {
    setOpenLevel(level);
    setFilter({ level, parentUuid, parentName });
  }

  /** The filter only applies to the level it was created for. */
  const filterFor = (level: Level) => (filter?.level === level ? filter : null);

  const drillCell = (label: string, onClick: () => void) => (
    <button type="button" className="table__drill" onClick={onClick}>
      {label}
    </button>
  );

  const siteColumns: Columns<Site> = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (c) =>
          drillCell(c.row.original.name, () =>
            drillTo("labs", c.row.original.uuid, c.row.original.name),
          ),
      },
      { accessorKey: "organisation", header: "Organisation", cell: (c) => orDash(c.row.original.organisation) },
      { accessorKey: "address", header: "Address", cell: (c) => orDash(c.row.original.address) },
      { accessorKey: "timezone", header: "Timezone", cell: (c) => orDash(c.row.original.timezone) },
      { id: "floors", header: "Floors", accessorFn: (row) => row.object_geometry.length },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [],
  );

  const labColumns: Columns<Lab> = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (c) =>
          drillCell(c.row.original.name, () =>
            drillTo("stations", c.row.original.uuid, c.row.original.name),
          ),
      },
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

  const zoneColumns: Columns<Zone> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      { accessorKey: "tag", header: "Tag", cell: (c) => orDash(c.row.original.tag) },
      {
        id: "parent",
        header: "Parent",
        accessorFn: (row) => parentNames.get(row.parent_uuid) ?? "",
        cell: (c) => orDash(parentNames.get(c.row.original.parent_uuid)),
      },
      { accessorKey: "parent_type", header: "Parent kind", cell: (c) => orDash(c.row.original.parent_type) },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [parentNames],
  );

  const stationColumns: Columns<Station> = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (c) =>
          drillCell(c.row.original.name, () =>
            drillTo("modules", c.row.original.uuid, c.row.original.name),
          ),
      },
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

  const moduleColumns: Columns<Module> = useMemo(
    () => [
      { accessorKey: "name", header: "Name", cell: (c) => <span className="table__name">{c.row.original.name}</span> },
      {
        id: "station",
        header: "Station",
        accessorFn: (row) => stationNames.get(row.station_uuid) ?? "",
        cell: (c) => orDash(stationNames.get(c.row.original.station_uuid)),
      },
      { accessorKey: "description", header: "Description", cell: (c) => orDash(c.row.original.description) },
      { id: "updated", header: "Updated", accessorFn: (row) => row.updated_at, cell: (c) => formatDate(c.row.original.updated_at) },
    ],
    [stationNames],
  );

  /** The "showing children of X" chip above a filtered table. */
  const filterChip = (level: Level) => {
    const active = filterFor(level);
    if (!active) return null;
    return (
      <p className="hierarchy__filter">
        <span className="label">In</span> {active.parentName}
        <button type="button" className="hierarchy__filter-clear" onClick={() => setFilter(null)}>
          clear
        </button>
      </p>
    );
  };

  return (
    <>
      <ScreenHeader title="Hierarchy" subtitle="Site → Lab → Station → Module, and zones" />

      <div className="screen">
        <div className="screen__content">
          <CollapsibleSection
            title="Sites"
            count={sites.data?.length}
            open={openLevel === "sites"}
            onToggle={() => openWholeLevel("sites")}
          >
            <QueryBoundary query={sites}>
              {(rows) => <DataTable data={rows} columns={siteColumns} empty="No sites yet." />}
            </QueryBoundary>
          </CollapsibleSection>

          <CollapsibleSection
            title="Labs"
            count={labs.data?.length}
            open={openLevel === "labs"}
            onToggle={() => openWholeLevel("labs")}
          >
            {filterChip("labs")}
            <QueryBoundary query={labs}>
              {(rows) => {
                const active = filterFor("labs");
                const shown = active ? rows.filter((r) => r.site_uuid === active.parentUuid) : rows;
                return <DataTable data={shown} columns={labColumns} empty="No labs here." />;
              }}
            </QueryBoundary>
          </CollapsibleSection>

          <CollapsibleSection
            title="Zones"
            count={zones.data?.length}
            open={openLevel === "zones"}
            onToggle={() => openWholeLevel("zones")}
          >
            <QueryBoundary query={zones}>
              {(rows) => <DataTable data={rows} columns={zoneColumns} empty="No zones yet." />}
            </QueryBoundary>
          </CollapsibleSection>

          <CollapsibleSection
            title="Stations"
            count={stations.data?.length}
            open={openLevel === "stations"}
            onToggle={() => openWholeLevel("stations")}
          >
            {filterChip("stations")}
            <QueryBoundary query={stations}>
              {(rows) => {
                const active = filterFor("stations");
                const shown = active ? rows.filter((r) => r.lab_uuid === active.parentUuid) : rows;
                return <DataTable data={shown} columns={stationColumns} empty="No stations here." />;
              }}
            </QueryBoundary>
          </CollapsibleSection>

          <CollapsibleSection
            title="Modules"
            count={modules.data?.length}
            open={openLevel === "modules"}
            onToggle={() => openWholeLevel("modules")}
          >
            {filterChip("modules")}
            <QueryBoundary query={modules}>
              {(rows) => {
                const active = filterFor("modules");
                const shown = active
                  ? rows.filter((r) => r.station_uuid === active.parentUuid)
                  : rows;
                return <DataTable data={shown} columns={moduleColumns} empty="No modules here." />;
              }}
            </QueryBoundary>
          </CollapsibleSection>
        </div>
      </div>
    </>
  );
}
