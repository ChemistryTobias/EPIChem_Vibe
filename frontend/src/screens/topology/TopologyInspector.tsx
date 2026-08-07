/**
 * Right-hand detail panel for the selected Hierarchy node.
 *
 * Each kind shows the fields that kind actually has (`api/schemas.py`), so the
 * switch below is the one place that knows Zone has an atmosphere and a Station
 * carries the execution binding (ADR 0007).
 */

import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import { deviceTone } from "../devices/deviceTone";
import type { TreeNode } from "./topologyTree";

/** Station states come from `StationSpec.state` in schemas/descriptor.py. */
function stationTone(state: string) {
  if (state === "active") return "ok" as const;
  if (state === "maintenance") return "warn" as const;
  return "muted" as const;
}

function KindFields({ node }: { node: TreeNode }) {
  switch (node.kind) {
    case "Site": {
      const site = node.row as Site;
      return (
        <>
          <Field label="Address">{site.address}</Field>
          <Field label="Timezone" mono>
            {site.timezone}
          </Field>
        </>
      );
    }
    case "Lab": {
      const lab = node.row as Lab;
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
      const zone = node.row as Zone;
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
      const station = node.row as Station;
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
      const device = node.row as Device;
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

interface TopologyInspectorProps {
  node: TreeNode | null;
  onClose: () => void;
}

export function TopologyInspector({ node, onClose }: TopologyInspectorProps) {
  if (!node) {
    return (
      <Inspector
        kind="Hierarchy inspector"
        placeholder="Select a node in the tree to see its registry record."
      />
    );
  }

  return (
    <Inspector kind={`${node.kind} inspector`} title={node.name} subtitle={node.code} onClose={onClose}>
      <FieldGroup title="Identity">
        <Field label="Code" mono>
          {node.code}
        </Field>
        <Field label="UUID" mono>
          {node.id}
        </Field>
      </FieldGroup>

      <FieldGroup title={node.kind}>
        <KindFields node={node} />
      </FieldGroup>

      {node.children.length > 0 && (
        <FieldGroup title="Contains">
          <Field label={`${node.children[0].kind}s`}>
            {node.children.map((c) => c.code).join(", ")}
          </Field>
        </FieldGroup>
      )}
    </Inspector>
  );
}
