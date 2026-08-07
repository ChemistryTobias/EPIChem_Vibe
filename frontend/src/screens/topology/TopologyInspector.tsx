/**
 * Right-hand detail panel for the selected Hierarchy node.
 *
 * Each kind shows the fields that kind actually has (`api/schemas.py`), so the
 * switch below is the one place that knows Zone has an atmosphere and a Station
 * carries the execution binding (ADR 0007).
 */

import { useState } from "react";

import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import { Button } from "../../components/Button";
import { deleteNode } from "../../api/topology";
import type { Device, Lab, Site, Station, Zone } from "../../api/types";
import { deviceTone } from "../devices/deviceTone";
import { RevisionHistory } from "./RevisionHistory";
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
  /** Switch the panel to edit mode (not offered for Device — see EditInspector). */
  onEdit: (node: TreeNode) => void;
  /** The node was deleted: clear the selection and reload. */
  onDeleted: () => void;
}

export function TopologyInspector({ node, onClose, onEdit, onDeleted }: TopologyInspectorProps) {
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
      <NodeActions node={node} onEdit={onEdit} onDeleted={onDeleted} />

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

      <RevisionHistory kind={node.kind} code={node.code} />
    </Inspector>
  );
}

/**
 * Edit / delete row for the selected node. Delete is a two-step inline confirm
 * (no browser dialog), and owns its own busy/error state — a 409 comes back when
 * the node still has children, which is a message worth showing, not swallowing.
 * Device is deletable but not editable here (its edit belongs with Device Status).
 */
function NodeActions({
  node,
  onEdit,
  onDeleted,
}: {
  node: TreeNode;
  onEdit: (node: TreeNode) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteNode(node.kind, node.code);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="node-actions">
      {confirming ? (
        <>
          <span className="node-actions__prompt">Delete {node.code}?</span>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? "Deleting…" : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {node.kind !== "Device" && (
            <Button variant="primary" onClick={() => onEdit(node)}>
              Edit
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </>
      )}
      {error && (
        <p className="create-form__error node-actions__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
