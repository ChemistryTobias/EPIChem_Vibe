# EPIChem — Lab Orchestration Platform
## Detailed Project Plan & Implementation Brief

**Status:** specification draft, pre-implementation
**Working name:** EPIChem (alternatives on the table: Chemistration, muba-chem, Kimiya, NextChem, Ochem)
**Host institution:** MPI-FKF · collaboration with FHI IT and the SolBat Center
**License condition:** MUST be open source, end to end. This constrains several tool choices below — see §12.

---

## 0. How to use this document

You (the receiving model/developer) are being handed:

1. **This plan** — the authoritative specification of scope, architecture, data model, APIs, and UI behaviour.
2. **A resources section (§18)** into which the author appends design sketches, papers, notes and prior AI-generated summaries.
3. **An existing HTML prototype** (`EPIChem_Console__Standalone_.html`) — a React + JointJS single-file mock with five screens.

**Rules of engagement:**

- The prototype's **visual design is approved and should be preserved**: Max-Planck palette (`#006C66` green, `#00B1EA` blue, `#EF7C00` orange, `#29485D` slate, `#C6D325` lime, `#C0392B` error, `#A7A7A8`/`#777777` greys, `#EEEEEE` fill), Roboto + ui-monospace, 2px border radius, uppercase 9–11px letterspaced labels, dark left rail with `CONTROL` nav + `RUNTIME` status footer, 72px header with title/subtitle and outline buttons.
- The prototype's **functional model is wrong and must be replaced**. Specifically: the sample manager is hard-coded around a spin-coating cell; the workflow nodes are ad-hoc function names with no relation to any executable target; devices have no hierarchy, no network identity, no capability contracts; there is no queue, no scheduler, no provenance, and no reconciliation with a real backend. Treat the prototype as a **style guide and layout reference only**.
- Where this document and the appended resources conflict, **this document wins** unless the author has annotated otherwise.
- Do not silently expand scope. §3 (Non-Goals) is binding.

---

## 1. Problem statement

Self-driving-lab software today splits into two failure modes. Facility-grade control stacks (EPICS, Bluesky, Tango) are robust, scalable and battle-tested, but assume a beamline operator's mental model and offer nothing for lab topology, sample custody or chemistry semantics. Chemistry-domain orchestrators (HELAO, IvoryOS, ChemOS-2, NOMAD CAMELS, MADSci, AlabOS) are approachable but each reinvents device abstraction, scheduling and data capture, and none has become shared infrastructure.

The Canty & Abolhasani 2026 review (*Nat. Rev. Chem.*, `s41570-026-00847-2`, appended) names the gap precisely: the field lacks *readily deployable ontological + epistemic data-management systems* and *hardware described as rigorously as software*. Its five recommendations — hardware interoperability, data/metadata standards, benchmarking, safety by design, interrogable/interruptible human-SDL collaboration — are the acceptance criteria for this project, not background reading.

**EPIChem's thesis:** do not build another execution engine. Build the missing layer *above* Bluesky and *beside* the ELN — the layer that knows what the lab physically is, what each device can promise, where every sample is, and how an abstract chemical procedure becomes a validated executable plan. Delegate execution downward to Bluesky/Ophyd/EPICS and scientific record-keeping sideways to Chemotion/Kadi4Mat.

---

## 2. Goals

**G1 — Lab as a first-class model.** A declarative, versioned description of sites, labs, cells, benches, stations, devices, network identity and physical geometry, editable in an isometric visual editor and consumable by machines.

**G2 — Device onboarding in under an hour.** A new instrument reaches "visible, readable, safely commandable" through a documented path with sensible defaults, without touching orchestrator internals.

**G3 — Procedures that compile.** A drag-and-drop designer whose output is a validated, executable Bluesky artifact — not a pretty picture that a human then re-implements in Python.

**G4 — General sample management.** Substance/batch/container/sample/labware/position modelling that works for a vial of precursor, a wafer coupon, a 96-well plate, a powder in an Ar glovebox, and an electrode in a cell — with full lineage.

**G5 — Horizontal scale.** Throughput grows by adding workcells; capability grows by adding devices. No single-node bottleneck, no shared mutable global state.

**G6 — Provenance completeness.** Every run reconstructible: procedure version, device firmware/calibration state, sample lineage, environment, operator, and all raw data pointers.

**G7 — Interrogable and interruptible.** A human can inspect, pause, override, or take manual control at any point, and the system records that they did.

**G8 — Low entry barrier, high ceiling.** A single-cell lab should run from one `docker compose up` with defaults. A 40-instrument multi-room institute should be able to shard, federate and tune the same system.

---

## 3. Non-Goals (binding scope limits)

These are the questions "what should the program *not* do". Every one of these is a deliberate delegation. If an implementation begins to grow one of these, stop and escalate.

| EPIChem does NOT | Delegated to | Rationale |
|---|---|---|
| Execute plans / drive the acquisition loop | **Bluesky RunEngine** via bluesky-queueserver | The RunEngine's pause/resume/suspend/rewind semantics, document model and interrupt handling are years of hardened work. Reimplementing it is the single fastest way to kill this project. |
| Talk to hardware registers/serial protocols | **EPICS IOCs**, ophyd/ophyd-async, FastCS, Tango | Device-level I/O, timing and reconnection belong in the control system. |
| Define device classes in its own DSL | **ophyd / ophyd-async `Device`** trees | Devices are Python objects with bluesky protocols. EPIChem stores *descriptors and metadata about* them, never a parallel driver model. |
| Serve as the ELN / scientific record of authority | **Chemotion ELN**, **Kadi4Mat** | EPIChem holds the *operational* record and links to the scientific one by PID. |
| Store raw scientific data | **Tiled / databroker + object store** | EPIChem stores pointers and metadata, never blobs. |
| Manage IP addresses, racks, cable plant | **NetBox** (IPAM/DCIM) | Already solved, already run by institutional IT. EPIChem syncs from it. See §6.4. |
| Motion planning, SLAM, collision avoidance | **ROS 2** on the robot side, behind an EPICS/REST façade | Perceive→plan→act is not this system's job. |
| Real-time safety interlocks | Hardware interlocks, PLC/relay logic, hard-wired E-stop | Software safety in EPIChem is *advisory and preventative*, never the last line of defence. Say this explicitly in the docs. |
| Bayesian optimisation / active learning | Plug-in "virtual instrument" services (Ax, BoTorch, Honegumi, Atlas) | EPIChem exposes an API for an optimiser to propose and to read outcomes. It does not own the algorithm. |
| Replace Python plans with a visual-only language | — | The designer *generates* Python/queue items. Power users must always be able to drop to Python, and hand-written plans must be first-class in the designer's palette. |
| Windows-first support | — | Linux-only for backend/IOC hosts; the frontend is a browser and therefore OS-agnostic. |

**The one-sentence boundary:** *EPIChem decides **what** should happen, **where**, **to which sample**, and **whether it is allowed**; Bluesky decides **how** it happens and EPICS decides **when the wire wiggles**.*

---

## 4. Layered architecture

