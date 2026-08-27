/** A lab: which site it's in, and where in the building. */

import type { Lab } from "../../api/types";
import { FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, ParentField, RecordSection, TextField } from "./sections";

export function LabInspector({ row }: { row: Lab }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title="Lab">
        <ParentField label="Site" uuid={row.site_uuid} />
        <TextField label="Room" row={row} field="room_number" />
        <ParentField label="Zone" uuid={row.zone_uuid} />
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
