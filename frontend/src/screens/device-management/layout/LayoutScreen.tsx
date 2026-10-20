/**
 * Lab layout (plan §10): one editor over three levels — Site → Lab → Station —
 * drilling down by a box's name on the canvas and back up through the location
 * path. Each level is the *same* canvas; only the data and the target endpoint
 * differ (`levels.ts`).
 *
 * Editing is staged, as it was in the old editor: in edit mode, moves, resizes
 * and typed field changes accumulate in one draft and nothing is written until
 * Save. Cancel discards after a confirm, and the level can't be changed while
 * a draft is open. The reason is the audit trail — every write records a
 * Revision, so a PATCH per drag would bury the history under hundreds of rows.
 *
 * That draft is keyed by uuid and holds whole PATCH bodies, which is what lets
 * a drag and a typed coordinate be the same edit: the canvas writes geometry
 * into it, the inspector's editor writes any field into it, one Save sends it.
 *
 * The canvas never holds authoritative state (plan §10.3): it renders the
 * draft, and a save writes the draft and refetches.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  API_BY_KIND,
  devicesApi,
  labsApi,
  modulesApi,
  sitesApi,
  stationsApi,
  zonesApi,
} from "../../../api/entities";
import type { EntityKind, GeometryDescriptor } from "../../../api/types";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Inspector } from "../../../components/Inspector";
import { Menu } from "../../../components/Menu";
import { EntityInspector } from "../../../components/inspectors";
import { CreatePanel, useCreator } from "../../../components/inspectors/create";
import { EditContext } from "../../../components/inspectors/edit";
import { InspectorNavContext, type InspectorTarget } from "../../../components/inspectors/nav";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { slideTo, type Rect } from "./constraints";
import { buildLevel, drillInto, type LevelContext } from "./levels";
import { LocationPath } from "./LocationPath";
import { LayoutCanvas, type Preset, type ViewApi } from "./Scene";

import "./layout.css";

/** Which field on a new child names the thing it's being added to. */
const PARENT_FIELD: Record<string, string> = {
  Lab: "site_uuid",
  Zone: "parent_uuid",
  Station: "lab_uuid",
  Module: "station_uuid",
  Device: "station_uuid",
};