```
L5  Clients          Web UI (React) · CLI · Python SDK · LLM assistant · optimiser plug-ins
                     ▲ HTTPS/OpenAPI · WebSocket · MQTT
─────────────────────┼──────────────────────────────────────────────────────────────────
L4  Control plane    API gateway · Lab Registry · Sample Service · Procedure Service
    (stateless,      Compiler · Validator · Scheduler · Event Bridge · Provenance Service
     k8s, scale-out) Postgres (registry/samples/provenance) · Redis · MQTT broker · Tiled
─────────────────────┼──────────────────────────────────────────────────────────────────
L3  Execution        bluesky-queueserver (RE Manager + Worker) — ONE PER WORKCELL
    (per workcell)   bluesky-httpserver (auth façade) · RunEngine · document subscribers
─────────────────────┼──────────────────────────────────────────────────────────────────
L2  Abstraction      ophyd / ophyd-async Device trees · bluesky.protocols
                     backends: ca:// · pva:// · Tango · FastCS · sim/mock
─────────────────────┼──────────────────────────────────────────────────────────────────
L1  Control system   EPICS IOCs (one per instrument or instrument group)
                     adapters: pythonSoftIOC · FastCS · SiLA2 bridge · OPC UA/LADS bridge
─────────────────────┼──────────────────────────────────────────────────────────────────
L0  Hardware         Instruments, robots, sensors — Ethernet-attached (see §6.2)
```

**Key architectural commitments:**

- **The workcell is the unit of scaling and the unit of failure.** One workcell = one RE Manager + one RE Worker + its IOC set + its Redis namespace. Cells do not share a RunEngine. A cell going down must not stop other cells.
- **The control plane is stateless.** Every L4 service can be killed and rescheduled. All state is in Postgres, Redis, the MQTT broker's retained messages, or Tiled.
- **Configuration is declarative and git-backed.** The lab description, device descriptors, capability contracts and procedure definitions live in a git repository. A reconciler compares desired state to observed state and reports drift — deliberately modelled on the Kubernetes control loop. Do *not* build a mutable-in-the-database-only config; the author explicitly wants k8s-style declarative reconciliation and it is the right call for reproducibility.
- **Two transports, two purposes.** HTTP for request/response, CRUD, and anything transactional. MQTT for telemetry, state broadcast and event fan-out. **MQTT is never the command path for motion or safety-relevant actuation** — those go through the control system where delivery semantics and interlocks live. (An MQTT `cmd/` tree exists for coarse orchestration verbs only; see §8.2.)

---

## 5. Canonical data model

All identifiers are **UUIDv7** (time-ordered, index-friendly) plus a short human-readable code (`SMP-2026-0041`, `DEV-HP-002`). External PIDs (Handle, DOI, Chemotion/Kadi record IDs) are stored as typed foreign identifiers, never as the primary key.

### 5.1 Topology

```
Region ─ Site ─ Building ─ Lab(room) ─ Zone ─ Workcell ─ Bench/Rack ─ Station ─ Device ─ Signal
```

| Entity | Meaning | Key fields |
|---|---|---|
| `Site` | Institute/campus | name, address, timezone |
| `Lab` | Physical room | room number, environment class (ambient/glovebox/fume hood/cleanroom), access control group |
| `Zone` | Sub-area with shared conditions | atmosphere (air/N₂/Ar), pressure, temperature class, hazard class |
| `Workcell` | Scheduling & execution unit | queueserver endpoint, redis namespace, state, owning group |
| `Bench` | Physical support surface / rack | isometric grid extent, height |
| `Station` | Addressable functional position | kind, grid (col,row), stack height, capacity, accepted labware types |
| `Device` | A controllable instrument | see §6 |
| `Signal` | A readable/settable channel | PV/attribute, dtype, units, limits, precision, kind (primary/config/normal/omitted) |

`Station` and `Device` are **decoupled on purpose**: a storage rack is a station with no device; a robot arm is a device that services many stations; a multi-position hotplate is one device with several stations. The prototype conflates them (`STATIONS[].deviceId`) — fix this with a proper many-to-many `station_device_binding` carrying a role (`owns`, `services`, `observes`).

### 5.2 Materials & samples (see §7 for full treatment)

```
Substance ─< Batch ─< Sample >─ Container >─ Slot >─ Station
                        │
                        └─< DerivationEdge >─ Sample   (lineage DAG)
```

### 5.3 Procedures & runs

```
Procedure ─< ProcedureVersion ─< StepNode >─ ActionType ─ (ontology IRI)
                    │
                    └─ compiles to ─> PlanArtifact ─> QueueItem[] ─> Run ─< Document
```

`Procedure` is the named, versioned, immutable-once-published entity. `Run` is one execution against one workcell with one parameter binding and one sample set. **Never mutate a published ProcedureVersion** — a run must be reconstructible forever.

---

## 6. Device model, registry and onboarding

### 6.1 Device hierarchy and descriptor

Devices form a **containment tree** mirroring the ophyd `Device`→child-`Device`→`Signal` structure, not a flat list:

```
liquid_handler_01                       (Device, class: LiquidHandler)
├── arm                                 (sub-Device, class: CartesianStage)
│   ├── x, y, z                         (Signals: Movable, Locatable)
├── channel_1                           (sub-Device, class: PipetteChannel)
│   ├── volume, tip_present, pressure   (Signals)
└── tip_rack_sensor                     (Signal: Readable)
```

Each node in the tree carries a **Device Descriptor** — the single YAML document that makes a device known to EPIChem. This is the artifact a developer writes to onboard hardware, and it is the answer to "one device description and local metadata".

```yaml
# devices/hotplate_h1.yaml
apiVersion: epichem.dev/v1
kind: Device
metadata:
  id: 0198f2a1-...-7b3c            # UUIDv7, generated on first registration
  code: DEV-HP-001
  name: Hotplate H1
  labels: {vendor: IKA, model: RCT-digital-5, owner: solbat}
spec:
  class: epichem.classes.HeaterStirrer        # capability class, see 6.3
  parent: null                                 # containment tree
  ophyd:
    import: mpifkf_devices.ika:RCTDigital      # importable ophyd/ophyd-async class
    args: {prefix: "MPIFKF:HP1:"}
  transport:
    protocol: epics-ca                         # epics-ca | epics-pva | tango | rest | sila2 | opcua | sim
    uri: "ca://MPIFKF:HP1:"
    ioc_host: ioc-bench-a.lab3.mpi-fkf.mpg.de
  network:                                     # synced from / reconciled with NetBox
    netbox_device_id: 412
    primary_ip: 10.42.13.21/24
    mac: "00:1b:44:11:3a:b7"
    vlan: lab3-instruments
  location:
    lab: LAB-3
    zone: fumehood-2
    workcell: cell-a
    bench: bench-a2
    station: hp1
    pose: {x_mm: 1420, y_mm: 300, z_mm: 900, yaw_deg: 0}
  capabilities:                                # what this device promises — see 6.3
    - heat
    - stir
    - read_temperature
  envelope:
    temperature_c: {min: 20, max: 300, resolution: 0.1, settling_s: 90}
    stir_rpm: {min: 0, max: 1500}
  safety:
    flags: [hot_surface]
    interlocks: [fumehood_sash_closed]
    max_unattended_minutes: 240
  operational:
    mode: read_write                           # read_only | read_write | maintenance | disabled
    calibration: {last: 2026-05-14, due: 2026-11-14, certificate: kadi:record/8821}
```

**Rules:**
- Descriptors are files in git. The registry ingests them; the registry is a cache and query index, not the source of truth.
- `spec.ophyd.import` is what the queueserver startup code uses to instantiate the device. **The descriptor and the queueserver startup namespace must be generated from the same source** — otherwise they drift and the designer will offer devices that don't exist. Generate the startup file from the descriptor set at deploy time.
- Every device must be resolvable by `plans_allowed`/`devices_allowed` introspection (§9.2) or it is not usable in the designer. Make this a CI check.

### 6.2 Ethernet-first policy

**Mandate:** every device is reachable at an IP address, either directly or via the IOC host that fronts it. This is what makes the fleet manageable, discoverable and monitorable with standard infrastructure tooling.

