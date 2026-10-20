/** A station: which lab it belongs to, any zone grouping it, and the pod that executes its workflows. */

import type { Station } from "../../api/types";
import { StationIcon } from "../IconPicker";
import { Field, FieldGroup } from "../Inspector";
import { ExecutionSection } from "./ExecutionSection";
import { DescriptionSection, GeometrySection, ParentField, RecordSection, TextField } from "./sections";

export function StationInspector({ row }: { row: Station }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title="Station">
        <ParentField label="Lab" uuid={row.lab_uuid} />
        <ParentField label="Zone" uuid={row.zone_uuid} />
        <TextField label="Queueserver URL" row={row} field="queueserver_url" />
        <IconField row={row} />
      </FieldGroup>

      <ExecutionSection station={row} />

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}

/** The station's pictogram — click it to change it; saved at once. */
function IconField({ row }: { row: Station }) {
  return (
    <Field label="Icon">
      <span className="station-icon-field">
        <StationIcon station={row} size={26} />
        <span className="muted">click it to change</span>
      </span>
    </Field>
  );
}
