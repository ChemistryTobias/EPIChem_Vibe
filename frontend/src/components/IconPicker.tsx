/** Choosing a station's pictogram: a grid of the set, the current one marked. */

import { Glyph, STATION_ICONS } from "./glyphs";

import "./IconPicker.css";

export function IconPicker({ value, onChange }: { value: string | null; onChange: (key: string) => void }) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="Icon">
      {STATION_ICONS.map((icon) => (
        <button
          key={icon.key}
          type="button"
          role="radio"
          aria-checked={value === icon.key}
          className={value === icon.key ? "icon-picker__item icon-picker__item--active" : "icon-picker__item"}
          title={icon.label}
          onClick={() => onChange(icon.key)}
        >
          <Glyph name={icon.key} size={22} />
          <span>{icon.label}</span>
        </button>
      ))}
    </div>
  );
}