Onboarding paths, in order of preference:

1. **Native Ethernet + EPICS-capable** → write/obtain an IOC, done.
2. **Native Ethernet, vendor protocol (SCPI/HTTP/Modbus-TCP/SiLA2/OPC UA)** → thin IOC using **pythonSoftIOC** or **FastCS**; or a protocol bridge service for SiLA2 / OPC UA (incl. the LADS companion spec, which is the emerging lab-device profile for OPC UA).
3. **Serial/USB/GPIB only** → attach to an edge IOC host (Raspberry Pi 5 / industrial mini-PC / Ethernet terminal server). The *edge host* is the network object; the device becomes a child of it.
4. **Vendor-locked Windows-only SDK** → isolate on a dedicated Windows box exposing a minimal REST/SiLA2 shim; front it with a bridge IOC. Flag it in the descriptor as `transport.quality: degraded` so its limitations surface in the UI. Do not let this pattern spread.
5. **Not automatable at all** → still register it, with `capabilities: [manual]`. Manual steps are first-class procedure nodes that block on human confirmation. This is essential for adoption: half of a real lab is not automated, and a system that can't represent that is a system nobody uses.

**Network conventions:** dedicated instrument VLAN per lab; static leases or DHCP reservations recorded in NetBox; DNS name per IOC host (`ioc-<bench>.<lab>.<site>`); NTP/PTP time sync mandatory (timestamps are provenance); mDNS/DHCP-fingerprint sweep for *discovery assistance only* — never auto-register a device without human confirmation.

### 6.3 Capability classes and behavioural contracts

A **capability class** is the interface a device promises, decoupled from its vendor. This is the "harmonized nomenclature" the Canty/Abolhasani review calls for, and the "contracts" from the author's notes.

```yaml
# classes/heater_stirrer.yaml
apiVersion: epichem.dev/v1
kind: CapabilityClass
metadata: {name: HeaterStirrer, iri: "http://purl.obolibrary.org/obo/CHMO_0002492"}
spec:
  extends: [Readable, Configurable]
  actions:
    heat:
      plan: mpifkf_plans.thermal:set_temperature       # the bluesky plan implementing it
      params:
        setpoint_c: {type: float, required: true, unit: degC, from_envelope: temperature_c}
        wait_until_stable: {type: bool, default: false}
      contract:
        - "MUST reject setpoints outside envelope.temperature_c"       # compile-time
        - "MUST report actual temperature at >= 1 Hz while heating"     # runtime
        - "SHALL NOT exceed envelope.temperature_c under any parameter binding"
        - "SHOULD reach setpoint within settling_s; exceeding raises a warning event"
      emits: [temperature_reached, temperature_timeout]
```

Contract keywords follow **RFC 2119** (MUST / MUST NOT / REQUIRED / SHALL / SHOULD / MAY). The validator maps them to diagnostic severities:

| Keyword | Compile-time (designer) | Runtime |
|---|---|---|
| MUST / MUST NOT / SHALL | **Error** — blocks submission | Abort run, raise incident |
| REQUIRED | **Error** — blocks submission | Abort run |
| SHOULD / SHOULD NOT | **Warning** — submission allowed with acknowledgement | Warning event, run continues, flagged in provenance |
| MAY | Info | Info |

Devices declare `capabilities: [heat, stir]` and the compiler resolves an abstract `Heat` step to *that device's* implementing plan. **This is the mechanism that makes procedures portable across labs** — the whole reproducibility argument depends on it, so build it early rather than bolting it on.

### 6.4 NetBox integration (IPAM/DCIM)

Do not build an IPAM. Map onto NetBox's model, which fits the lab domain almost perfectly:

| NetBox object | EPIChem meaning |
|---|---|
| Region → Site | Campus → Institute building |
| Location (nestable) | Lab room → zone |
| Rack / Rack Role | Bench, enclosure, glovebox, instrument rack |
| Manufacturer / Device Type | Vendor / instrument model (reusable template) |
| Device Role | Functional class (`liquid-handler`, `thermal`, `transport`, `analytical`, `ioc-host`) |
| Platform | Firmware / driver / IOC version |
| Device | The physical instrument or IOC host |
| Module Bay / Module / Inventory Item | Pump head, detector module, tip block, probe |
| Interface → IP Address → VLAN/Prefix | Network identity |
| Custom fields | `epichem_device_id`, `epichem_class`, `epichem_ioc_prefix`, `epichem_capabilities` |
| Webhooks | Push change notifications into EPIChem's event bridge |

**Integration mode:** NetBox is authoritative for network + physical asset facts; EPIChem is authoritative for capability, envelope, calibration and operational state. Sync is one-way (NetBox → EPIChem) on a schedule plus webhook, with a reconciliation report for conflicts.

**Decision required (ask FHI IT first):** if the institute already runs NetBox, use it. If not, weigh whether to run an instance or to implement the same schema internally with an optional NetBox sync plug-in. Running NetBox adds an operational dependency (Postgres, Redis, workers) that a two-person lab may not want — but the schema should be NetBox-shaped either way so the migration path stays open.

### 6.5 Modular device addition — the horizontal-scale story

Adding capability must never require touching the control plane. The path:

```
1. Write device descriptor YAML  ─────────────►  git commit
2. Write/obtain ophyd class + IOC ────────────►  git commit (same repo or a device repo)
3. CI: schema validation, class importability, envelope sanity, sim-mode contract tests
4. Deploy: IOC container to the cell's IOC host; startup namespace regenerated
5. Reconciler detects new descriptor → registers device → publishes `device.registered`
6. queueserver `permissions_reload` → device appears in `devices_allowed`
7. Designer palette refreshes → new actions available; UI shows the device on the layout
```

Time budget for step 1–2 with an existing driver: **< 1 hour**. Make this a tracked metric, not an aspiration.

**Scaling dimensions:**

| Dimension | Mechanism |
|---|---|
| More devices in a cell | Add IOCs; a cell's queueserver worker namespace grows. Bounded by the cell's serial execution. |
| More throughput | Add workcells. Each has its own RE Manager + Redis namespace. The scheduler shards across them. |
| More users / UI load | Scale the stateless gateway + read replicas. UI reads go to the registry/event cache, never to a queueserver directly. |
| More labs / sites | Federate: each site runs its own control plane; a thin federation service exchanges capability catalogues and cross-lab requests. **Defer to phase 6** — do not let federation complicate v1, but do not design anything that forbids it (no global auto-increment IDs, no assumption of one lab per deployment). |
| More telemetry | MQTT 5 shared subscriptions; broker cluster (EMQX or NanoMQ); downsampling at the edge. |

---

## 7. Sample management (generalized)

This is the part the prototype gets most wrong. `{id, vialNo, composition, volume, conc, rack, pos, status}` is a spin-coating cell's private notebook, not a data model. Replace it wholesale.

### 7.1 Entities

| Entity | Definition | Notes |
|---|---|---|
| `Substance` | A chemical identity | InChI/InChIKey, SMILES, CAS, formula, hazard codes (GHS), links to PubChem/Chemotion molecule |
| `Batch` | A procured or produced lot of a substance | supplier, lot number, purity, CoA document, opened date, expiry, storage class |
| `Sample` | An identified quantity of matter with a lifecycle | UUID, code, current `Container`, current amount + unit, state (solid/liquid/gas/film/dispersion), composition (see 7.2), lineage |
| `Container` | A physical vessel | type (vial 4 mL, well A1, wafer coupon, crucible, cuvette, cell), material, tare, closure, atmosphere requirement |
| `Labware` | A carrier holding containers in a fixed geometry | type (24-vial rack, SBS 96-well plate, tip rack, wafer cassette), `SlotLayout` (rows/cols/naming scheme/pitch/depth) |
| `Slot` | An addressable position in labware | address (`A3`, `12`, `r2c4`), occupancy, allowed container types |
| `Consumable` | Non-sample material consumed by actions | tips, filters, cartridges, gas, solvent from a bulk reservoir. Tracked so the scheduler can block on stock-out. |
| `Location` | Where something is, hierarchically | `site/lab/zone/workcell/bench/station/labware/slot` + optional cartesian pose |

