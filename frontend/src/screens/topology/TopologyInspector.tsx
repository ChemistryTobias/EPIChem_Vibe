/**
 * Right-hand detail panel for the selected topology node.
 *
 * Each kind shows the fields that kind actually has (`api/schemas.py`), so
 * the switch below is the one place that knows Zone has an atmosphere and
 * Bench has a grid.
 */

import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import type { Bench, Lab, Site, Station, Workcell, Zone } from "../../api/types";
import type { TreeNode } from "./topologyTree";

/** Workcell states come from `WorkcellSpec.state` in schemas/descriptor.py. */
function workcellTone(state: string) {
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
        </>
      );
    }
    case "Zone": {
      const zone = node.row as Zone;
      return (
        <>
          <Field label="Atmosphere">{zone.atmosphere}</Field>
          <Field label="Pressure">{zone.pressure}</Field>
          <Field label="Temperature class">{zone.temperature_class}</Field>
          <Field label="Hazard class">{zone.hazard_class}</Field>
        </>
      );
    }
    case "Workcell": {
      const workcell = node.row as Workcell;
      return (
        <>
          <Field label="State">
            <StatusDot tone={workcellTone(workcell.state)} label={workcell.state} />
          </Field>
          <Field label="Owning group">{workcell.owning_group}</Field>
          <Field label="Queueserver endpoint" mono>
            {workcell.queueserver_endpoint}
          </Field>
          <Field label="Redis namespace" mono>
            {workcell.redis_namespace}
          </Field>
        </>
      );
    }
    case "Bench": {
      const bench = node.row as Bench;
      return (
        <>
          <Field label="Grid" mono>
            {bench.grid_cols} × {bench.grid_rows}
          </Field>
          <Field label="Height" mono>
            {bench.height_mm === null ? null : `${bench.height_mm} mm`}
          </Field>
        </>
      );
    }
    case "Station": {
      const station = node.row as Station;
      return (
        <>
          <Field label="Kind">{station.kind}</Field>
          <Field label="Grid position" mono>
            col {station.grid_col}, row {station.grid_row}
          </Field>
          <Field label="Stack height" mono>
            {station.stack_height}
          </Field>
          <Field label="Capacity" mono>
            {station.capacity}
          </Field>
          <Field label="Accepted labware">
            {station.accepted_labware_types.length ? station.accepted_labware_types.join(", ") : null}
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
        kind="Topology inspector"
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
