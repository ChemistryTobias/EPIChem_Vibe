/** A site: where it is, and its floors. */

import type { Site } from "../../api/types";
import { Field, FieldGroup } from "../Inspector";
import { GeometrySection, IdentitySection, RecordSection } from "./sections";

export function SiteInspector({ row }: { row: Site }) {
  return (
    <>
      <IdentitySection row={row} />

      <FieldGroup title="Site">
        <Field label="Organisation">{row.organisation}</Field>
        <Field label="Address">{row.address}</Field>
        <Field label="Timezone">{row.timezone}</Field>
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