**The generalization principle:** an action never says "vial 10 in rack 1". It says "the container currently holding `Sample<uuid>`" and the resolver produces the physical address at compile or dispatch time. This is what makes a procedure portable and what the author's `xyz|loc` note is reaching for.

### 7.2 Composition

Composition is a **structured list**, never a free-text string:

```json
"composition": [
  {"substance": "urn:inchikey:RQQRAHKHDFPBMC-UHFFFAOYSA-L", "role": "solute",  "amount": {"value": 0.8, "unit": "mol/L"}},
  {"substance": "urn:inchikey:ZMXDDKWLCZADIW-UHFFFAOYSA-N", "role": "solvent", "amount": {"value": 500, "unit": "uL"}}
]
```

Roles: `solute`, `solvent`, `reagent`, `catalyst`, `substrate`, `product`, `impurity`, `matrix`, `unknown`. Units via a single unit library (**pint** server-side); every quantity is `{value, unit}`, never a bare number, and never a string with the unit baked in.

### 7.3 Lifecycle and custody

State machine (generic, not process-specific):

```
Registered → Staged → Reserved → InProcess → Processed ─┬→ Characterized → Archived
                                     ↑        │         ├→ Consumed
                                     └────────┘         └→ Disposed
                              (multi-step loops)
Any state → Quarantined (on contract violation / contamination / failed QC)
```

Every state transition emits a `SampleEvent {sample, from, to, at, actor, run, station, reason}`. Custody transfers (robot picks up, human removes) are events. **A sample's location is never edited directly — it is derived from the event log.** This gives an audit trail for free and makes "where did SMP-0041 actually go" answerable.

### 7.4 Lineage

Samples form a **DAG** via typed `DerivationEdge`s: `split`, `aliquot`, `mix`, `dilute`, `react`, `coat`, `anneal`, `purify`, `mount`, `dissolve`. Each edge carries the `Run` and `StepNode` that produced it plus the parameter binding. Serialize to **PROV-O** (`prov:wasDerivedFrom`, `prov:wasGeneratedBy`, `prov:used`) for export. The UI must render this graph — it is one of the most useful things the system can show a chemist.

### 7.5 Identifiers and physical marking

- Internal: UUIDv7 + short code.
- Physical: **DataMatrix ECC200** on vials/coupons (survives small labels better than QR), Code128 or QR on labware. Encode the short code, not a URL — URLs rot.
- External PIDs on publication: Handle/DOI via Chemotion Repository or Kadi4Mat.
- Scanner support in the UI (USB HID scanners behave as keyboards; add a global scan-capture handler and a mobile camera fallback).

### 7.6 ELN federation

| System | Role | Interface |
|---|---|---|
| **Chemotion ELN** | Chemistry-native record: molecules, reactions, analyses. Best fit for synthesis semantics. | REST API (`/api/v1/...`) for samples/reactions/collections; Repository open APIs for RDF/BagIt harvesting of published records |
| **Kadi4Mat** | Materials-science RDM: records, collections, extras (typed metadata), workflows, links | HTTP API + **kadi-apy** Python client; records link natively (`Sample X belongs to Measurement Y`), which maps directly onto EPIChem lineage |
| **Interchange** | ELN File Format (RO-Crate–based) for portable export | Emit an RO-Crate per run/campaign |

**Pattern:** on run completion, EPIChem pushes a structured record (procedure version, parameters, sample lineage, device state, data pointers) to the configured ELN and stores the returned PID on the `Run`. Push is idempotent (keyed by run UUID) and retried. The ELN is never in the critical path of execution — if it's down, the run still happens and the push queues.

**Decision required:** which ELN is the institutional target, or both? This changes the metadata mapping work substantially. Ask before building either adapter.

---

## 8. External interfaces

### 8.1 HTTP API

FastAPI, **OpenAPI 3.1**, JSON, cursor pagination, `ETag`/`If-Match` optimistic concurrency, RFC 9457 problem details for errors, OIDC (Keycloak) bearer tokens, RBAC.

```
# Topology & devices
GET    /api/v1/sites | labs | zones | workcells | benches | stations
GET    /api/v1/devices?lab=&class=&capability=&state=
GET    /api/v1/devices/{id}                     # descriptor + live state + health
GET    /api/v1/devices/{id}/signals             # signal tree with values, units, limits
POST   /api/v1/devices/{id}/actions/{action}    # coarse ops: home, reset, calibrate — RBAC-gated
PATCH  /api/v1/devices/{id}/mode                # read_only | read_write | maintenance | disabled
GET    /api/v1/device-classes                   # capability classes + contracts
GET    /api/v1/layouts/{lab}                    # isometric layout document (§10)
PUT    /api/v1/layouts/{lab}

# Samples & materials
GET    /api/v1/substances | batches | containers | labware | consumables
POST   /api/v1/samples                          # register (single or bulk CSV/XLSX)
GET    /api/v1/samples/{id}                     # incl. current location, amount, composition
GET    /api/v1/samples/{id}/lineage?depth=      # DAG, PROV-O available via Accept header
GET    /api/v1/samples/{id}/events
POST   /api/v1/samples/{id}/transfer            # manual custody transfer

# Procedures
GET    /api/v1/procedures | /procedures/{id}/versions
POST   /api/v1/procedures/{id}/versions         # publish (immutable)
POST   /api/v1/procedures/{id}/validate         # returns diagnostics, no side effects
POST   /api/v1/procedures/{id}/compile          # returns PlanArtifact preview (§9)
GET    /api/v1/action-types                     # designer palette (from plans_allowed + classes)

# Execution
POST   /api/v1/runs                             # bind params + samples + cell → enqueue
GET    /api/v1/runs?state=&cell=&sample=
GET    /api/v1/runs/{uid}                       # status, progress, documents summary
POST   /api/v1/runs/{uid}/{pause|resume|stop|abort|halt}
GET    /api/v1/queues/{cell}                    # proxied queueserver state
POST   /api/v1/queues/{cell}/items/{reorder|remove}

# Data & provenance
GET    /api/v1/runs/{uid}/documents             # start/descriptor/event/stop (paged)
GET    /api/v1/runs/{uid}/data                  # Tiled URIs
POST   /api/v1/runs/{uid}/export                # RO-Crate / ELN push

# Streams
WS     /api/v1/stream?topics=                   # multiplexed live updates for the UI
```

### 8.2 MQTT

Broker: EMQX (clustered) or Mosquitto/NanoMQ for small deployments. **MQTT 5** required (shared subscriptions, request/response with `response-topic` + `correlation-data`, user properties, message expiry).

```
epichem/v1/{site}/{lab}/{cell}/device/{device_id}/state          retained  {mode,status,health,ts}
epichem/v1/{site}/{lab}/{cell}/device/{device_id}/signal/{name}            {value,unit,ts,severity}
epichem/v1/{site}/{lab}/{cell}/device/{device_id}/event                    {type,severity,detail}
epichem/v1/{site}/{lab}/{cell}/queue/state                       retained
epichem/v1/{site}/{lab}/{cell}/run/{run_uid}/document/{name}               bluesky documents
epichem/v1/{site}/{lab}/sample/{sample_uuid}/location            retained
epichem/v1/{site}/{lab}/scheduler/decision
epichem/v1/{site}/{lab}/{cell}/cmd/{device_id}/{verb}                      req/resp, RBAC-gated
epichem/v1/{site}/{lab}/{cell}/cmd/{device_id}/{verb}/resp
```

