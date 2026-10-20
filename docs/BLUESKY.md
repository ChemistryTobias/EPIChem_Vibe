# Bluesky station pods

How a station's control stack is packaged, how to add **ophyd devices** and
**Bluesky plans** to it, and how EPIChem's workflow manager picks them up.
Code: [`bluesky/`](../bluesky). Roadmap: milestone 1.3 (pods) and 2.x
(workflows).

> **The boundary (plan §3):** EPIChem never executes anything. A pod's
> RunEngine executes plans; ophyd talks to the instruments through their
> drivers. EPIChem reads what a pod offers, validates and compiles procedures
> into queue items, dispatches them, and observes what happened.

```
EPIChem console ──► EPIChem API ──HTTP (ApiKey)──► bluesky-httpserver ─0MQ─► RE Manager ─► RE Worker
 (designer, runs)    (procedures,                    (one per station pod)                  │
                      runs, samples)                                                RunEngine + plans
                                                                                            │
                                                                         ophyd Devices (epichem_pod)
                                                                                            │
                                                                     drivers (sim, or the real instrument)
```

## Quick start: a pod in three commands

A pod is a pip package, [`epichem-pod`](../bluesky) — like IvoryOS, you point
it at the Python objects you already drive your instruments with and it does
the rest:

```bash
pip install "epichem-pod @ git+https://github.com/ChemistryTobias/EPIChem_Vibe#subdirectory=bluesky"
epichem-pod init my-station            # my-station/station.py (+ Dockerfile, compose.yaml)
epichem-pod serve my-station/station.py --epichem http://<epichem-host>:8000 --api-key <pod key>
```

`station.py` is plain Python: create your drivers, call `expose(globals())`:

```python
from epichem_pod import expose
from mylab.ika import HotplateDriver

hotplate = HotplateDriver("192.168.10.22", 4001, hotplate_number=1, T_max=300)
expose(globals())
```

`expose()` turns every driver object into an **ophyd device** and every
public method into a **Bluesky plan**:

- methods named `get_*`, `read_*`, `request_*`, `is_*`, `has_*` that need no
  arguments are the device's **readings** (live in Device Monitoring);
- every other public method becomes a plan `<device>_<method>`
  (`hotplate_set_temperature_setpoint`), in the library
  *`<device>` · low level*. Its parameters, defaults, description and
  `[min, max]` ranges come from the signature and the docstring (Google,
  NumPy or Sphinx style: `T_SET (int, [0, 300]): Temperature setpoint
  [degC].`);
- `read_devices` (what the readings endpoint calls) and a `RunEngine` are
  added if you didn't define them.

Plans you write below `expose()` (composing the generated ones) are your
station's high-level library. `epichem-pod discover station.py` prints what
was found without starting anything.

`serve` runs everything: Redis (starts `redis-server` if none is running),
the queueserver's RE Manager over your script, bluesky-httpserver on
`--port` (60610), opens the worker, and with `--epichem` **announces the pod
every 30 s**. In the console, **Device Management → Hierarchy → New device**
opens *Discover*: the pod is listed with its devices and plans; **Add as
station** (in a lab) or **Link to station** creates/wires the station and
registers its devices — a person confirms, nothing is adopted automatically
(plan §6.2). A pod that can't reach EPIChem can be added by **Probe an
address** instead. Announcements must carry the shared pod key
(`EPICHEM_QSERVER_API_KEY`); `--public-url` sets the address EPIChem should
use if it differs from what the pod guesses.

`init` also writes a `Dockerfile` and `compose.yaml`, so the same station
runs in a container (`docker compose up`); every `serve` option reads an
environment variable (`EPICHEM_URL`, `EPICHEM_POD_URL`, `STATION_NAME`,
`QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY`, …).

## What's in the package

