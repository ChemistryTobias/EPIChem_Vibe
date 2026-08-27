/** A lab: which site it's in, and where in the building. */

import type { Lab } from "../../api/types";
import { Field, FieldGroup } from "../Inspector";
import { GeometrySection, IdentitySection, ParentField, RecordSection } from "./sections";

export function LabInspector({ row }: { row: Lab }) {
  return (
    <>
      <IdentitySection row={row} />

      <FieldGroup title="Lab">
        <ParentField label="Site" uuid={row.site_uuid} />
        <Field label="Room">{row.room_number}</Field>
        <ParentField label="Zone" uuid={row.zone_uuid} />
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
