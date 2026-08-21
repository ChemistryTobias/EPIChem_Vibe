/**
 * One device as a card in the grid: status stripe along the top, code and
 * name, then the two facts you actually scan for (transport and station),
 * then its capabilities as chips.
 *
 * The colored top border is the prototype's device-card idiom, kept.
 */

import { StatusDot } from "../../components/StatusDot";
import type { Device } from "../../api/types";
import { deviceTone } from "./deviceTone";

interface DeviceCardProps {
  device: Device;
  selected: boolean;
  onSelect: (device: Device) => void;
}

export function DeviceCard({ device, selected, onSelect }: DeviceCardProps) {
  const tone = deviceTone(device.operational_mode);

  return (
    <button
      className={selected ? "device-card device-card--selected" : "device-card"}
      onClick={() => onSelect(device)}
    >
      <span className={`device-card__stripe device-card__stripe--${tone}`} aria-hidden="true" />

      <span className="device-card__head">
        <span className="device-card__code mono">{device.code}</span>
        <StatusDot tone={tone} label={device.operational_mode} />
      </span>

      <span className="device-card__name">{device.name}</span>

      <span className="device-card__meta">
        <span>
          <span className="label">Class</span>
          <span className="device-card__value">{device.capability_class_ref ?? "—"}</span>
        </span>
        <span>
          <span className="label">Transport</span>
          <span className="device-card__value mono">{device.transport_protocol ?? "—"}</span>
        </span>
        <span>
          <span className="label">Station</span>
          <span className="device-card__value mono">{device.station_code ?? "—"}</span>
        </span>
      </span>

      {device.capabilities.length > 0 && (
        <span className="device-card__caps">
          {device.capabilities.map((cap) => (
            <span key={cap} className="chip mono">
              {cap}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
