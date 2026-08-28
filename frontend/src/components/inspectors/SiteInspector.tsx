/** A site: where it is, and its floors. */

import type { Site } from "../../api/types";
import { Field, FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, RecordSection, TextField } from "./sections";

export function SiteInspector({ row }: { row: Site }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title="Site">
        <TextField label="Organisation" row={row} field="organisation" />
        <TextField label="Address" row={row} field="address" />
        <TextField label="Timezone" row={row} field="timezone" />
        <Field label="Coordinates">
          {row.coordinates && (
            <span className="mono">{`${row.coordinates.latitude}, ${row.coordinates.longitude}`}</span>
          )}
        </Field>
      </FieldGroup>

      {/* A site's geometry is one entry per floor. */}
      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
