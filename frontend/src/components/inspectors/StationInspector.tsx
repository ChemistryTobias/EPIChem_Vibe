/** A station: which lab it belongs to, and any zone grouping it. */

import type { Station } from "../../api/types";
import { FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, ParentField, RecordSection } from "./sections";

export function StationInspector({ row }: { row: Station }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title="Station">
        <ParentField label="Lab" uuid={row.lab_uuid} />
        <ParentField label="Zone" uuid={row.zone_uuid} />
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