**Rules:** retained messages carry last-known state so a fresh UI renders instantly. Every payload carries `schema_version`, `ts` (RFC 3339, UTC), `source`, and a `trace_id` for OpenTelemetry correlation. Topic ACLs per group. Payloads are JSON by default; offer CBOR for high-rate signals. Consider **Sparkplug B** if the institute already has an OT/MQTT convention — otherwise the schema above is simpler and better suited.

**The "common MQTT endpoint" requirement from the notes** is satisfied by the `device/*/state` and `queue/state` retained trees: any orchestrator, dashboard or third-party consumer can subscribe and get a complete picture without an API key beyond MQTT credentials.

### 8.3 Python SDK & CLI

Thin generated client over the OpenAPI spec + convenience wrappers. `epichem run submit`, `epichem device list`, `epichem sample register --from samples.csv`, `epichem procedure validate proc.json`. The CLI must be able to do everything the UI can — this keeps the UI honest and makes CI possible.

---

## 9. Procedure designer → Bluesky (the core translation problem)

**Answer to "is there a way to transform a visual representation to Bluesky plans": yes, and the mechanism is already standardised.** Do not invent a parallel scheme.

### 9.1 The execution artifact

bluesky-queueserver accepts queue items as plain JSON dictionaries over 0MQ or, via bluesky-httpserver, over HTTP:

```json
{"item_type": "plan",
 "name": "set_temperature",
 "args": [],
 "kwargs": {"device": "hotplate_1", "setpoint_c": 90.0, "wait_until_stable": true},
 "meta": {"epichem": {"procedure_version": "...", "step_node": "n7",
                      "sample_uuids": ["..."], "operator": "..."}}}
```

Items are added with `queue_item_add` / `queue_item_add_batch`, executed by the RE Manager, and controlled with `queue_start`, `re_pause`, `re_resume`, `re_stop`, `re_abort`, `re_halt`. Device names in parameters are automatically resolved to objects in the worker namespace.

**Therefore: the designer's compile target is an ordered list of queue items plus (where control flow is needed) a generated composite plan.**

### 9.2 The palette comes from introspection

Call `plans_allowed` and `devices_allowed` on each workcell's RE Manager. The plan representations — built from `existing_plans_and_devices.yaml`, generated by `qserver-list-plans-devices` — contain everything a UI needs:

- plan description and per-parameter descriptions (from NumPy-style docstrings)
- parameter type annotations (native types, `typing` generics, and bluesky protocol types `Readable`/`Movable`/`Flyable` mapped to `__READABLE__`/`__MOVABLE__`/`__FLYABLE__`)
- default values → which parameters are required vs optional
- `min` / `max` / `step` for numeric parameters → spinboxes and range validation
- custom enums built from device/plan name lists → **dropdowns pre-filtered to what this user is allowed to use**, because the lists are filtered by user-group permissions before being returned

**This is the single highest-leverage integration in the project.** It means the node palette and every parameter form are *generated*, not hand-maintained, and they stay correct automatically when a plan changes. Build this before building any node UI.

Plan authors on the EPIChem side must therefore annotate plans properly — type hints in the header, NumPy docstrings, and `parameter_annotation_decorator` where enums/ranges/descriptions are needed. Make this a documented requirement and a CI lint.

### 9.3 Validation

Four tiers, all surfaced in the designer before submission:

1. **Schema/type** — client-side using the downloaded `plans_allowed` representation; server-side via `bluesky_queueserver.validate_plan()`. Catches type errors, missing required params, out-of-range numerics, disallowed device names.
2. **Capability contract** — does the bound device declare the capability, and does the parameter binding sit inside `envelope`? RFC 2119 severity mapping per §6.3.
3. **Graph/resource** — connected DAG, no orphan steps, no unclosed run boundary, every sample referenced is registered and available, no resource cycle (wait-for graph check), labware/consumable stock sufficient.
4. **Safety** — hazard flags on referenced substances (air-sensitive, pyrophoric, explosive, toxic, incompatible pairs), required zone atmosphere, unattended-operation limits, required PPE/interlock preconditions.

The prototype's `Validate` button becomes real here: it returns a diagnostics list keyed to node IDs, and the canvas highlights offending nodes.

### 9.4 Control flow — the honest limitation

**A queue-item list is linear.** It cannot express branches, loops, or result-dependent decisions. Anything the designer offers beyond a sequence must be handled one of three ways. State this clearly in the UI so users are not surprised.

| Construct | Mechanism |
|---|---|
| Linear sequence | Direct → `queue_item_add_batch` |
| Fixed repeat (`repeat N`) | Unroll at compile time, or emit a parameterised composite plan |
| Conditional / while / result-dependent branch | **Codegen**: compile the subgraph into a Python generator function using `bluesky.plan_stubs` (`bps.mv`, `bps.trigger_and_read`, `bps.abs_set`, `bps.wait`) and `bluesky.preprocessors` (`run_decorator`, `stage_decorator`), register it into the worker namespace via git + `permissions_reload`, and enqueue a single call to it |
| Cross-cell coordination / adaptive campaign | **Orchestrator-level**: EPIChem submits the next procedure after evaluating the previous run's documents. This is the closed-loop / optimiser path and lives above the queue, not inside a plan |
| Human-in-the-loop step | A `ManualStep` plan that publishes a task, blocks on acknowledgement (with timeout policy), and records who acknowledged |

**Recommended design: an intermediate representation.** The designer's canvas serialises to an **EPIChem Procedure IR** (JSON, JSON-Schema'd, versioned) which is the stored, diffable, git-friendly artifact. Two compiler backends consume it:

- `backend: qserver` → queue item list (fast path, covers most procedures)
- `backend: codegen` → Python plan module (control flow, reviewable, testable, and — importantly — the escape hatch that lets a power user read exactly what the GUI produced)

Round-tripping generated Python *back* into the graph is explicitly **out of scope**; the IR is the source, Python is an output. Attempting bidirectional sync here is a classic time sink.

### 9.5 Relationship to xDL / ontologies

The IR node types should carry an ontology IRI and, where an equivalent exists, an **xDL** or **Autoprotocol** mapping. Do not invent a new synthesis language:

- **xDL** for synthesis semantics where it fits (`Add`, `HeatChill`, `Stir`, `Filter`, `Evaporate`) — it has an existing community and a Chemputer-backed compiler tradition.
- **NFDI4Chem** terminology (via the TS4NFDI terminology service) and **CHMO** / **AFO (Allotrope)** / **EMMO-CHAMEO** for process and instrument terms.
- **PROV-O** for provenance, **schema.org**/Bioschemas for discovery metadata.

Mint new terms only where nothing exists, and route them through a term registry with a proposed-term workflow. The author's idea of community voting on term meaning with an ORCID/ROR-checked identity is interesting but **out of scope for v1** — build the term registry so it *could* support that later; do not build the governance system now.

### 9.6 Nomenclature discipline

Per the Canty/Abolhasani recommendation: fix verbs once, globally. `Inject` = add liquid via pump. `Dispense` = add solid via hopper. `Pipette` = add liquid via displacement channel. `Transfer` = move a container between locations. `Transport` = move labware. Publish this as a controlled vocabulary in the repo and validate action names against it. Inconsistent verbs are the single most common source of confusion when two labs try to share a procedure.

