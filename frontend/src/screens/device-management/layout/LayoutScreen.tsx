/**
 * Lab layout (plan §10): one editor over three levels — Site → Lab → Station —
 * drilling down by double-clicking a box and back up through the breadcrumb.
 * Each level is the *same* canvas; only the data and the target endpoint
 * differ (`levels.ts`).
 *
 * Editing is staged, as it was in the old editor: in edit mode, moves and
 * resizes accumulate in a local draft and nothing is written until Save.
 * Cancel discards them after a confirm, and the level can't be changed while
 * a draft is open. The reason is the audit trail — every write records a
 * Revision, so a PATCH per drag would bury the history under hundreds of rows.
 *
 * The canvas never holds authoritative state (plan §10.3): it renders the
 * draft, and a save writes the draft and refetches. Nothing round-trips
 * through three.js.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  devicesApi,
  labsApi,
  modulesApi,
  sitesApi,
  stationsApi,
  zonesApi,
} from "../../../api/entities";
import type { EntityKind } from "../../../api/types";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Inspector } from "../../../components/Inspector";
import { EntityInspector } from "../../../components/inspectors";
import { ScreenHeader } from "../../../components/ScreenHeader";
import type { Rect } from "./constraints";
import { API_FOR, buildLevel, drillInto, type LayoutBox, type LevelContext } from "./levels";
import { CreateDialog } from "../hierarchy/CreateDialog";
import { LayoutCanvas, type Preset, type ViewApi } from "./Scene";

import "./layout.css";

export function LayoutScreen() {
  const queryClient = useQueryClient();
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const zones = useQuery({ queryKey: ["zones"], queryFn: zonesApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const modules = useQuery({ queryKey: ["modules"], queryFn: modulesApi.list });
  const devices = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });

  const [ctx, setCtx] = useState<LevelContext>({ site: null, lab: null, station: null, floor: 0 });
  const [preset, setPreset] = useState<Preset>("iso");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Rect>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const view = useRef<ViewApi | null>(null);

  const data = {
    sites: sites.data ?? [],
    labs: labs.data ?? [],
    zones: zones.data ?? [],
    stations: stations.data ?? [],
    modules: modules.data ?? [],
    devices: devices.data ?? [],
  };

  // Nothing chosen yet means the first site — the editor always opens on
  // something rather than on a picker.
  const context: LevelContext = ctx.site ? ctx : { ...ctx, site: data.sites[0] ?? null };
  const model = useMemo(() => buildLevel(context, data), [context, sites.data, labs.data, zones.data, stations.data, modules.data, devices.data]);

  const dirty = Object.keys(draft).length > 0;
  const boxes = (model?.boxes ?? []).map((b) => (draft[b.uuid] ? { ...b, rect: draft[b.uuid] } : b));
  const selectedBox = boxes.find((b) => b.uuid === selected) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      for (const box of boxes) {
        const rect = draft[box.uuid];
        if (!rect) continue;
        const g = box.geometry;
        await API_FOR[box.kind].update(box.uuid, {
          object_geometry: {
            ...g,
            box_position_xyz: [rect.pos.x, rect.pos.y, g.box_position_xyz[2]],
            box_dimension_xyz: [rect.size.x, rect.size.y, g.box_dimension_xyz[2]],
          },
        });
      }
    },
    onSuccess: async () => {
      setDraft({});
      setEditing(false);
      await queryClient.invalidateQueries();
    },
  });

  const remove = useMutation({
    mutationFn: (box: LayoutBox) => API_FOR[box.kind].remove(box.uuid),
    onSuccess: async () => {
      setSelected(null);
      await queryClient.invalidateQueries();
    },
  });

  function leaveEditing() {
    if (dirty && !confirm("Discard the unsaved layout changes?")) return;
    setDraft({});
    setEditing(false);
  }

  /** Level changes are blocked while a draft is open — save or cancel first. */
  function go(patch: Partial<LevelContext>) {
    if (dirty) return;
    setSelected(null);
    // The box the cursor was over is gone with the level — its tooltip would
    // otherwise hang around naming something no longer on screen.
    setHover(null);
    setCtx({ ...context, ...patch });
  }

  /** What an Add on this level hangs the new row off. */
  const parentUuid = context.station?.uuid ?? context.lab?.uuid ?? context.site?.uuid;

  const crumbs = [
    { label: context.site?.name ?? "Site", to: { lab: null, station: null } },
    ...(context.lab ? [{ label: context.lab.name, to: { station: null } }] : []),
    ...(context.station ? [{ label: context.station.name, to: {} }] : []),
  ];

  return (
    <>
      <ScreenHeader
        title="Lab layout"
        subtitle={model ? `${boxes.length} ${model.childLabel}${boxes.length === 1 ? "" : "s"}` : "No floor"}
        actions={
          editing ? (
            <>
              <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button onClick={leaveEditing}>Cancel</Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setEditing(true)} disabled={model === null}>
              Edit layout
            </Button>
          )
        }
      />

      <div className="screen">
        <div className="screen__content layout">
          {save.isError && <Alert kind="error">{(save.error as Error).message}</Alert>}

          {model === null ? (
            <Alert kind="info">
              Nothing to draw yet — this level has no geometry. Create a site with a floor first.
            </Alert>
          ) : (
            <div className="layout__canvas">
              <LayoutCanvas
                model={model}
                boxes={boxes}
                preset={preset}
                editing={editing}
                selected={selected}
                api={view}
                onSelect={setSelected}
                onDrill={(uuid) => {
                  const box = boxes.find((b) => b.uuid === uuid);
                  const patch = box ? drillInto(model, box) : null;
                  if (patch) go(patch);
                }}
                onGeometry={(uuid, rect) => setDraft((d) => ({ ...d, [uuid]: rect }))}
                onHover={(box: LayoutBox | null, x: number, y: number) =>
                  setHover(box ? { name: box.name, x, y } : null)
                }
              />

              {/* Everything but the canvas floats over it: where you are on the
                  left, what you can do on the right, the view controls at the
                  bottom. The bar itself is click-through. */}
              <div className="canvas-overlay">
                <div className="canvas-overlay__bar">
                  {crumbs.map((crumb, i) =>
                    i === crumbs.length - 1 ? (
                      <span key={i} className="canvas-overlay__here label">
                        {crumb.label}
                      </span>
                    ) : (
                      <Button
                        key={i}
                        size="sm"
                        onClick={() => go(crumb.to)}
                        disabled={dirty}
                        title={dirty ? "Save or cancel first" : undefined}
                      >
                        {crumb.label}
                      </Button>
                    ),
                  )}

                  <span className="canvas-overlay__spacer" />

                  {editing && (
                    <>
                      <Button size="sm" onClick={() => setAdding(true)}>
                        Add {model.childLabel}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={selectedBox === null || remove.isPending}
                        onClick={() => selectedBox && remove.mutate(selectedBox)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>

                <div className="zoombar">
                  <button className="zoombar__btn" title="Zoom in" onClick={() => view.current?.zoomIn()}>
                    +
                  </button>
                  <span className="zoombar__sep" aria-hidden="true">|</span>
                  <button className="zoombar__btn" title="Zoom out" onClick={() => view.current?.zoomOut()}>
                    −
                  </button>
                  <span className="zoombar__sep" aria-hidden="true">|</span>
                  <button className="zoombar__btn" title="Fit to view" onClick={() => view.current?.reset()}>
                    [ ]
                  </button>
                  <span className="zoombar__sep" aria-hidden="true">|</span>
                  <button
                    className="zoombar__btn"
                    title={preset === "iso" ? "Switch to top down" : "Switch to isometric"}
                    onClick={() => setPreset(preset === "iso" ? "top" : "iso")}
                  >
                    {preset === "iso" ? "2D" : "ISO"}
                  </button>
                </div>
              </div>

              {hover && (
                <span className="layout__tip label" style={{ left: hover.x + 12, top: hover.y + 12 }}>
                  {hover.name}
                </span>
              )}
            </div>
          )}
        </div>

        <Inspector
          open={selectedBox !== null}
          kind={selectedBox ? `${selectedBox.kind} inspector` : "Inspector"}
          title={selectedBox?.name}
          subtitle={selectedBox?.uuid}
          onClose={() => setSelected(null)}
        >
          {selectedBox && (
            <EntityInspector kind={selectedBox.kind as EntityKind} row={selectedBox.row} />
          )}
        </Inspector>
      </div>

      {adding && model && (
        <CreateDialog
          kind={model.childKind}
          parentUuid={parentUuid}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
