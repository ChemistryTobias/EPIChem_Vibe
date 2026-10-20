/**
 * A module or a device. One file for both: a device is a module plus its
 * descriptor fields, of which only `ophyd_name` exists so far (the rest —
 * transport/network/safety — are Roadmap 1.3). Split this when they diverge.
 */

import type { Device, Module } from "../../api/types";
import { FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, ParentField, RecordSection, TextField } from "./sections";

export function ModuleInspector({ row, kind }: { row: Module | Device; kind: "Module" | "Device" }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title={kind}>
        <ParentField label="Station" uuid={row.station_uuid} />
        {/* Its name in the station pod: what workflow steps pass as the device. */}
        {kind === "Device" && <TextField label="Ophyd name" row={row} field="ophyd_name" />}
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