| Path | What it is |
|---|---|
| `epichem_pod/auto.py` | `expose()`: drivers → ophyd devices + plans, docstring parsing. |
| `epichem_pod/cli.py` | `epichem-pod init / discover / serve`, the announce heartbeat. |
| `epichem_pod/drivers/` | `sim.py`: simulators with the method surface of real lab drivers (SCARA arm + gripper, pipetting module, hotplate, spin coater). `load.py` builds a driver from a config entry. |
| `epichem_pod/devices/lab.py` | Hand-written ophyd wrappers: each driver call becomes a `Movable` (`DriverAction`) whose Status reports how the call went; `do()` runs one and re-raises the driver's error. |
| `epichem_pod/devices/station.py` | Loads a profile's `station.yaml`: devices, named teach points, settings. |
| `epichem_pod/devices/ramp.py`, `readings.py` | Soft devices for the synthesis demo; the `read_devices` function. |
| `epichem_pod/plans/` | The demo stations' plan libraries. One module per library; the palette groups by module. |
| `epichem_pod/templates/` | What `init` writes. |
| `profiles/<station>/` | Demo stations. `bench/station.py` is the `expose()` style; `spinbot/` and `synthesis/` are full queueserver profile directories (`00-devices.py`, `05-run-engine.py`, `10-plans.py`, `20-functions.py`, `station.yaml`) — `serve` accepts either. |

Three demo stations ship:

- **`bench`** — a hotplate and a pipette, simulated, exposed automatically,
  plus one hand-written plan (`warm_up`). Start here.
- **`spinbot`** — a spin-coating robot station: SCARA arm with gripper and
  pipette, two hotplates, a spin coater, vial and tip racks. Two plan
  libraries:
  - *Spinbot* (high level, what a scientist uses): `move_home`,
    `pickup_and_deliver`, `add_carrier_to_process_rack`,
    `remove_carrier_from_process_rack`, `reinit_pipette`, `pickup_tip`,
    `aspirate_liquid`, `dispense_liquid`, `discard_pipette_tip`,
    `start_heating`, `stop_heating`, `spin`, and `coat_sample` (load →
    drop-cast → spin → anneal → unload, recorded as one bluesky run).
  - *Spinbot · low level* (single device actions): `arm_jump`,
    `arm_move_linear`, `arm_jump_angle`, `arm_go_to`, `gripper_open/close`,
    `pipette_initialize/pick_up_tip/aspirate/dispense/discard_tip`,
    `hotplate_set_temperature/off/stir`, `spincoater_spin`,
    `station_snapshot`.
- **`synthesis`** — heater-stirrer, syringe pump, spectrometer: `heat`,
  `stir`, `dispense`, `hold`, `measure_absorbance`, `temperature_series`,
  plus bluesky's stock `count`/`scan`.

## Run the demo

```bash
docker compose up          # api, web, db, redis, station-spinbot, station-synthesis, station-bench
```

The pods announce themselves to the API (`EPICHEM_URL=http://api:8000`).
In the console:

1. **Device Management → Hierarchy → New device**: the pods are listed;
   add each as a station (or link it to an existing one). Or set a station's
   *Queueserver URL* by hand (`http://station-spinbot:60610`; from the host,
   `http://localhost:60610` / `60611` / `60612`).
2. **Device Monitoring**: pick a station — its state, queue, live device
   readings, its **station plans** and each device's **actions**; click one
   to run it right there (a *manual run*, recorded under Runs). *Open
   environment* / *Start queue* when the pod needs it.
3. **Workflows → Procedures**: search, create, duplicate; open one in the
   **Designer** — add plan steps from any station, plus *Wait*, *Input*
   (asks the operator, values usable by later steps) and *HTTP request*
   steps. **Save**, **Run**.
4. **Workflows → Runs** follows the run (and is where Input steps are
   answered); **Samples** has the sample it made.

Simulated instruments run `EPICHEM_SIM_SPEED` times faster than real time
(default 10).

### Without Docker

```bash
cd bluesky && python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/epichem-pod serve profiles/bench/station.py --api-key epichemdevkey --epichem http://localhost:8000
.venv/bin/epichem-pod serve profiles/spinbot --port 60610 --zmq-port 60615 --api-key epichemdevkey   # another terminal
```

The backend must send the same key: `EPICHEM_QSERVER_API_KEY=epichemdevkey`.

## Adding an ophyd device

### A new instance of an existing type

Add an entry under `devices:` in the profile's `station.yaml`:

