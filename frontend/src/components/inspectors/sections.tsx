/**
 * The parts every entity inspector shares.
 *
 * Each entity has a uuid, a name, a description and created/updated stamps,
 * so those get one implementation here and the per-entity files only describe
 * what makes that entity different. The name isn't a field — it's the
 * inspector's title — and the timestamps sit last, since they're the least
 * interesting thing about a record.
 */

import { useQuery } from "@tanstack/react-query";

import { labsApi, sitesApi, stationsApi, zonesApi } from "../../api/entities";
import type { GeometryDescriptor, ObjectBase } from "../../api/types";
import { Field, FieldGroup } from "../Inspector";

/** uuid -> name across every entity that can be a parent. Reads the queries
 * the tables and tree already loaded, so it costs no extra requests. */
export function useEntityNames(): Map<string, string> {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  return new Map(
    [...(sites.data ?? []), ...(labs.data ?? []), ...(zones.data ?? []), ...(stations.data ?? [])].map(
      (row) => [row.uuid, row.name],
    ),
  );
}

/** A reference to another entity: its name, with the id kept underneath for
 * anyone who needs to match it against the API. */
export function ParentField({ label, uuid }: { label: string; uuid: string | null }) {
  const names = useEntityNames();
  if (uuid === null) return <Field label={label}>{null}</Field>;

  return (
    <Field label={label}>
      {names.get(uuid) ?? <span className="muted">unknown</span>}
      <br />
      <span className="mono muted">{uuid}</span>
    </Field>
  );
}

/** What the record is, aside from its name. */
export function IdentitySection({ row }: { row: ObjectBase }) {
  return (
    <FieldGroup title="Identity">
      <Field label="Description">{row.description}</Field>
      <Field label="UUID">
        <span className="mono">{row.uuid}</span>
      </Field>
    </FieldGroup>
  );
}

function geometryLine(g: GeometryDescriptor) {
  const [w, d, h] = g.box_dimension_xyz;
  const [x, y, z] = g.box_position_xyz;
  return `${g.shape} · ${w}×${d}×${h} m @ (${x}, ${y}, ${z})`;
}

/**
 * Placement, when there is any. A site carries a list (one entry per floor);
 * everything else carries at most one.
 */
export function GeometrySection({
  geometry,
}: {
  geometry: GeometryDescriptor | GeometryDescriptor[] | null;
}) {
  const list = geometry === null ? [] : Array.isArray(geometry) ? geometry : [geometry];
  if (list.length === 0) return null;

  return (
    <FieldGroup title="Geometry">
      {list.map((g, i) => (
        <Field key={i} label={g.detail || `Volume ${i + 1}`}>
          <span className="mono">{geometryLine(g)}</span>
        </Field>
      ))}
    </FieldGroup>
  );
}

/** Timestamps, last — the least interesting thing about a record. */
export function RecordSection({ row }: { row: ObjectBase }) {
  return (
    <FieldGroup title="Record">
      <Field label="Created">{new Date(row.created_at).toLocaleString()}</Field>
      <Field label="Updated">{new Date(row.updated_at).toLocaleString()}</Field>
    </FieldGroup>
  );
}
