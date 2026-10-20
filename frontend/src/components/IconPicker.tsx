/**
 * Choosing a station's pictogram. `StationIcon` is the icon itself as a
 * button: click it, pick from the grid, and it's saved at once (one PATCH,
 * one revision) — no edit mode to enter first. Every screen that shows the
 * station reads the same cached list, so the new icon shows up everywhere.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { stationsApi } from "../api/entities";
import type { Station } from "../api/types";
import { Glyph, STATION_ICONS, stationGlyph } from "./glyphs";

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

/** A station's icon that changes it when clicked. */
export function StationIcon({ station, size = 34, className }: { station: Station; size?: number; className?: string }) {
  const queryClient = useQueryClient();
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const current = stations.data?.find((s) => s.uuid === station.uuid) ?? station;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: (icon: string | null) => stationsApi.update(station.uuid, { icon }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Station[]>(["stations"], (list) => list?.map((s) => (s.uuid === updated.uuid ? updated : s)));
      queryClient.invalidateQueries({ queryKey: ["stations"] });
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="station-icon" ref={box}>
      <button
        type="button"
        className={`station-icon__button ${className ?? ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Change the icon"
        aria-label="Change the icon"
        aria-expanded={open}
      >
        <Glyph name={stationGlyph(current)} size={size} />
        <span className="station-icon__edit">
          <Glyph name="pencil" size={10} />
        </span>
      </button>
      {open && (
        <div className="station-icon__pop">
          <p className="label station-icon__title">Icon for {current.name}</p>
          <IconPicker value={current.icon ?? null} onChange={(key) => save.mutate(key)} />
          <div className="station-icon__foot">
            <button className="field__link" onClick={() => save.mutate(null)} disabled={!current.icon}>
              Guess from the name
            </button>
            {save.isPending && <span className="muted">saving…</span>}
            {save.isError && <span className="create__error">{(save.error as Error).message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