```yaml
devices:
  hotplate3:
    type: hotplate                       # arm | pipette | hotplate | spincoater
    driver: epichem_pod.drivers.sim:SimHotplate      # module:Class
    args: {ip: 192.168.10.22, port: 4003, hotplate_number: 3, T_max: 300}
    options: {number: 3, tolerance_c: 2, timeout_s: 1800, poll_s: 5}
```

Restart the pod. `hotplate3` is now in `devices_allowed`, in every
hotplate parameter's dropdown, and registrable in EPIChem.

### Connecting a real driver

With `expose()` there's nothing to connect — the driver *is* the device.
The rest of this section is for the hand-written wrappers the spinbot
profile uses, where plans address a fixed method surface.

A wrapper only calls methods; it never cares what's behind them. To drive a
real instrument, point `driver:` at a class with the same methods and give
it the real connection `args`:

```yaml
  arm:
    type: arm
    driver: mylab_drivers.dobot_driver:DobotM1     # importable in the pod
    args: {ip: 192.168.10.20, speed_ratio: 50, acceleration_ratio: 50,
           robot_safe_height: 180, gripper_IO_pins: [22, 21]}
    connect: true
```

What each wrapper calls on its driver:

| Type | Driver methods used |
|---|---|
| `arm` | `jump(x, y, z, r)`, `move_linear(x, y, z, r)`, `jump_angle(j1, j2, j3, j4)`, `gripper(is_open=)`, `get_position() -> (x, y, z, r, ...)` |
| `pipette` | `initialize_dosing_drive()`, `initialize_z_drive()`, `set_deck_geometry_parameters(**)`, `pick_up_tip(tip_type_index=, deck_geometry_index=)`, `discard_tip(deck_geometry_index=)`, `move_z_drive(position=, speed=)`, `aspirate(aspiration_volume=<0.1 µL>, **)`, `dispense(dispensing_volume=<0.1 µL>, **)`, optional `request_tip_presence_status()` |
| `hotplate` | `set_temperature_setpoint(int)`, `start_heating()`, `stop_heating()`, `get_temperature()`, `set_stirring_speed_setpoint(int)`, `start_stirring()`, `stop_stirring()`, optional `get_stirring_speed()` |
| `spincoater` | `set_spinning_parameter(speed, acceleration)`, `start_spinning()`, `stop_spinning()`, `move_to_home_position()`, optional `get_speed()` |

If a driver's names differ, write a ten-line adapter class rather than
changing the wrapper. `pip install` the driver package into the pod's environment (or the
Dockerfile) so `module:Class` imports.

Drivers raise on failure — and that message is what EPIChem shows on the
failed run (`pipette_aspirate: PipetteError: 75 - No tip present`), because
plans move devices through `epichem_pod.devices.lab.do()`, which re-raises the
driver's own exception instead of a bare Status. A driver call blocks its
worker thread, not the RunEngine: pause/abort land between calls, never in
the middle of a physical move — hardware interlocks are the safety layer
(plan §12.2).

### A new instrument type

In `epichem_pod/devices/lab.py`: subclass `DriverDevice`, add state `Signal`s
(what readings record), one `action("...")` per driver call you want plans
to use, the small methods that do unit conversion, and a `refresh()` that
re-reads state. Register it in `DEVICE_TYPES`. Pattern:

```python
class Shaker(DriverDevice):
    rpm = Cpt(Signal, value=0.0, kind="hinted")
    shake = action("_shake")                       # yield from do(shaker.shake, (800, 60))

    def _shake(self, rpm, duration_s):
        self.driver.start(int(rpm))
        time.sleep(duration_s * self.time_scale)
        self.driver.stop()

    def refresh(self):
        self.rpm.put(float(self.driver.speed()))

DEVICE_TYPES["shaker"] = Shaker
```

A plain ophyd/ophyd-async device (e.g. an EPICS-backed `EpicsMotor`) needs
no wrapper at all — instantiate it in `00-devices.py`.

## Writing plans

EPIChem's palette and parameter forms are **generated** from what the
queueserver reports about each plan (plan §9.2), so the plan *is* the UI
spec:

- **Type-hint every parameter** (`float`, `int`, `bool`, `str`): it picks the
  input and drives validation.