---

## 10. Lab layout manager (isometric)

### 10.1 Purpose

An isometric, game-like view of the physical lab that is simultaneously (a) a legible operational dashboard, (b) the editor for the topology model, and (c) the click-through to any device. The reference feel is a rack-management tool or Factorio — dense, readable, spatially truthful.

### 10.2 JointJS — and a licensing decision you must make now

The prototype already uses JointJS (`joint.dia.Graph`, `joint.dia.Paper`, custom `joint.shapes.epi.*`). Keep it. **But:** `@joint/core` is MPL-2.0 open source, while **Stencil, Inspector, Halo, Toolbar, Navigator, Selection, and most of the `clientIO/joint-demos` applications — including the isometric-diagram demo — are JointJS+ commercial** and require a paid token to install from `npm.jointjs.com`.

Given the project's "MUST BE OPEN SOURCE" condition, this is a real conflict, and it should be resolved before implementation rather than discovered at release:

| Option | Consequence |
|---|---|
| Buy JointJS+ | Fastest path, best components. But the released project cannot be freely redistributed with those components, which undermines the open-source goal. Acceptable only if the UI's diagramming layer is pluggable. |
| Build on `@joint/core` only | MPL-2.0-clean. You implement stencil/palette, inspector and selection yourself as React components — which you largely need anyway for form generation from plan annotations (§9.2). Recommended. |
| Alternative libraries | React Flow (MIT) for the procedure DAG; plain SVG/PixiJS for the isometric view. Loses JointJS's routing and port machinery. |

**Recommendation: `@joint/core` for both canvases, with React-side palette/inspector.** Use the joint-demos as *technique references*, not as code to copy: `isometric-diagram` (projection + depth sorting), `flowchart` and `bpmn-editor` (DAG editing), `dynamic-stencil` and `drop-stencil-element-as-shape-icon` (drag-drop palette), `element-connect-tool` / `hover-element-connect-tool` (link creation UX), `inspector-for-selection` and `inspector-dynamic-element-type` (property panels), `hierarchical-diagrams` / `container-layout` / `container-collapse-expand` (device trees and nesting), `elk-layout` and `directed-graph-layout` (auto-layout), `dynamic-status-icons` and `element-tags-and-badges` (live status overlays), `libavoid-standalone-link-routing` (orthogonal routing), `collapsible-minimap` (navigation on large labs), `data-pipeline` (the closest existing analogue to a procedure canvas).

### 10.3 Projection and geometry

Keep the prototype's approach — it is correct — and formalise it:

```
screen.x = origin.x + (col - row) * (tileW / 2)
screen.y = origin.y + (col + row) * (tileH / 2) - stackHeight
depth    = col + row            // painter's algorithm: render ascending
```

Prototype values (`W2=50, H2=29, TW=100, TH=58`, per-kind default heights) are a good starting scale; make them configurable per lab. Grid dimensions come from the lab model, not constants.

**Data binding:** the canvas is a *view over the topology model*. A tile is a `Station`; its badge state comes from the bound `Device`'s live MQTT state; moving a tile issues a `PATCH /stations/{id}` with grid coords; adding a tile opens a station-creation form. Never let the canvas hold authoritative state — reload it from the model and it must render identically.

**Layers (toggleable):** benches/furniture · stations · devices · live status · sample positions (heat-map of occupancy) · transport routes (robot reachability) · hazard zones · network (colour by VLAN/IOC host) · utilisation heat-map.

**Editor affordances:** grid snap, multi-select, align/distribute, copy-paste of station groups, undo/redo (command pattern, server-side conflict detection via ETag), zone drawing, a station-type palette, minimap for large rooms, and a read-only "operations" mode that is the default for non-admins.

### 10.4 Procedure canvas (separate paper, shared design language)

Orthogonal DAG, not isometric. Nodes have two port families:

- **flow ports** (`in`/`out`) — execution ordering
- **material ports** (`sample-in`/`sample-out`, `consumable-in`) — what enters and leaves the step

The material ports are what make lineage automatic: an edge from `n3.sample-out` to `n7.sample-in` *is* a `DerivationEdge` at runtime. This is the generalization the author is asking for, and it removes the need to name vials in step parameters.

Node visual: kind colour bar (reuse `KINDS` from the prototype), action name, bound device, a compact parameter summary, and a status badge (valid / warning / error / running / done / failed). Inspector panel on the right, auto-generated from the plan annotation schema.

---

## 11. Scheduler

### 11.1 Scope

**In scope:** deciding which procedure runs on which workcell and when; reserving devices, stations, labware and consumables; preventing deadlock; estimating durations; reordering independent work; priority handling.

**Out of scope:** step-by-step execution within a run (RunEngine), motion timing (control system), and real-time guarantees (there are none — this is a best-effort scheduler over a soft-real-time system, and the docs must say so).

### 11.2 Mechanism

