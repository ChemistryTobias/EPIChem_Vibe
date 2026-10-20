# From layout boxes to a digital twin — plan

**Status:** plan, not built. Stage T0 is what exists today. Extends Roadmap
1.2 (the layout) and plan §10; bound by plan §3's non-goals and §12.2
(software safety is advisory).

## Goal

The lab layout's 3D scene becomes a **digital twin** of the lab: the real
shapes of stations and instruments, their live state, articulated robots that
move as the real ones do, and a physics model good enough to answer *"will
this procedure reach, and will it collide?"* before anything moves.

What it is **not**: a motion planner or a controller. Perceive → plan → act
stays on the robot side (plan §3: ROS 2 / the vendor controller behind an
EPICS/REST façade), and execution stays in the station pods' RunEngines. The
twin *watches* and *predicts*; it never commands hardware.

**Engine: [MuJoCo](https://mujoco.readthedocs.io/en/stable/overview.html)**
(Apache-2.0 — compatible with the open-source requirement). Fast, stable
contact physics, a plain-XML model format (MJCF) that EPIChem can *generate*,
good Python bindings for a backend service, and Z-up like our backend.

| Considered | Why not (first) |
|---|---|
| Isaac Sim | Not open source; GPU-heavy; far beyond what lab checks need. |
| Gazebo + ROS 2 | Heavier stack; right choice *if* the robots already speak ROS 2 — the MJCF/URDF bridge keeps that door open. |
| PyBullet | Less actively maintained; weaker model tooling. |
| three.js only | No physics, no kinematics — a picture, not a twin. |

## Where we stand (T0 — done)

- One renderer for three levels (site → lab → station), Three.js with an
  orthographic camera; drag, resize, height, top/iso.
- **Geometry is parent-local and metric**: every object's
  `box_position_xyz` is measured from its parent's corner, in metres, Z-up.
  That *is* a kinematic tree's frame convention — exporting it to MJCF is a
  direct walk, no re-basing.
- `GeometryDescriptor.shape` (box / cylinder / sphere) renders through one
  seam, `bodyOf()` in `frontend/.../layout/Scene.tsx`: selection, dragging,
  handles and labels only ever use the footprint and height, never the mesh.
  A richer body plugs in there without touching the editor.
- `GeometryDescriptor.internal_positions` stores named points inside an
  object (teach points, ports) — variadic tuples, so a 6-D pose fits.
- The axis conversion (backend Z-up ↔ three.js Y-up) happens in exactly one
  place, `rectOf()` in `levels.ts`.
- Station pods already split *driver* from *ophyd device*
  (`bluesky/epichem_pod/devices/lab.py`), so a simulated instrument is a
  config change — which is how the twin will plug into execution (T4).

## Stages

Each stage is useful on its own; none requires the next.

### T1 — real shapes (assets)

- `GeometryDescriptor.asset_3d`: a reference to a stored file
  (`core/file_storage`) — **glTF/GLB** for display. (The field is already
  sketched, commented out, in `geometry/schema.py`.)
- `GeometryDescriptor.rotation_z` (yaw, degrees) — the one rotation a floor
  plan needs; the editor gets a rotate handle. Full orientation waits for a
  real need.
- `bodyOf()` loads the GLB (three.js `GLTFLoader`), scales it into the
  footprint box, and falls back to the primitive while loading or if absent.
  The box stays the editing proxy.
- Render `internal_positions` as small markers in the station level; edit
  them like boxes. Teach points move from the pods' `station.yaml` into the
  station record, and pods read them from EPIChem at start (one source of
  truth, plan §6.1's rule).

### T2 — live state

- Colour/badge boxes by device state (DESIGN.md: green-light idle,
  blue running, orange warning, red fault), with staleness.
- Source: the pods. Start by polling each station's
  `/execution` status (exists) and, for poses and readings, a small
  `/execution/readings` endpoint backed by the pod; move to the plan's MQTT
  `device/*/state` retained topics (§8.2) when there are enough stations to
  justify a broker.
- Show the running queue item on its station; a run's steps highlight the
  devices they touch.

### T3 — kinematic models (MJCF)

- A **device type carries a kinematic model**: an MJCF fragment (bodies,
  joints, geoms, meshes) attached to its CapabilityClass / device type as a
  file — authored once per robot model, not per lab. For the SCARA arm:
  three revolute joints and one prismatic, matching the ophyd axes
  (`j1, j2, j3, j4`).
- **EPIChem generates `station.xml`** (and `lab.xml`) from the registry:
  every placed object becomes a `<body pos=… >` with a `<geom>` from its
  primitive or mesh; devices with a model include their fragment; the
  hierarchy nests bodies the same way it nests rows. Teach points become
  `<site>`s. Units: metres in MJCF; the pods' drivers stay in mm/deg and the
  arm's ophyd device converts.
- Endpoint: `GET /stations/{id}/twin.mjcf` — also handy for anyone wanting
  to open the station in MuJoCo's own viewer.

### T4 — simulation service

A `twin` service (Python, `mujoco` bindings), one model per lab or station,
with two jobs:

1. **A simulated station.** A MuJoCo-backed driver with the *same method
   surface* as the real one (e.g. `jump(x, y, z, r)` → set joint targets,
   step until settled or contact) slots into a pod's `station.yaml` instead
   of `drivers.sim:SimArm`. A "twin pod" then runs the exact procedure — same
   plans, same ophyd devices, same queue items — against physics instead of
   hardware. That's a **dry run** for any procedure, for free, because the
   driver seam already exists.
2. **A validation tier.** Before dispatch (plan §9.3, tiers 3–4), replay a
   procedure's arm targets in the twin: unreachable targets, joint-limit
   violations and collisions with placed objects become diagnostics on the
   designer's nodes — warnings, never a substitute for interlocks (§12.2).

### T5 — the twin in the browser

- Stream body poses (MuJoCo `xpos`/`xquat`) from the twin service over a
  WebSocket into the existing three.js scene at ~30 Hz — the same `Body` seam
  renders them. During a real run, poses come from the pods' readings
  instead (T2), so the same view shows *planned* vs *actual*.
- Worth evaluating: MuJoCo's WebAssembly builds, to run small station models
  client-side for instant reach previews while editing.

## Data-model changes, collected

| Change | Stage | Notes |
|---|---|---|
| `GeometryDescriptor.asset_3d` (file ref) | T1 | glTF/GLB for display |
| `GeometryDescriptor.rotation_z` | T1 | yaw only |
| `internal_positions` edited in the UI, read by pods | T1 | replaces pod-local teach points |
| Kinematic model file on device type / CapabilityClass | T3 | MJCF fragment; Roadmap 1.3's CapabilityClass is its natural home |
| `GET /stations/{id}/twin.mjcf` | T3 | generated, never stored |
| `twin` service + MuJoCo-backed drivers | T4 | a pod profile can select it |

No Alembic until the entities settle (PROJECT_HISTORY decision) — these are
additive JSON fields on `object_geometry` until then.

## Open questions

- Who authors the per-robot MJCF fragment — vendor URDF converted
  (`mujoco` can compile URDF), or hand-written? Probably converted, then
  trimmed.
- Mesh storage size and caching for large labs (GLB per device type, not per
  instance).
- Twin granularity: one MuJoCo model per station (cheap, isolated) or per lab
  (needed for cross-station transfers by a mobile robot)?
- How close must the twin be before its collision warnings are worth showing
  — calibrate against a real station's taught points first.
