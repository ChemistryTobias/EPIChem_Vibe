/**
 * The registry-record detail body shared by the Hierarchy inspector and the Lab-
 * layout inspector (ADR 0009): identity, the kind-specific fields, an optional
 * "contains" summary, and the revision history. Extracted so a lab/station/device
 * reads *identically* wherever it's selected — the layout screen no longer shows a
 * thinner panel with an "Enter" button; it shows this same record.
 *
 * `KindFields` is the one place that knows which columns each kind actually has
 * (`api/schemas.py`) — Zone has an atmosphere, a Station carries the execution
 * binding (ADR 0007), a Device its transport.
 */

import { Field, FieldGroup } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import type { HierarchyKind } from "../../api/topology";
import { deviceTone } from "../devices/deviceTone";
import { RevisionHistory } from "./RevisionHistory";

/** Station states come from `StationSpec.state` in schemas/descriptor.py. */
function stationTone(state: string) {
  if (state === "active") return "ok" as const;
  if (state === "maintenance") return "warn" as const;
  return "muted" as const;
}

/** The fields specific to one registry kind. `row` is that kind's API record. */
export function KindFields({ kind, row }: { kind: HierarchyKind; row: Site | Lab | Zone | Station | Device }) {
  switch (kind) {
    case "Site": {
      const site = row as Site;
      return (
        <>
          <Field label="Address">{site.address}</Field>
          <Field label="Timezone" mono>
            {site.timezone}
          </Field>
          <Field label="Canvas" mono>
            {site.width_m} × {site.depth_m} m
          </Field>
        </>
      );
    }
    case "Lab": {
      const lab = row as Lab;
      return (
        <>
          <Field label="Room">{lab.room_number}</Field>
          <Field label="Environment class">{lab.environment_class}</Field>
          <Field label="Access control group">{lab.access_control_group}</Field>
          <Field label="Floor" mono>
            {lab.width_m} × {lab.depth_m} m
          </Field>
          <Field label="Grid size" mono>
            {lab.grid_size_m} m
          </Field>
        </>
      );
    }
    case "Zone": {
      const zone = row as Zone;
      return (
        <>
          <Field label="Occupancy">{zone.occupancy}</Field>
          <Field label="Atmosphere">{zone.atmosphere}</Field>
          <Field label="Pressure">{zone.pressure}</Field>
          <Field label="Temperature class">{zone.temperature_class}</Field>
          <Field label="Hazard class">{zone.hazard_class}</Field>
        </>
      );
    }
    case "Station": {
      const station = row as Station;
      return (
        <>
          <Field label="Kind">{station.kind}</Field>
          <Field label="State">
            <StatusDot tone={stationTone(station.state)} label={station.state} />
          </Field>
          <Field label="Position" mono>
            {station.pos_x} m, {station.pos_y} m
          </Field>
          <Field label="Footprint" mono>
            {station.size_x_m} × {station.size_y_m} × {station.height_m} m
          </Field>
          <Field label="Capacity" mono>
            {station.capacity}
          </Field>
          <Field label="Accepted labware">
            {station.accepted_labware_types.length
              ? station.accepted_labware_types.join(", ")
              : null}
          </Field>
          <Field label="Owning group">{station.owning_group}</Field>
          <Field label="Queueserver endpoint" mono>
            {station.queueserver_endpoint}
          </Field>
          <Field label="Redis namespace" mono>
            {station.redis_namespace}
          </Field>
        </>
      );
    }
    case "Device": {
      const device = row as Device;
      return (
        <>
          <Field label="Node kind">{device.node_kind}</Field>
          <Field label="Mode">
            <StatusDot tone={deviceTone(device.operational_mode)} label={device.operational_mode} />
          </Field>
          <Field label="Station" mono>
            {device.station_code}
          </Field>
          <Field label="Capabilities">
            {device.capabilities.length ? device.capabilities.join(", ") : null}
          </Field>
          <Field label="Transport" mono>
            {device.transport_protocol}
          </Field>
        </>
      );
    }
  }
}

/**
 * The full record for one node: identity, its kind fields, an optional "contains"
 * line, and the revision history. Both the Hierarchy tree and the layout canvas
 * feed this the same way — a kind, its row, and (optionally) the children it holds.
 */
export function NodeDetails({
  kind,
  row,
  childrenCodes,
}: {
  kind: HierarchyKind;
  row: Site | Lab | Zone | Station | Device;
  /** Codes of the node's direct children, for the "contains" summary (optional). */
  childrenCodes?: string[];
}) {
  return (
    <>
      <FieldGroup title="Identity">
        <Field label="Code" mono>
          {row.code}
        </Field>
        <Field label="UUID" mono>
          {row.id}
        </Field>
      </FieldGroup>

      <FieldGroup title={kind}>
        <KindFields kind={kind} row={row} />
      </FieldGroup>

      {childrenCodes && childrenCodes.length > 0 && (
        <FieldGroup title="Contains">
          <Field label="Children">{childrenCodes.join(", ")}</Field>
        </FieldGroup>
      )}

      <RevisionHistory kind={kind} code={row.code} />
    </>
  );
}