- **Resource model:** each step declares required resources with a hold interval (exclusive or shared). Reservation is two-phase: reserve-all-or-none before dispatch. This is the AlabOS pattern and it works.
- **Deadlock avoidance:** maintain a wait-for graph; refuse any allocation that would create a cycle (Banker's-algorithm-style safety check). Never rely on detection-plus-rollback in a lab — rolling back a physical action is not free.
- **Out-of-order execution:** independent subgraphs and independent runs may be dispatched in any order that respects reservations. Model it as a constraint problem; start with a greedy list scheduler with priority + earliest-deadline, and only reach for CP-SAT (OR-Tools) if measurements show it's worth it. **Do not start with a solver** — a greedy scheduler with good reservation semantics beats an optimal scheduler that nobody can debug.
- **Duration learning:** every step's actual duration is recorded (start/end timestamps are already in the document stream). Maintain a per-(device, action, parameter-bucket) distribution; use the median for planning and the p90 for timeout policy. This is the author's "learn how long steps take" idea and it is cheap to implement once timestamps are captured.
- **Priority:** a small ordinal scale (`background < normal < high < urgent`) plus a preemption policy that is *explicit and conservative* — preemption of a running physical step is usually impossible; preemption applies to queue position only.
- **Blocking actions:** any step or device can be blocked/unblocked with one click; blocked resources are removed from the reservation pool and pending runs re-planned.

### 11.3 A caution on "AI-generated experiments get priority"

The requirement from the earlier concept — *"AI-generated high-confidence experiments receive priority access"* — should not be implemented as stated. Model confidence is not a scheduling authority, it is an input. Implement it as: an optimiser service may attach a **suggested priority + rationale** to a proposed run; a policy (configurable, per-group) decides whether that maps to an actual queue priority, and the decision is logged. Otherwise a miscalibrated model quietly starves human work, and nobody can explain why.

---

## 12. Cross-cutting concerns

### 12.1 Access control and modes

- **OIDC** (Keycloak) for identity; institutional SSO where available. ORCID as a linked identifier for provenance, not for authentication.
- **Roles:** `viewer` (read-only), `operator` (run published procedures, control samples), `author` (create/publish procedures), `engineer` (device descriptors, layout, capability classes), `admin` (permissions, policies).
- **Admin mode vs user mode** (from the notes): admin mode edits structure — topology, descriptors, contracts, procedure definitions. User mode executes released procedures with bounded parameters. The boundary is enforced server-side, and it must map onto queueserver's own `user_group_permissions.yaml`, which already filters allowed plans and devices by group — align the two rather than layering an independent permission system on top.
- **Read-only device mode** is a first-class device state, surfaced in the UI and enforced at dispatch.

### 12.2 Safety

- Hazard flags on substances (GHS), propagated to samples and to any step touching them: air-sensitive, pyrophoric, explosive, toxic, corrosive, cryogenic, high-pressure, incompatible-pair.
- Zone requirements: a step requiring inert atmosphere cannot bind to an ambient zone. Compile-time error.
- Unattended-operation policy per device and per procedure (max duration, required watchdog, out-of-hours restrictions).
- Watchdogs: signal staleness, envelope excursion, expected-progress timeouts — each with a declared action (warn / pause / abort / safe-state).
- **Explicitly document what EPIChem cannot protect against.** Software cannot be the interlock. Hard-wired E-stop, sash sensors, thermal cutouts and gas detection are hardware responsibilities. Overclaiming here is dangerous.
- Simulation/dry-run mode: compile and dispatch against `sim` backends with no hardware effect. Required before first execution of any new procedure version — make it the default and require an explicit override to skip.

### 12.3 Observability

OpenTelemetry throughout: traces spanning UI action → API → scheduler → queueserver → document; metrics (queue depth, cell utilisation, step durations, contract violations, device uptime); structured logs correlated by `trace_id`. MADSci already does this and it is the right call — a distributed lab is undebuggable without it.

### 12.4 Data and provenance

- Bluesky documents (`start`/`descriptor`/`event`/`resource`/`datum`/`stop`) are the canonical event record. Inject EPIChem context into `start.md`: procedure version, IR node IDs, sample UUIDs, operator, device descriptor hashes, calibration state, ontology IRIs.
- **Tiled** for data access; object store (S3/MinIO) or institutional filesystem for blobs.
- Provenance export: RO-Crate (ELN File Format) + PROV-O RDF.
- **Timestamp everything at every read/write** (the author's note) — NTP/PTP-synced, RFC 3339 UTC with explicit precision. This feeds duration learning, deadlock diagnosis and reproducibility.

### 12.5 Testing strategy

Non-negotiable given the failure modes of lab software:

| Level | Approach |
|---|---|
| Device | `ophyd_async` mock backends + `pythonSoftIOC` simulated IOCs; **contract tests per capability class** run against both sim and (in CI-lab) real hardware |
| Compiler | Golden-file tests: IR → queue items / generated Python. Any change to output is a reviewed diff. |
| Validator | Property-based tests (Hypothesis) generating random IRs; invariant: never accept a binding violating an envelope |
| Scheduler | Simulation harness with synthetic labs; invariants: no deadlock, no double-booking, no starvation beyond a bound |
| API | Schemathesis against the OpenAPI spec |
| E2E | Dockerised virtual lab (sim IOCs + queueserver + full stack) running a reference procedure on every commit |
| UI | Component tests + Playwright against the virtual lab |

The **virtual lab** is not a testing nicety, it is a product feature: it is how a new lab evaluates EPIChem before buying hardware, how students learn, and how the LLM assistant is safely exercised.

### 12.6 Deployment

- Containers for everything; Helm chart for k8s; a `docker compose` single-node profile with working defaults as the on-ramp (the "IvoryOS-simple" tier the author wants).
- IOCs deployed as containers to IOC hosts, or built via NFS cross-compile for embedded targets.
- Git-backed configuration with a reconciler; PR review for descriptor and contract changes.
- Backup/restore procedure for Postgres + object store, tested, documented.

### 12.7 LLM assistant

Scope it narrowly and honestly:

- **Retrieval over the lab's own state**: what devices exist, what actions they support, what a parameter means, what happened in run X. This is genuinely useful and low-risk.
- **Natural language → draft procedure IR**, presented as a *proposal in the designer* that must pass the full validator and be accepted by a human. Never auto-submits.
- **Diagnostic assistance**: correlate a failure with recent changes, similar past failures, device history.
- Local-first (Ollama/vLLM) so lab data doesn't leave the institute; pluggable backend.
- **Never** in the execution path, never granted permissions beyond the invoking user's, all suggestions logged with provenance.

---

## 13. UI specification (replacing the prototype's functionality)

Keep the shell: dark left rail (`CONTROL` nav + `RUNTIME` status), 72px header with title/subtitle and right-aligned outline actions, white content area. Replace the screens.

**Nav: `OVERVIEW · LAB LAYOUT · DEVICES · SAMPLES · PROCEDURES · QUEUE · RUNS · DATA · ADMIN`**

| Screen | Content | Replaces / fixes |
|---|---|---|
| **Overview** | Fleet health, cells and their queue depth, active runs, alerts, recent contract violations, utilisation sparklines | New |
| **Lab Layout** | Isometric canvas (§10), layer toggles, hierarchy tree (Site→Lab→Zone→Cell→Bench→Station), inspector with device metadata incl. IP/MAC/VLAN/IOC host/location/calibration, edit vs operate modes | Prototype's Lab Layout Designer — currently a decorative grid with no model behind it |
| **Devices** | Hierarchical device tree (not a flat list), per-device signal panel with live values/units/limits, health, mode switch, capability + contract view, envelope, history, manual action buttons (RBAC-gated), network tab | Prototype's Device Control — currently flat, no hierarchy, no network identity, no contracts |
| **Samples** | Substances/batches/containers/labware tabs, sample table with faceted filters, bulk register from CSV/XLSX, **lineage DAG viewer**, location history timeline, barcode scan, labware layout viewer (plate/rack maps) | Prototype's Sample Management — currently a spin-coating-specific flat table. Full rewrite. |
| **Procedures** | Library with versions and diffs, DAG designer (§10.4), auto-generated inspector, Validate → diagnostics keyed to nodes, **Compile preview showing the actual queue items / generated Python**, dry-run, publish | Prototype's Workflow Designer — nodes currently map to nothing executable |
| **Queue** | Per-cell queues, drag-reorder, priority, item detail, batch enqueue, pause/stop, scheduler decisions with rationale | New — the prototype has no queue concept |
| **Runs** | Live monitor: step Gantt against estimates, live plots from the document stream, log, sample positions, **intervene panel** (pause/resume/stop/abort/halt/manual override), post-run summary | Prototype's Run Monitor — currently cosmetic |
| **Data** | Run browser over Tiled, quick plots, export (RO-Crate/CSV/HDF5), ELN push status | New |
| **Admin** | Users/roles, capability classes and contracts, ontology term registry, git config status and drift report, audit log, NetBox sync status | New |

**UI principles:** every live value shows its timestamp and staleness; every action that touches hardware shows what it will do before it does it; every error message names the node/device/contract that failed; nothing that can be derived is editable; keyboard-navigable throughout; responsive to tablet (bench use) with the isometric canvas gracefully degrading to a list.

---

## 14. Milestones

Each milestone ends with a demo against the virtual lab and a written decision record.

| # | Milestone | Deliverables | Exit criteria |
|---|---|---|---|
| **M0** | Decisions & spec (4 wks) | JointJS licensing decision; NetBox vs internal registry; ELN target; IR JSON-Schema v0; capability class schema; nomenclature vocabulary v0; ADR log started | All §17 open questions closed or explicitly deferred with an owner |
| **M1** | Topology & registry (6 wks) | Postgres schema; registry service; descriptor ingest + reconciler; OpenAPI v1 for topology; **isometric layout viewer (read-only)** | A real lab room is modelled in git and renders correctly |
| **M2** | Device plane (8 wks) | Two real devices behind IOCs + ophyd classes; queueserver per cell; introspection service (`plans_allowed`/`devices_allowed` → palette schema); MQTT state tree; Devices screen; layout editor | A device's live state is visible in the UI within 500 ms of change; a new device is onboarded end-to-end in under an hour and the time is measured |
| **M3** | Procedure designer, linear (10 wks) | IR + JSON-Schema; DAG canvas; auto-generated inspector; validator tiers 1–2; `qserver` compiler backend; compile preview; submit; Queue + Runs screens | A chemist builds a 15-step procedure in the GUI and it executes on hardware without anyone writing Python |
| **M4** | Samples & provenance (8 wks) | Full sample model; lineage DAG + viewer; material ports in the designer; provenance injection into `start.md`; Tiled wiring; RO-Crate export; first ELN adapter | Every run's outputs are traceable to inputs, device state and procedure version, with no manual bookkeeping |
| **M5** | Scheduler & scale (8 wks) | Reservation engine; deadlock avoidance; multi-cell dispatch; duration learning; validator tiers 3–4; safety policies; Helm chart; k8s deployment | Two cells run independent campaigns concurrently; deliberate deadlock scenarios are refused at validation, and a killed cell doesn't stop the other |
| **M6** | Depth (ongoing) | Codegen backend for control flow; manual-step nodes; LLM assistant; optimiser plug-in API; second ELN adapter; benchmarking suite per Canty/Abolhasani; federation spike | A closed-loop optimisation campaign runs unattended overnight and is fully reconstructible the next morning |

**Sequencing rationale:** topology before devices, devices before procedures, procedures before samples, samples before scheduling. Each layer is the substrate for the next, and inverting any pair produces rework. Resist building the scheduler early — it is the most intellectually appealing component and the least useful without everything beneath it.

---

## 15. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Scope creep into execution/driver territory (§3 erodes) | **Critical** | §3 is reviewed at every milestone; any proposed violation requires a written ADR |
| JointJS+ licensing conflicts with open-source condition | High | Decide at M0; keep the diagramming layer behind an interface |
| Adoption failure — too much ceremony to add a device | High | Measure the onboarding time as a KPI from M2; if it exceeds an hour, fix that before adding features |
| Ontology overhead kills usability (the documented reason ontologies fail to be adopted) | High | Terms are optional metadata with sensible defaults, never a blocking data-entry step. Auto-suggest, never demand. |
| Bluesky/queueserver API instability (`bluesky-queueserver-api` is explicitly labelled a prototype) | Medium | Pin versions; isolate all queueserver interaction behind one adapter module; contract-test against the pinned version in CI |
| Trying to be all five surveyed orchestrators at once | Medium | Position explicitly: EPIChem is the topology/sample/procedure layer over Bluesky. Interoperate with MADSci nodes rather than competing with them. |
| Reproducibility theatre — provenance captured but never validated | Medium | Add a "replay" test: reconstruct a past run's full context from stored provenance and diff it against the original |
| Single-maintainer bus factor | Medium | Documentation-first; ADRs; no undocumented tribal configuration |

---

## 16. Prior art to study before writing code

| Project | Take | Leave |
|---|---|---|
| **Bluesky / ophyd(-async) / queueserver** | Everything about execution, the document model, plan annotation, permissions | Its beamline-centric UX |
| **MADSci** (AD-SDL, Argonne) | Node standard, **Resource Manager** and **Location Manager** (closest existing analogue to §5/§7), OpenTelemetry integration, microservice decomposition | Its own workflow language — EPIChem targets Bluesky instead |
| **AlabOS** (A-Lab) | Resource reservation to eliminate task conflicts, proven at ~3500 samples | Materials-synthesis-specific task model |
| **HELAO** | Distributed orchestration across instruments | — |
| **IvoryOS** | Extremely low entry barrier; auto-generated UI from Python introspection — the same trick as §9.2 | Limited scaling model |
| **NOMAD CAMELS** | Measurement-protocol GUI over bluesky/EPICS; NOMAD data integration | Narrower device scope |
| **ChemOS 2.0** | Closed-loop orchestration patterns | ROS coupling |
| **World Avatar / dynamic knowledge graph SDLs** (`10.1038/s41467-023-44599-9`) | Ontology-driven distributed SDL architecture | Full-KG-first approach — too heavy as a starting point |
| **NetBox** | The DCIM/IPAM data model, wholesale | — |
| **n8n** | Node UX conventions, palette design, execution-trace visualisation | Its execution engine |
| **Chemotion / Kadi4Mat** | Sample and record semantics; API integration targets | Being an ELN |

---

## 17. Open questions requiring a decision at M0

1. **JointJS+ or `@joint/core`-only?** Blocks all frontend work. (§10.2)
2. **NetBox: institutional instance, own instance, or internal registry with NetBox-shaped schema?** Ask FHI IT. (§6.4)
3. **ELN target: Chemotion, Kadi4Mat, or both?** Determines the metadata mapping effort. (§7.6)
4. **Workcell granularity:** is a workcell a robot-served island, a room, or a logical group? This defines the scaling unit and the scheduler's search space.
5. **EPICS-only, or EPICS + Tango + direct-REST devices from day one?** ophyd-async supports all three; supporting all three from the start triples the integration test matrix.
6. **Is the reconciler a real Kubernetes operator with CRDs, or an in-application control loop?** CRDs give free tooling and RBAC but hard-require k8s, which conflicts with the `docker compose` on-ramp. A well-defined in-app reconciler with the same semantics is probably right.
7. **How much xDL?** Full xDL compatibility, IR-with-xDL-mapping, or ignore for v1?
8. **Manual steps in v1 or v2?** Recommendation: v1 — a system that can't express a human step won't be used in a real lab.
9. **Multi-tenancy model:** one deployment per group, or one per institute with tenant isolation? Affects the auth model and the database schema.
10. **Where does calibration data live** — EPIChem, the ELN, or a separate instrument database? Provenance completeness demands one answer.

---

## 18. Resources

> *The author appends design sketches, papers, prior notes, and AI-generated summaries of earlier prototypes below. Treat these as context and intent, not as specification. Where they conflict with §1–§17, this document governs unless annotated otherwise.*

**Already supplied and reflected in this plan:**

- `Lab-Ochestration_Software_Stack.md` — the author's working notes (project description, EPICS/ROS comparison, frontend/backend ideas, feature list, name candidates, meeting log)
- `s41570-026-00847-2_pdf.md` — Canty & Abolhasani, *The past, present and future of self-driving laboratories*, Nat. Rev. Chem. (2026). Its five strategic recommendations are the project's acceptance criteria (§1)
- `EPIChem_Console__Standalone_.html` — the visual prototype: approved styling, rejected functionality (§0)
- OT/IT architecture sketch (IOCs → EPICS → CWS → processing/scheduling → HMI → databases → intranet/internet)

**Key external references:**

- Bluesky Queue Server — plan/queue JSON API, plan annotation, user-group permissions: `blueskyproject.io/bluesky-queueserver`
- Queue Server client API: `blueskyproject.io/bluesky-queueserver-api` · HTTP façade: `blueskyproject.io/bluesky-httpserver`
- ophyd-async — device/signal/backend abstraction (EPICS CA & PVA, Tango, sim): `blueskyproject.io/ophyd-async`
- JointJS demos (technique reference; note the JointJS+ licensing caveat): `github.com/clientIO/joint-demos`
- NetBox data model: `netboxlabs.com/docs/netbox/models/dcim/`
- MADSci: `ad-sdl.github.io/MADSci` · JOSS paper `10.21105/joss.09416`
- Kadi4Mat API + `kadi-apy` · Chemotion ELN & Repository open APIs
- Abstraction in automated (bio)chemistry: `10.1038/s44160-024-00649-8`
- Dynamic knowledge graph SDLs / World Avatar: `10.1038/s41467-023-44599-9`
- RFC 2119 (contract keywords) · RFC 3339 (timestamps) · RFC 9457 (API errors)

**[ append further material below ]**
