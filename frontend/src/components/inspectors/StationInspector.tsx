/** A station: which lab it belongs to, any zone grouping it, and the pod that executes its workflows. */

import type { Station } from "../../api/types";
import { Glyph, stationGlyph } from "../glyphs";
import { IconPicker } from "../IconPicker";
import { Field, FieldGroup } from "../Inspector";
import { useEditSession, useFieldValue } from "./edit";
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

/** The station's pictogram — shown, or picked in the editor. */
function IconField({ row }: { row: Station }) {
  const session = useEditSession();
  const icon = useFieldValue<string | null>(row, "icon");
  return (
    <Field label="Icon">
      {session?.editing ? (
        <IconPicker value={icon ?? stationGlyph(row)} onChange={(key) => session.set("icon", key)} />
      ) : (
        <span className="station-icon-field">
          <Glyph name={stationGlyph({ ...row, icon })} size={22} />
          {icon ? "" : <span className="muted"> (guessed from the name)</span>}
        </span>
      )}
    </Field>
  );
}