/** One record's pending changes: the body a Save will PATCH. */
interface DraftEntry {
  kind: EntityKind;
  body: Record<string, unknown>;
}

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
  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});
  const [selected, setSelected] = useState<string | null>(null);
  /** What the panel is showing. Usually the selected box, but a reference
   * field can send it somewhere that isn't on this level at all. */
  const [inspect, setInspect] = useState<InspectorTarget | null>(null);
  // A new box opens selected, so it can be dragged straight into place.
  const creator = useCreator({
    onCreated: (kind, row) => {
      setSelected(row.uuid);
      setInspect({ kind, row });
    },
  });
  const [note, setNote] = useState<string | null>(null);
  const view = useRef<ViewApi | null>(null);
  const labelNodes = useRef(new Map<string, HTMLElement>());

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
  const model = useMemo(
    () => buildLevel(context, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, sites.data, labs.data, zones.data, stations.data, modules.data, devices.data],
  );

  const dirty = Object.keys(draft).length > 0;

  /** The level's boxes with the draft applied — what's on screen, not what's
   * saved. */
  const boxes = (model?.boxes ?? []).map((box) => {
    const body = draft[box.uuid]?.body;
    if (!body) return box;
    const geometry = (body.object_geometry as GeometryDescriptor | undefined) ?? box.geometry;
    const [x, y] = geometry.box_position_xyz;
    const [w, d, h] = geometry.box_dimension_xyz;
    return {
      ...box,
      name: (body.name as string | undefined) ?? box.name,
      rect: { pos: { x, y }, size: { x: w, y: d } },
      height: box.flat ? 0 : h,
      geometry,
    };
  });
  const selectedBox = boxes.find((b) => b.uuid === selected) ?? null;

  /**
   * The floor is editable too (Edit floor), and it isn't a box on its own
   * canvas — so a staged change to whatever *owns* this level resizes the
   * drawing under it. The grid stays as it was: re-deriving it mid-keystroke
   * would make the floor twitch between spacings.
   */
  const owner = context.station ?? context.lab ?? context.site;
  const ownerGeometry = owner ? draft[owner.uuid]?.body.object_geometry : undefined;
  const ownerFloor = (Array.isArray(ownerGeometry) ? ownerGeometry[0] : ownerGeometry) as
    | GeometryDescriptor
    | undefined;
  const drawn =
    model && ownerFloor
      ? {
          ...model,
          size: { x: ownerFloor.box_dimension_xyz[0], y: ownerFloor.box_dimension_xyz[1] },
        }
      : model;

  function patch(target: InspectorTarget, field: string, value: unknown) {
    setDraft((d) => ({
      ...d,
      [target.row.uuid]: {
        kind: target.kind,
        body: { ...d[target.row.uuid]?.body, [field]: value },
      },
    }));
  }

  /** A drag or a handle: the same edit a typed coordinate makes, so it goes
   * into the same draft — and opens the editor on what you just moved. */
  function setRect(uuid: string, rect: Rect) {
    const box = boxes.find((b) => b.uuid === uuid);
    if (!box) return;
    const target = { kind: box.kind, row: box.row };
    const g = box.geometry;
    patch(target, "object_geometry", {
      ...g,
      box_position_xyz: [rect.pos.x, rect.pos.y, g.box_position_xyz[2]],
      box_dimension_xyz: [rect.size.x, rect.size.y, g.box_dimension_xyz[2]],
    });
    setSelected(uuid);
    setInspect(target);
  }

  /** The height handle writes the one axis a floor drag can't reach. */
  function setHeight(uuid: string, height: number) {
    const box = boxes.find((b) => b.uuid === uuid);
    if (!box) return;
    const g = box.geometry;
    patch(
      { kind: box.kind, row: box.row },
      "object_geometry",
      { ...g, box_dimension_xyz: [g.box_dimension_xyz[0], g.box_dimension_xyz[1], height] },
    );
    setSelected(uuid);
    setInspect({ kind: box.kind, row: box.row });
  }

  const save = useMutation({
    mutationFn: async () => {
      for (const [uuid, entry] of Object.entries(draft)) {
        await API_BY_KIND[entry.kind].update(uuid, entry.body);
      }
    },
    onSuccess: async () => {
      setDraft({});
      setEditing(false);
      setNote(null);
      await queryClient.invalidateQueries();
    },
  });

  /**
   * Removing is a real DELETE, not a staged edit — it can't wait for Save,
   * because Cancel couldn't bring the record (or its revisions' subject) back.
   * So it asks first, and drops whatever the draft held for it.
   */
  const remove = useMutation({
    mutationFn: (target: InspectorTarget) => API_BY_KIND[target.kind].remove(target.row.uuid),
    onSuccess: async (_result, target) => {
      setSelected(null);
      setInspect(null);
      setDraft(({ [target.row.uuid]: _dropped, ...rest }) => rest);
      await queryClient.invalidateQueries();
    },
  });

  function confirmRemove(box: { kind: EntityKind; row: InspectorTarget["row"]; name: string }) {
    if (!confirm(`Delete ${box.kind.toLowerCase()} "${box.name}"? This can't be undone from here.`)) return;
    remove.mutate({ kind: box.kind, row: box.row });
  }

  /** Arrow keys nudge the selection by a grid cell (shift: ten), through the
   * same constraints a drag obeys. */
  function nudge(dx: number, dy: number) {
    if (!selectedBox || !model) return;
    const others = boxes
      .filter((b) => b.uuid !== selectedBox.uuid && b.layer === selectedBox.layer)
      .map((b) => b.rect);
    const { pos } = selectedBox.rect;
    setRect(
      selectedBox.uuid,
      slideTo(selectedBox.rect, { x: pos.x + dx * model.grid, y: pos.y + dy * model.grid }, model.size, others),
    );
  }

  /** Leaving the editor with unsaved work asks first. */
  function leaveEditing() {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    setDraft({});
    setEditing(false);
    setNote(null);
  }

  /** Level changes are blocked while a draft is open — save or cancel first. */
  function go(next: Partial<LevelContext>) {
    if (dirty) return;
    setSelected(null);
    setInspect(null);
    setNote(null);
    setCtx({ ...context, ...next });
  }

  /** Descend into a box — from its name on the canvas, or a double-click. */
  function enter(uuid: string) {
    const box = (model?.boxes ?? []).find((b) => b.uuid === uuid);
    const next = box && model ? drillInto(model, box) : null;
    if (next) go(next);
  }

  function select(uuid: string | null) {
    setSelected(uuid);
    const box = uuid === null ? null : boxes.find((b) => b.uuid === uuid);
    setInspect(box ? { kind: box.kind, row: box.row } : null);
  }

  // Keyboard: Esc lets go, Delete removes, arrows nudge — the last two only in
  // the editor, and never while typing into a field.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === "Escape") {
      if (creator.kind) creator.close();
      else select(null);
      return;
    }
    if (!editing || !selectedBox) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      confirmRemove(selectedBox);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = arrows[event.key];
    if (delta) {
      event.preventDefault();
      nudge(...delta);
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /** What an Add on this level hangs the new row off. */
  const parentUuid = context.station?.uuid ?? context.lab?.uuid ?? context.site?.uuid;
  const draftBody = inspect ? (draft[inspect.row.uuid]?.body ?? {}) : {};

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
            <div className="layout__canvas" data-inspects>
              <LayoutCanvas
                model={drawn!}
                boxes={boxes}
                preset={preset}
                editing={editing}
                selected={selected}
                api={view}
                labelNodes={labelNodes}
                onSelect={select}
                onDrill={enter}
                onGeometry={setRect}
                onHeight={setHeight}
              />

              {/* The names, in the middle of what they name — rendered here
                  and positioned by the scene. A box's name enters it, which is
                  how the old editor drilled down; a zone's is just a caption. */}
              <div className="layout__labels">
                {boxes
                  .map((b) => ({ key: b.uuid, name: b.name, enter: b.enterable }))
                  .map((item) => (
                  <button
                    key={item.key}
                    ref={(el) => {
                      if (el) labelNodes.current.set(item.key, el);
                      else labelNodes.current.delete(item.key);
                    }}
                    className={item.enter ? "layout__label layout__label--enter" : "layout__label"}
                    onClick={item.enter ? () => enter(item.key) : undefined}
                    title={item.enter ? `Enter ${item.name}` : item.name}
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              {/* Everything but the canvas floats over it: where you are on the
                  left, what you can do on the right, the view controls at the
                  bottom. The bar itself is click-through. */}
              {/* Open, the inspector covers the right of the canvas — so the
                  controls anchored there step aside, when there's room. */}
              <div className={inspect ? "canvas-overlay canvas-overlay--inspecting" : "canvas-overlay"}>
                <div className="canvas-overlay__bar">
                  <LocationPath
                    sites={data.sites}
                    labs={data.labs}
                    stations={data.stations}
                    site={context.site}
                    lab={context.lab}
                    station={context.station}
                    floor={context.floor}
                    level={model.level}
                    locked={dirty}
                    onLocked={() =>
                      setNote(
                        "Changing level needs a clean slate — Save your changes, or Cancel to discard them.",
                      )
                    }
                    onPickSite={(uuid) =>
                      go({
                        site: data.sites.find((s) => s.uuid === uuid) ?? null,
                        lab: null,
                        station: null,
                        floor: 0,
                      })
                    }
                    onPickFloor={(floor) => go({ floor })}
                    onEnterLab={(uuid) =>
                      go({ lab: data.labs.find((l) => l.uuid === uuid) ?? null, station: null })
                    }
                    onEnterStation={(uuid) =>
                      go({ station: data.stations.find((s) => s.uuid === uuid) ?? null })
                    }
                    onGoToSite={() => go({ lab: null, station: null })}
                    onGoToLab={() => go({ station: null })}
                  />

                  <span className="canvas-overlay__spacer" />

                  {editing && (
                    <>
                      <Menu
                        label="Add"
                        size="sm"
                        items={model.addable.map((kind) => ({ id: kind, label: kind }))}
                        onPick={(id) => {
                          const kind = id as EntityKind;
                          creator.open(kind, parentUuid ? { [PARENT_FIELD[kind]]: parentUuid } : {});
                        }}
                      />
                      {/* The site is the floor everything else stands on, and
                          it isn't a box on its own canvas — this is the way in
                          to editing it. One floor for now; no picker yet. */}
                      {model.level === "site" && context.site && (
                        <Button
                          size="sm"
                          onClick={() => setInspect({ kind: "Site", row: context.site! })}
                        >
                          Edit floor
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={selectedBox === null || remove.isPending}
                        title="Delete the selected box (Del)"
                        onClick={() => selectedBox && confirmRemove(selectedBox)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>

                {note && (
                  <div className="canvas-overlay__note">
                    <Alert kind="info">{note}</Alert>
                  </div>
                )}

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
            </div>
          )}
        </div>

        <Inspector
          open={creator.kind !== null || inspect !== null}
          kind={creator.kind ?? inspect?.kind ?? "Inspector"}
          title={
            creator.kind
              ? ((creator.draft.name as string | undefined) ?? "")
              : ((draftBody.name as string | undefined) ?? inspect?.row.name)
          }
          subtitle={creator.kind ? undefined : inspect?.row.uuid}
          onClose={() => {
            if (creator.kind) return creator.close();
            setInspect(null);
            setSelected(null);
          }}
          edit={creator.kind ? creator.edit : {
            editing,
            dirty,
            saving: save.isPending,
            onToggle: () => (editing ? leaveEditing() : setEditing(true)),
            onSave: () => save.mutate(),
            onCancel: leaveEditing,
            onRename: (name) => inspect && patch(inspect, "name", name),
          }}
        >
          {creator.kind ? (
            <CreatePanel
              kind={creator.kind}
              draft={creator.draft}
              set={creator.set}
              error={creator.error}
            />
          ) : (
          <InspectorNavContext.Provider value={setInspect}>
            <EditContext.Provider
              value={{
                editing,
                draft: draftBody,
                set: (field, value) => inspect && patch(inspect, field, value),
              }}
            >
              {inspect && <EntityInspector kind={inspect.kind} row={inspect.row} />}
            </EditContext.Provider>
          </InspectorNavContext.Provider>
          )}
        </Inspector>
      </div>
    </>
  );
}