- **Defaults** make a parameter optional (shown as a placeholder).
- **`parameter_annotation_decorator`** adds descriptions, `min`/`max`/`step`
  (validated before dispatch), and **device enums** — a parameter annotated
  with `"devices": {"Heaters": ["hotplate1", "hotplate2"]}` becomes a dropdown
  of exactly those devices.
- A **NumPy-style docstring** works too; the decorator wins where both say
  something.
- Parameters named `md` are reserved for run metadata and hidden.

```python
@parameter_annotation_decorator({
    "description": "Bring a heater to a temperature setpoint.",
    "parameters": {
        "heater": {"annotation": "Heaters", "devices": {"Heaters": ["hotplate1", "hotplate2"]},
                   "description": "Heater to drive."},
        "setpoint_c": {"description": "Target temperature in degC.", "min": 20, "max": 300, "step": 0.5},
    },
})
def heat(heater, setpoint_c: float, wait: bool = True):
    yield from do(heater if wait else heater.heat, setpoint_c)
```

### Two levels, two libraries

Put the single device actions in `epichem_pod/plans/<station>_low_level.py` and
the operations composed from them in `epichem_pod/plans/<station>.py`. The
queueserver reports each plan's module, and the designer groups by it —
*Spinbot* first, *Spinbot · low level* after. A high-level plan is just a
generator calling the low-level steps (`yield from pickup_tip(1, 5)`), so the
RunEngine can pause between any two moves and every move is on record.

Libraries that need the station's devices or teach points are built by a
`build(station)` factory whose plans close over them; the profile's
`10-plans.py` does `globals().update(<library>.build(station))`.

### Moves vs. measurements

Plans that only move (heat, aspirate, carry) needn't open a run. Plans that
measure should (`bp.count`, `bp.scan`, or `@bpp.run_decorator` +
`bps.trigger_and_read`, as `coat_sample` does): each queue item EPIChem sends
carries `meta.epichem` (procedure, version, run, sample, step), which lands
in the run's start document, and EPIChem records the run uids on its Run.

## Teach points

`station.yaml`'s `positions:` hold named points by group and slot, written
literally or as a grid:

```yaml
positions:
  safe_home_pos: [250, 0, 180, 0]              # x, y, z (mm), r (deg)
  hotplate:
    grid: {first: [300, -150, 55, 0], step: [0, 18, 0, 0], count: 8}
  pipette_rack_1:
    space: joint                               # j1, j2 (deg), j3 (mm), j4 (deg)
    grid: {first: [40, 30, 110, 0], row_step: [1.5, 0, 0, 0],
           col_step: [0, 1.5, 0, 0], rows: 8, cols: 12}
```

Plans read them with `station.point(group, slot)`; `arm_go_to` exposes them
directly. Long term these belong on the station's own record
(`GeometryDescriptor.internal_positions`) — see
[`project_plan/DIGITAL_TWIN.md`](project_plan/DIGITAL_TWIN.md).

## Operating notes

- **API key**: letters and digits only — bluesky-httpserver refuses to start
  with anything else. EPIChem sends it as `Authorization: ApiKey <key>`
  (`EPICHEM_QSERVER_API_KEY`); the pod accepts
  `QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY`.
- **One Redis, many pods**: each pod keeps its queue under
  `--redis-name-prefix qs_<profile>`.
- **The plan/device list regenerates on every start** from the profile
  (`existing_plans_and_devices.yaml`, never hand-edit it). Generating it
  *executes* the startup code; `EPICHEM_LISTING=1` is set while it does, so
  `00-devices.py` can skip things like homing the pipette. Drivers that
  connect in their constructor will connect during listing too.
- **Edit → restart**: compose bind-mounts `bluesky/`'s code and profiles;
  `docker compose restart station-spinbot` picks up a change, and the
  designer's palette follows.
- **Generated plans take positional or keyword arguments** — the queueserver
  may send either; they're bound to the driver method's signature.
- **A failed step stops the station's queue** (queueserver behaviour, which
  also puts the failed item back at the front of the queue). EPIChem marks
  the run failed, quarantines its sample, and removes the failed item and the
  run's remaining steps from the queue so they don't fire on the next start.
- **Permissions**: `user_group_permissions.yaml` decides what the HTTP
  server's user group may see and run — and so what the palette offers.
