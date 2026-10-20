/**
 * The layout canvas: a real 3D scene, drawn as a technical illustration.
 *
 * One orthographic camera serves both views — the old editor's "isometric"
 * projection was `sinθ = 27/46`, i.e. 35.9° elevation at 45° azimuth, which is
 * true isometric to within a degree, and its "2D" projection is the same
 * camera looking straight down. So the two views are camera angles here, not
 * two renderers, and the depth buffer replaces the painter's algorithm the old
 * canvas had to sort by hand.
 *
 * Nothing is lit. Every surface is a flat colour with a thin outline, the way
 * the old canvas drew its three-tone tiles — which is also what keeps the
 * palette exactly as it was: a box's top/left/right faces carry the old fill's
 * three tones as three materials.
 *
 * Dragging raycasts the pointer onto the floor plane analytically rather than
 * through the scene graph, so a drag can't be stolen by whatever box happens
 * to be under the cursor.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { clampToFloor, round3, slideTo, softSnap, type Rect, type Vec2 } from "./constraints";
import type { Hint, LayoutBox, LevelModel } from "./levels";
import { EDGE, FILL_ACTIVE, FLOOR, FLOOR_EDGE, GRID, LAB, SELECT, type BoxFill, type Wash } from "./palette";

/** What the overlay's zoom controls drive. */
export interface ViewApi {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export type Preset = "iso" | "top";

/** Handles are this many pixels across, whatever the zoom or the level — the
 * same reasoning as the names, which are HTML and don't scale either. */
const GRIP_PX = 9;

/** How far the selected box's name steps up to clear its height handle. */
const RAISED_PX = 22;

/** True isometric: 45° azimuth, 35.264° elevation. */
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const TOP_DIR = new THREE.Vector3(0, 1, 0);

export interface SceneProps {
  model: LevelModel;
  /** Boxes with the draft applied — what's on screen, not what's saved. */
  boxes: LayoutBox[];
  preset: Preset;
  editing: boolean;
  selected: string | null;
  onSelect: (uuid: string | null) => void;
  onDrill: (uuid: string) => void;
  onGeometry: (uuid: string, rect: Rect) => void;
  /** Height is its own axis and its own handle, so it has its own channel. */
  onHeight: (uuid: string, height: number) => void;
  /** Filled in with the zoom/reset controls once the canvas is up. */
  api: RefObject<ViewApi | null>;
  /** The name elements the screen rendered, keyed by uuid — the scene moves
   * them, it doesn't own them. */
  labelNodes: RefObject<Map<string, HTMLElement>>;
}

export function LayoutCanvas(props: SceneProps) {
  return (
    <Canvas
      orthographic
      camera={{ position: [1, 1, 1], zoom: 40, near: 0.01, far: 10000 }}
      onPointerMissed={() => props.onSelect(null)}
      gl={{ antialias: true }}
      style={{ background: "#FFFFFF" }}
    >
      <Contents {...props} />
    </Canvas>
  );
}

function Contents({
  model,
  boxes,
  preset,
  editing,
  selected,
  onSelect,
  onDrill,
  onGeometry,
  onHeight,
  api,
  labelNodes,
}: SceneProps) {
  const { camera, gl } = useThree();
  const thin = Math.max(model.size.x, model.size.y) * 0.005;

  // ---- camera -------------------------------------------------------------
  const tallest = boxes.reduce((h, b) => Math.max(h, b.height), 0);
  const fit = useCallback(() => {
    const cam = camera as THREE.OrthographicCamera;
    const centre = new THREE.Vector3(model.size.x / 2, tallest / 2, model.size.y / 2);
    cam.up.set(0, 1, 0);
    if (preset === "top") cam.up.set(0, 0, -1); // backend +y runs down the screen
    cam.position.copy(centre).addScaledVector(preset === "iso" ? ISO_DIR : TOP_DIR, 500);
    cam.lookAt(centre);
    cam.updateMatrixWorld();

    // Fit: put the room's corners in camera space and scale to the viewport.
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [0, model.size.x])
      for (const y of [0, tallest])
        for (const z of [0, model.size.y]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
    const view = gl.domElement;
    cam.zoom =
      0.88 * Math.min(view.clientWidth / (maxX - minX), view.clientHeight / (maxY - minY));
    // Re-centre on the drawing rather than on the floor's midpoint.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }, [camera, gl, model.size.x, model.size.y, tallest, preset]);

  /**
   * Fit on the level and the projection, and nothing else. Depending on the
   * canvas size meant any re-render that recreated it — a refetch, a draft
   * change — silently threw away whatever you had zoomed to.
   */
  const fitKey = `${model.level}:${model.size.x}x${model.size.y}:${preset}`;
  useLayoutEffect(() => fit(), [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Zoom on the wheel, and the zoom controls the overlay drives. Panning is
   * *not* here: it hangs off the floor mesh below, so R3F decides whether the
   * pointer landed on a box or on the floor. Doing it on the DOM element
   * raced R3F's own listener, and both a box and the camera moved at once.
   */
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    const el = gl.domElement;
    const scale = (by: number) => {
      cam.zoom = Math.max(1e-3, cam.zoom * by);
      cam.updateProjectionMatrix();
    };
    api.current = { zoomIn: () => scale(1.25), zoomOut: () => scale(1 / 1.25), reset: fit };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      scale(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [camera, gl, api, fit]);

  /** Drag the floor to pan. Boxes stop the event, so they never reach here. */
  const pan = (event: ThreeEvent<PointerEvent>) => {
    const cam = camera as THREE.OrthographicCamera;
    let last = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
    const move = (m: PointerEvent) => {
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position
        .addScaledVector(right, -(m.clientX - last.x) / cam.zoom)
        .addScaledVector(up, (m.clientY - last.y) / cam.zoom);
      last = { x: m.clientX, y: m.clientY };
      cam.updateMatrixWorld();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- pointer → floor ----------------------------------------------------
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const floorPoint = useMemo(() => {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    return (event: PointerEvent): Vec2 => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      ray.ray.intersectPlane(plane, hit);
      return { x: hit.x, y: hit.z };
    };
  }, [camera, gl, plane]);

  /** Start a move or a resize; both run off the same floor-plane maths. */
  const drag = (box: LayoutBox, mode: "move" | "resize") => (event: PointerEvent) => {
    const start = floorPoint(event);
    const from = box.rect;
    // Only boxes on the same layer get in the way: a zone is drawn around
    // stations, so it can't be blocked by them, nor they by it.
    const others = boxes.filter((b) => b.uuid !== box.uuid && b.layer === box.layer).map((b) => b.rect);
    // A quarter of a cell: close enough to help, small enough that the box
    // still tracks the pointer for most of the drag.
    const tolerance = model.grid * 0.25;

    const move = (e: PointerEvent) => {
      const now = floorPoint(e);
      if (mode === "move") {
        const to = {
          x: softSnap(from.pos.x + (now.x - start.x), model.grid, tolerance),
          y: softSnap(from.pos.y + (now.y - start.y), model.grid, tolerance),
        };
        onGeometry(box.uuid, slideTo(from, to, model.size, others));
      } else {
        const min = model.grid;
        const size = {
          x: Math.max(min, softSnap(from.size.x + (now.x - start.x), model.grid, tolerance)),
          y: Math.max(min, softSnap(from.size.y + (now.y - start.y), model.grid, tolerance)),
        };
        const candidate = clampToFloor({ pos: from.pos, size }, model.size);
        // A resize that would swallow a neighbour is simply not applied.
        if (!others.some((o) => overlaps(candidate, o))) onGeometry(box.uuid, candidate);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * The height handle. A box's height runs along an axis the floor plane
   * can't answer for, so instead of raycasting this measures how many pixels
   * one metre of height covers at the current camera and converts the drag
   * against that.
   */
  const dragHeight = (box: LayoutBox) => (event: PointerEvent) => {
    const cam = camera as THREE.OrthographicCamera;
    const at = new THREE.Vector3(
      box.rect.pos.x + box.rect.size.x / 2,
      0,
      box.rect.pos.y + box.rect.size.y / 2,
    );
    const view = gl.domElement.getBoundingClientRect();
    const ground = at.clone().project(cam);
    const raised = at.clone().setY(1).project(cam);
    const pxPerMetre = ((raised.y - ground.y) / 2) * view.height;
    // Straight down the camera sees no height at all — nothing to drag against.
    if (Math.abs(pxPerMetre) < 1) return;

    const from = box.height;
    const startY = event.clientY;
    const move = (e: PointerEvent) => {
      const raw = from + (startY - e.clientY) / pxPerMetre;
      onHeight(box.uuid, Math.max(model.grid, softSnap(raw, model.grid, model.grid * 0.25)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <Room size={model.size} grid={model.grid} thin={thin} onPan={pan} />

      <LabelPositions
        boxes={boxes}
        nodes={labelNodes}
        // Top down shows no height, so there is no height handle and the
        // name has nothing to clear.
        raised={editing && preset === "iso" ? selected : null}
      />

      {model.hints.map((hint) => {
        const parent = boxes.find((b) => b.uuid === hint.parent);
        return parent ? <HintBox key={hint.key} hint={hint} origin={parent.rect.pos} thin={thin} /> : null;
      })}

      {boxes.map((box) =>
        box.flat ? (
          // A lab or a zone is a wash on the floor, not a solid — whatever
          // stands inside it has to read through. Zones sit under labs.
          <FlatArea
            key={box.uuid}
            rect={box.rect}
            y={thin * (box.layer === "zone" ? 0.05 : 0.1)}
            colour={box.wash ?? LAB}
            selected={box.uuid === selected}
            onSelect={() => onSelect(box.uuid)}
            onDrill={() => onDrill(box.uuid)}
            onDrag={editing ? drag(box, "move") : undefined}
            onResize={editing ? drag(box, "resize") : undefined}
          />
        ) : (
          <BoxMesh
            key={box.uuid}
            box={box}
            selected={box.uuid === selected}
            editing={editing}
            thin={thin}
            onSelect={() => onSelect(box.uuid)}
            onDrill={() => onDrill(box.uuid)}
            onDrag={drag(box, "move")}
            onResize={drag(box, "resize")}
            onHeight={dragHeight(box)}
            heightHandle={preset === "iso"}
          />
        ),
      )}
    </>
  );
}

/** Pointer cursor over anything selectable; a grip's own cursor wins. */
function useHoverCursor(cursor: string) {
  const { gl } = useThree();
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!gl.domElement.style.cursor) gl.domElement.style.cursor = cursor;
    },
    onPointerOut: () => {
      if (gl.domElement.style.cursor === cursor) gl.domElement.style.cursor = "";
    },
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.pos.x < b.pos.x + b.size.x &&
  b.pos.x < a.pos.x + a.size.x &&
  a.pos.y < b.pos.y + b.size.y &&
  b.pos.y < a.pos.y + a.size.y;

/**
 * A drag handle. Scaled against the camera's zoom every frame so it stays the
 * same size on screen, and drawn over everything so a corner buried in a box
 * is still grabbable.
 */
function Grip({
  position,
  cursor,
  onPointerDown,
}: {
  position: [number, number, number];
  /** The cursor while over it. Handles are the only thing on the canvas that
   * changes the cursor, so a changed cursor means "you have hold of one". */
  cursor: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  useFrame(({ camera }) => {
    ref.current?.scale.setScalar(GRIP_PX / (camera as THREE.OrthographicCamera).zoom);
  });
  return (
    <mesh
      ref={ref}
      position={position}
      renderOrder={10}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        gl.domElement.style.cursor = cursor;
      }}
      onPointerOut={() => {
        gl.domElement.style.cursor = "";
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={SELECT} depthTest={false} />
    </mesh>
  );
}

/** Outline of whatever geometry it's given — every surface here has one. */
function Edges({
  geometry,
  color,
  angle = 1,
  opacity = 1,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  /** Only creases sharper than this many degrees get a line — what keeps a
   * cylinder to its two rims rather than forty facets. */
  angle?: number;
  /** Below 1 for a faint outline (hints). */
  opacity?: number;
}) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, angle), [geometry, angle]);
  return (
    <lineSegments geometry={edges} raycast={opacity < 1 ? () => null : undefined}>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  );
}

/**
 * The surface the layout sits on: a floor slab and its grid. The room's walls
 * are not drawn — the plan view of the surface is what's wanted here.
 */
function Room({ size, grid, thin, onPan }: { size: Vec2; grid: number; thin: number; onPan: (e: ThreeEvent<PointerEvent>) => void }) {
  const floor = useMemo(() => new THREE.BoxGeometry(size.x, thin, size.y), [size.x, size.y, thin]);

  const lines = useMemo(() => {
    const points: number[] = [];
    for (let x = 0; x <= size.x + 1e-9; x = round3(x + grid)) points.push(x, 0, 0, x, 0, size.y);
    for (let y = 0; y <= size.y + 1e-9; y = round3(y + grid)) points.push(0, 0, y, size.x, 0, y);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, [size.x, size.y, grid]);

  return (
    <group>
      <mesh geometry={floor} position={[size.x / 2, -thin / 2, size.y / 2]} onPointerDown={onPan}>
        <meshBasicMaterial color={FLOOR} />
      </mesh>
      <group position={[size.x / 2, -thin / 2, size.y / 2]}>
        <Edges geometry={floor} color={FLOOR_EDGE} />
      </group>

      <lineSegments geometry={lines} position={[0, thin * 0.02, 0]}>
        <lineBasicMaterial color={GRID} />
      </lineSegments>
    </group>
  );
}

/**
 * A translucent area lying on the floor — a zone, or a lab seen from the site
 * above it. `y` lifts it clear of the floor and of the layers below it; the
 * offsets scale with the room so they work at 60 m and at 1 m.
 */
interface FlatAreaProps {
  rect: Rect;
  y: number;
  colour: Wash;
  selected?: boolean;
  onSelect?: () => void;
  onDrill?: () => void;
  onDrag?: (event: PointerEvent) => void;
  onResize?: (event: PointerEvent) => void;
}

function FlatArea({ rect, y, colour, selected, onSelect, onDrill, onDrag, onResize }: FlatAreaProps) {
  const { pos, size } = rect;
  const geometry = useMemo(() => new THREE.PlaneGeometry(size.x, size.y), [size.x, size.y]);
  const hover = useHoverCursor(onDrag ? "move" : "pointer");
  return (
    <group position={[pos.x + size.x / 2, y, pos.y + size.y / 2]}>
      <mesh
        {...(onSelect ? hover : {})}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={geometry}
        onClick={onSelect && ((e) => { e.stopPropagation(); onSelect(); })}
        onDoubleClick={onDrill && ((e) => { e.stopPropagation(); onDrill(); })}
        onPointerDown={onDrag && ((e) => { e.stopPropagation(); onSelect?.(); onDrag(e.nativeEvent); })}
      >
        <meshBasicMaterial color={colour.fill} transparent opacity={colour.opacity} side={THREE.DoubleSide} />
      </mesh>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Edges geometry={geometry} color={selected ? SELECT : colour.edge} />
      </group>

      {selected && onResize && (
        <Grip
          position={[size.x / 2, 0, size.y / 2]}
          cursor="nwse-resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResize(e.nativeEvent);
          }}
        />
      )}
    </group>
  );
}

/**
 * What a body looks like, from the primitive its geometry names. This is the
 * one place a solid's appearance is decided, and so the seam a richer asset
 * (a glTF mesh, a MuJoCo body — see docs/project_plan/DIGITAL_TWIN.md) plugs
 * into later: everything else — selection, dragging, handles, labels — works
 * on the footprint and the height, never on the mesh.
 *
 * Built at its real size rather than scaled, so outlines stay one pixel.
 *
 * A box's three visible faces carry the old palette's three tones: three.js
 * +x reads as the screen-right face and +z as the screen-left one, which is
 * the same handedness the old projection had.
 */
function bodyOf(shape: LayoutBox["shape"], w: number, h: number, d: number, fill: BoxFill) {
  const flat = (color: string) => new THREE.MeshBasicMaterial({ color });
  if (shape === "cylinder") {
    // Groups: side, top cap, bottom cap. Elliptical when the footprint isn't
    // square, so it always fills its footprint exactly.
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 40).scale(w, h, d);
    return { geometry, material: [flat(fill.left), flat(fill.top), flat(fill.top)], edgeAngle: 30 };
  }
  if (shape === "sphere") {
    const geometry = new THREE.SphereGeometry(0.5, 32, 16).scale(w, h, d);
    return { geometry, material: flat(fill.top), edgeAngle: 89 };
  }
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = [flat(fill.right), flat(fill.right), flat(fill.top), flat(fill.top), flat(fill.left), flat(fill.left)];
  return { geometry, material, edgeAngle: 1 };
}

const HINT_FILL = new THREE.MeshBasicMaterial({ color: FILL_ACTIVE.top, transparent: true, opacity: 0.16, depthWrite: false });
const ignore = () => null;

/** A faint, untouchable outline of something inside a box (see `Hint`). */
function HintBox({ hint, origin, thin }: { hint: Hint; origin: Vec2; thin: number }) {
  const { pos, size } = hint.rect;
  const height = Math.max(hint.height, thin);
  const geometry = useMemo(() => new THREE.BoxGeometry(size.x, height, size.y), [size.x, size.y, height]);
  return (
    <group position={[origin.x + pos.x + size.x / 2, height / 2 + thin * 0.2, origin.y + pos.y + size.y / 2]}>
      <mesh geometry={geometry} material={HINT_FILL} raycast={ignore} />
      <Edges geometry={geometry} angle={1} color={FILL_ACTIVE.top} opacity={0.35} />
    </group>
  );
}

interface BoxMeshProps {
  box: LayoutBox;
  selected: boolean;
  editing: boolean;
  thin: number;
  onSelect: () => void;
  onDrill: () => void;
  onDrag: (event: PointerEvent) => void;
  onResize: (event: PointerEvent) => void;
  onHeight: (event: PointerEvent) => void;
  /** Height can't be dragged in a view that doesn't show it. */
  heightHandle: boolean;
}

function BoxMesh({
  box,
  selected,
  editing,
  onSelect,
  onDrill,
  onDrag,
  onResize,
  onHeight,
  heightHandle,
}: BoxMeshProps) {
  const { pos, size } = box.rect;
  // A box with no recorded height still needs to be a box you can grab.
  const height = Math.max(box.height, Math.max(size.x, size.y) * 0.05);
  const body = useMemo(
    () => bodyOf(box.shape, size.x, height, size.y, box.fill),
    [box.shape, size.x, size.y, height, box.fill],
  );
  const hover = useHoverCursor(editing ? "move" : "pointer");
  const centre: [number, number, number] = [pos.x + size.x / 2, height / 2, pos.y + size.y / 2];

  return (
    <group position={centre}>
      <mesh
        {...hover}
        geometry={body.geometry}
        material={body.material}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDrill();
        }}
        onPointerDown={(e) => {
          if (!editing) return;
          e.stopPropagation();
          onSelect();
          onDrag(e.nativeEvent);
        }}
      />
      <Edges geometry={body.geometry} angle={body.edgeAngle} color={selected ? SELECT : EDGE} />

      {/* Footprint on the floor, height on the roof — each handle sits on
          the thing it changes. */}
      {selected && editing && (
        <>
          <Grip
            position={[size.x / 2, -height / 2, size.y / 2]}
            cursor="nwse-resize"
            onPointerDown={(e) => {
              e.stopPropagation();
              onResize(e.nativeEvent);
            }}
          />
          {heightHandle && (
            <Grip
              position={[0, height / 2, 0]}
              cursor="ns-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                onHeight(e.nativeEvent);
              }}
            />
          )}
        </>
      )}
    </group>
  );
}

/**
 * Keeps each name over the middle of what it names.
 *
 * The elements themselves are rendered by the screen, outside the canvas —
 * R3F reconciles everything inside `<Canvas>` as three.js objects, so DOM
 * can't live in here. Positioning them imperatively in `useFrame` also means
 * a pan doesn't re-render the screen sixty times a second.
 */
function LabelPositions({
  boxes,
  nodes,
  raised,
}: {
  boxes: LayoutBox[];
  nodes: RefObject<Map<string, HTMLElement>>;
  /** The box whose name steps up, if any: the one being edited, whose height
   * handle sits in the middle of its roof — right where the name would be. */
  raised: string | null;
}) {
  const { camera, size } = useThree();

  useFrame(() => {
    const v = new THREE.Vector3();
    const place = (key: string, x: number, y: number, z: number, lift = 0) => {
      const el = nodes.current?.get(key);
      if (!el) return;
      v.set(x, y, z).project(camera);
      el.style.transform = `translate(-50%, -50%) translate(${(v.x * 0.5 + 0.5) * size.width}px, ${
        (-v.y * 0.5 + 0.5) * size.height - lift
      }px)`;
    };
    for (const b of boxes)
      place(
        b.uuid,
        b.rect.pos.x + b.rect.size.x / 2,
        b.height,
        b.rect.pos.y + b.rect.size.y / 2,
        b.uuid === raised ? RAISED_PX : 0,
      );
  });

  return null;
}
