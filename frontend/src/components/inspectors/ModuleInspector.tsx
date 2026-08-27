/**
 * A module or a device. One file for both: their schemas are identical today,
 * since the descriptor fields (ophyd/transport/network/safety) aren't built
 * yet. Split this when they diverge.
 */

import type { Module } from "../../api/types";
import { FieldGroup } from "../Inspector";
import { DescriptionSection, GeometrySection, ParentField, RecordSection } from "./sections";

export function ModuleInspector({ row, kind }: { row: Module; kind: "Module" | "Device" }) {
  return (
    <>
      <DescriptionSection row={row} />

      <FieldGroup title={kind}>
        <ParentField label="Station" uuid={row.station_uuid} />
      </FieldGroup>

      <GeometrySection geometry={row.object_geometry} />
      <RecordSection row={row} />
    </>
  );
}
