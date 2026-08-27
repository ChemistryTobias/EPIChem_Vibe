/** A zone: a grouping, so it names its parent rather than a place in the chain. */

import type { Zone } from "../../api/types";
import { Field, FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, ParentField, RecordSection, TextField } from "./sections";

export function ZoneInspector({ row }: { row: Zone }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title="Zone">
        <TextField label="Tag" row={row} field="tag" />
        <ParentField label="Parent" uuid={row.parent_uuid} />
        {/* Derived server-side from what parent_uuid points at. */}
        <Field label="Parent kind">{row.parent_type}</Field>
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
