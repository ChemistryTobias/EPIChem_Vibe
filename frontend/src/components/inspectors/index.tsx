/**
 * Picks the inspector for a kind. Adding an entity means adding a file next
 * to this one and a case here — nothing else changes.
 */

import type { Device, EntityKind, EntityRow, Lab, Module, Site, Station, Zone } from "../../api/types";
import { LabInspector } from "./LabInspector";
import { ModuleInspector } from "./ModuleInspector";
import { SiteInspector } from "./SiteInspector";
import { StationInspector } from "./StationInspector";
import { ZoneInspector } from "./ZoneInspector";

export function EntityInspector({ kind, row }: { kind: EntityKind; row: EntityRow }) {
  switch (kind) {
    case "Site":
      return <SiteInspector row={row as Site} />;
    case "Lab":
      return <LabInspector row={row as Lab} />;
    case "Zone":
      return <ZoneInspector row={row as Zone} />;
    case "Station":
      return <StationInspector row={row as Station} />;
    case "Module":
    case "Device":
      return <ModuleInspector row={row as Module | Device} kind={kind} />;
  }
}
