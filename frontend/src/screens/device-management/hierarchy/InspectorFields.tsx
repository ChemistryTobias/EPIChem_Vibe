/**
 * The selected row, rendered as a list of facts. View only.
 *
 * Driven off the row's own keys rather than a spec per entity: the entities
 * are close in shape, and a generic renderer can't fall out of sync with the
 * backend the way five hand-written field lists would. Anything ending in
 * `_uuid` is resolved to the parent's name, using the same queries the tables
 * already loaded — so this costs no extra requests.
 */

import { useQuery } from "@tanstack/react-query";

import { labsApi, sitesApi, stationsApi, zonesApi } from "../../../api/entities";
import type { GeometryDescriptor } from "../../../api/types";
import { Field } from "../../../components/Inspector";
import { nameMap } from "../../format";
import type { EntityRow } from "./hierarchyTree";

/** Keys worth a nicer label than a de-underscored key name. */
const LABELS: Record<string, string> = {
  uuid: "UUID",
  created_at: "Created",
  updated_at: "Updated",
  site_uuid: "Site",
  lab_uuid: "Lab",
  station_uuid: "Station",
  zone_uuid: "Zone",
  parent_uuid: "Parent",
  parent_type: "Parent kind",
  room_number: "Room",
  object_geometry: "Geometry",
};

/** Shown first, in this order; everything else follows in key order. */
const LEAD = ["name", "description"];

const humanise = (key: string) =>
  LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function geometryText(g: GeometryDescriptor): string {
  const [w, d, h] = g.box_dimension_xyz;
  const [x, y, z] = g.box_position_xyz;
  return `${g.shape} · ${w}×${d}×${h} m @ (${x}, ${y}, ${z})${g.detail ? ` — ${g.detail}` : ""}`;
}

export function InspectorFields({ row }: { row: EntityRow }) {
  // All cached by the tables/tree already; these are reads, not new fetches.
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const names = new Map([
    ...nameMap(sites.data),
    ...nameMap(labs.data),
    ...nameMap(zones.data),
    ...nameMap(stations.data),
  ]);

  const fields = row as unknown as Record<string, unknown>;
  const ordered = [
    ...LEAD.filter((k) => k in fields).map((k) => [k, fields[k]] as const),
    ...Object.entries(fields).filter(([k]) => !LEAD.includes(k)),
  ];

  return (
    <>
      {ordered.map(([key, value]) => (
        <Field key={key} label={humanise(key)}>
          {renderValue(key, value, names)}
        </Field>
      ))}
    </>
  );
}

function renderValue(key: string, value: unknown, names: Map<string, string>) {
  if (value === null || value === undefined || value === "") return null;

  if (key === "created_at" || key === "updated_at") {
    return new Date(String(value)).toLocaleString();
  }

  if (key === "uuid") return <span className="mono">{String(value)}</span>;

  // A parent reference reads as its name, with the id kept underneath for
  // anyone who needs to match it against the API.
  if (key.endsWith("_uuid")) {
    const id = String(value);
    const name = names.get(id);
    return (
      <>
        {name ?? <span className="muted">unknown</span>}
        <br />
        <span className="mono muted">{id}</span>
      </>
    );
  }

  if (key === "object_geometry") {
    const list = Array.isArray(value) ? value : [value];
    return (
      <ul className="inspector__list">
        {(list as GeometryDescriptor[]).map((g, i) => (
          <li key={i}>{geometryText(g)}</li>
        ))}
      </ul>
    );
  }

  if (key === "coordinates") {
    const c = value as { latitude: number; longitude: number };
    return <span className="mono">{`${c.latitude}, ${c.longitude}`}</span>;
  }

  if (typeof value === "object") return <span className="mono">{JSON.stringify(value)}</span>;
  return String(value);
}
