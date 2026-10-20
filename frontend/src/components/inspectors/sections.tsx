/**
 * The parts every entity inspector shares.
 *
 * Each entity has a uuid, a name, a description and created/updated stamps,
 * so those get one implementation here and the per-entity files only describe
 * what makes that entity different. Name and uuid aren't fields — they're the
 * inspector's title and subtitle — and the timestamps sit last, since they're
 * the least interesting thing about a record.
 */

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";

import { labsApi, sitesApi, stationsApi, zonesApi } from "../../api/entities";
import type { EntityKind, GeometryDescriptor, ObjectBase } from "../../api/types";
import { formatDateTime } from "../../screens/format";
import { Field, FieldGroup } from "../Inspector";
import { useEditSession, useFieldValue } from "./edit";
import { useInspectorNav, type InspectorTarget } from "./nav";

/** uuid -> the record, across every entity that can be a parent. Reads the
 * queries the tables and tree already loaded, so it costs no extra requests. */
export function useEntityIndex(): Map<string, InspectorTarget> {
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const index = new Map<string, InspectorTarget>();
  const add = (kind: EntityKind, rows: ObjectBase[] | undefined) => {
    for (const row of rows ?? []) index.set(row.uuid, { kind, row: row as InspectorTarget["row"] });
  };
  add("Site", sites.data);
  add("Lab", labs.data);
  add("Zone", zones.data);
  add("Station", stations.data);
  return index;
}

/**
 * A reference to another record. Just its name, in the body colour — the uuid
 * is noise here, and the record it names is one click away anyway: the name
 * moves the inspector onto it.
 */
export function ParentField({ label, uuid }: { label: string; uuid: string | null }) {
  const index = useEntityIndex();
  const navigate = useInspectorNav();
  if (uuid === null) return <Field label={label}>{null}</Field>;

  const target = index.get(uuid);
  if (!target) return <Field label={label}>{null}</Field>;

  return (
    <Field label={label}>
      {navigate ? (
        <button className="field__link" onClick={() => navigate(target)}>
          {target.row.name}
        </button>
      ) : (
        target.row.name
      )}
    </Field>
  );
}

/**
 * One of the record's own fields: read as text, edited as a compact input in
 * the same idiom as the hierarchy's search box.
 */
export function TextField({ label, row, field }: { label: string; row: object; field: string }) {
  const session = useEditSession();
  const value = useFieldValue<string | null>(row, field);

  if (!session?.editing) return <Field label={label}>{value}</Field>;

  return (
    <Field label={label}>
      <input
        className="field__input"
        value={value ?? ""}
        onChange={(e) => session.set(field, e.target.value === "" ? null : e.target.value)}
      />
    </Field>
  );
}

/** What the record is, aside from its name and its uuid (both in the header). */
export function DescriptionSection({ row }: { row: ObjectBase }) {
  return <TextField label="Description" row={row} field="description" />;
}

/** Whole numbers stay whole; anything else gets two digits — 0.004 reads as
 * `0`, 0.008 as `0.01`. */
function round(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

const triple = (xyz: [number, number, number]) => xyz.map(round).join(" × ");

/**
 * Placement, when there is any. A site carries a list (one entry per floor);
 * everything else carries at most one, so the entry's `detail` only earns a
 * mention when there's more than one to tell apart.
 *
 * In the editor each axis is a float you can type — which is the only way to
 * place something exactly, since a drag is always to the nearest pixel. A list
 * edits its *first* entry: there is no floor picker yet, and one floor is the
 * only case that exists today.
 */
export function GeometrySection({
  geometry,
}: {
  geometry: GeometryDescriptor | GeometryDescriptor[] | null;
}) {
  const session = useEditSession();
  const edited = useFieldValue<GeometryDescriptor | GeometryDescriptor[] | undefined>(
    {},
    "object_geometry",
  );
  const value = edited ?? geometry;
  const list = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (list.length === 0) return null;

  if (session?.editing) {
    const first = list[0];
    const write = (key: "box_position_xyz" | "box_dimension_xyz", axis: number, next: number) => {
      const updated = { ...first, [key]: [...first[key]] as [number, number, number] };
      updated[key][axis] = next;
      session.set("object_geometry", Array.isArray(value) ? [updated, ...list.slice(1)] : updated);
    };
    return (
      <FieldGroup title="Geometry">
        <Triple
          label="Position"
          values={first.box_position_xyz}
          onChange={(a, v) => write("box_position_xyz", a, v)}
        />
        <Triple
          label="Dimensions"
          values={first.box_dimension_xyz}
          onChange={(a, v) => write("box_dimension_xyz", a, v)}
        />
      </FieldGroup>
    );
  }

  return (
    <FieldGroup title="Geometry">
      {list.map((g, i) => {
        const suffix = list.length > 1 ? ` — ${g.detail || i + 1}` : "";
        return (
          <Fragment key={i}>
            <Field label={`Position${suffix}`}>
              <span className="mono">{triple(g.box_position_xyz)}</span>
            </Field>
            <Field label={`Dimensions${suffix}`}>
              <span className="mono">{triple(g.box_dimension_xyz)}</span>
            </Field>
          </Fragment>
        );
      })}
    </FieldGroup>
  );
}

/** Three floats on one line — x, y, z of a position or an extent. */
function Triple({
  label,
  values,
  onChange,
}: {
  label: string;
  values: [number, number, number];
  onChange: (axis: number, value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="field__triple">
        {values.map((v, axis) => (
          <input
            key={axis}
            className="field__input mono"
            type="number"
            step="0.01"
            value={v}
            onChange={(e) => onChange(axis, Number(e.target.value))}
          />
        ))}
      </div>
    </Field>
  );
}

/** Timestamps, last — the least interesting thing about a record. */
export function RecordSection({ row }: { row: ObjectBase }) {
  return (
    <FieldGroup title="Record">
      <Field label="Created">{formatDateTime(row.created_at)}</Field>
      <Field label="Updated">{formatDateTime(row.updated_at)}</Field>
    </FieldGroup>
  );
}
