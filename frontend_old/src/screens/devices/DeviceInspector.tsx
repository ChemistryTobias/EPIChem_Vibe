/**
 * Right-hand detail panel for the selected device — the descriptor's
 * transport, network, ophyd, pose, safety and calibration blocks
 * (§6.1), grouped the way the descriptor YAML groups them.
 */

import { Field, FieldGroup, Inspector } from "../../components/Inspector";
import { StatusDot } from "../../components/StatusDot";
import type { Device } from "../../api/types";
import { deviceTone } from "./deviceTone";

function poseText(device: Device): string | null {
  const { pose_x_mm, pose_y_mm, pose_z_mm, pose_yaw_deg } = device;
  if (pose_x_mm === null && pose_y_mm === null && pose_z_mm === null && pose_yaw_deg === null) {
    return null;
  }
  const mm = (v: number | null) => (v === null ? "?" : `${v}`);
  return `x ${mm(pose_x_mm)}, y ${mm(pose_y_mm)}, z ${mm(pose_z_mm)} mm · yaw ${mm(pose_yaw_deg)}°`;
}

export function DeviceInspector({
  device,
  onClose,
}: {
  device: Device | null;
  onClose: () => void;
}) {
  if (!device) {
    return (
      <Inspector
        kind="Device inspector"
        placeholder="Select a device to see its descriptor."
      />
    );
  }

  const envelopeKeys = Object.keys(device.envelope ?? {});

  return (
    <Inspector
      kind="Device inspector"
      title={device.name}
      subtitle={device.code}
      onClose={onClose}
    >
      <FieldGroup title="Identity">
        <Field label="UUID" mono>
          {device.id}
        </Field>
        <Field label="Capability class">{device.capability_class_ref}</Field>
        <Field label="Operational mode">
          <StatusDot tone={deviceTone(device.operational_mode)} label={device.operational_mode} />
        </Field>
        <Field label="Capabilities">
          {device.capabilities.length ? device.capabilities.join(", ") : null}
        </Field>
      </FieldGroup>

      <FieldGroup title="Location">
        <Field label="Station" mono>
          {device.station_code}
        </Field>
        <Field label="Pose" mono>
          {poseText(device)}
        </Field>
      </FieldGroup>

      <FieldGroup title="Transport">
        <Field label="Protocol" mono>
          {device.transport_protocol}
        </Field>
        <Field label="URI" mono>
          {device.transport_uri}
        </Field>
        <Field label="IOC host" mono>
          {device.transport_ioc_host}
        </Field>
        <Field label="Quality">
          {device.transport_quality === "degraded" ? (
            <StatusDot tone="warn" label="degraded" />
          ) : (
            device.transport_quality
          )}
        </Field>
      </FieldGroup>

      <FieldGroup title="Network">
        <Field label="NetBox device ID" mono>
          {device.network_netbox_device_id}
        </Field>
        <Field label="Primary IP" mono>
          {device.network_primary_ip}
        </Field>
        <Field label="MAC" mono>
          {device.network_mac}
        </Field>
        <Field label="VLAN" mono>
          {device.network_vlan}
        </Field>
      </FieldGroup>

      <FieldGroup title="Ophyd">
        <Field label="Import" mono>
          {device.ophyd_import}
        </Field>
        <Field label="Args" mono>
          {Object.keys(device.ophyd_args ?? {}).length
            ? JSON.stringify(device.ophyd_args)
            : null}
        </Field>
      </FieldGroup>

      <FieldGroup title="Envelope">
        {envelopeKeys.length === 0 ? (
          <Field label="Signals">{null}</Field>
        ) : (
          envelopeKeys.map((key) => (
            <Field key={key} label={key} mono>
              {JSON.stringify(device.envelope[key])}
            </Field>
          ))
        )}
      </FieldGroup>

      <FieldGroup title="Safety">
        <Field label="Flags">{device.safety_flags.length ? device.safety_flags.join(", ") : null}</Field>
        <Field label="Interlocks">
          {device.safety_interlocks.length ? device.safety_interlocks.join(", ") : null}
        </Field>
        <Field label="Max unattended">
          {device.safety_max_unattended_minutes === null
            ? null
            : `${device.safety_max_unattended_minutes} min`}
        </Field>
      </FieldGroup>

      <FieldGroup title="Calibration">
        <Field label="Record" mono>
          {device.operational_calibration ? JSON.stringify(device.operational_calibration) : null}
        </Field>
      </FieldGroup>
    </Inspector>
  );
}
