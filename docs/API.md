# API reference

The backend (`backend/app/`) is FastAPI. **Live, interactive** docs (needs
the backend running — `docker compose up`, or see `HOST_SETUP.md`): Swagger
UI at <http://localhost:8000/docs>, ReDoc at <http://localhost:8000/redoc>,
raw schema at <http://localhost:8000/openapi.json>. This page is a static
snapshot of the same routes for reading without a running backend.

## Auth

Every endpoint requires `Authorization: Bearer <token>` **except**
`POST /auth/login` and `POST /users` (the bootstrap path — how you create
the first account before any token exists). Get a token:

```
POST /auth/login   {"name": "...", "password": "..."}   -> {"access_token": "..."}
POST /auth/logout                                          revokes the caller's own token
GET  /auth/me                                               {"uuid": ..., "name": ...}
```

No access **levels** yet — any valid token grants full access to everything.
See `backend/app/core/access_control/README.md` for the design options on
the table.

## Conventions

- Every entity below follows the same five-route shape: list (paginated),
  get-one (by UUID **or** unique `name`), create, partial update (`PATCH`,
  only sent fields change — **no `PUT`**), delete.
- List endpoints support `?limit=&offset=`, and report the pre-window total
  via the `X-Total-Count` response header. No other filtering yet.
- Every create/update/delete records a `Revision` (full JSON snapshot +
  acting user), queryable via `GET /revisions`.

## Endpoints

All paths below are relative to `/api/v1`.

**sites**, **labs**, **stations**, **zones**, **modules**, **devices** — the
containment hierarchy (`Site -> Lab -> Station -> Module/Device`, with
optional `Zone` grouping under a Lab or a Site):

```
GET    /<entity>                    list, paginated
GET    /<entity>/{id-or-name}       get one
POST   /<entity>                    create
PATCH  /<entity>/{id-or-name}       partial update
DELETE /<entity>/{id-or-name}       delete
```

Stations also carry `queueserver_url` (their pod's bluesky-httpserver);
devices carry `ophyd_name` (their name in that pod).

**station execution** — what a station's pod offers and is doing
(`docs/BLUESKY.md`):

```
GET  /stations/{id}/execution                    configured/reachable + RE Manager state
GET  /stations/{id}/execution/palette            plans_allowed, devices_allowed, registered
GET  /stations/{id}/execution/queue              pending, running, recent history
GET  /stations/{id}/execution/readings           live device readings (the pod's read_devices function)
POST /stations/{id}/execution/environment/open
POST /stations/{id}/execution/queue/start
POST /stations/{id}/execution/devices/register   a registry Device per unregistered pod device
POST /stations/{id}/execution/run                {plan, kwargs} -> a manual Run of one plan, now
```

Stations also carry `icon` (a glyph name the console draws; null → a
default by name).

**discovery** — pods that announced themselves or were probed (plan §6.2;
nothing is adopted without a person):

```
POST   /discovery/announce              pod heartbeat; Authorization: ApiKey <EPICHEM_QSERVER_API_KEY>, no bearer token
GET    /discovery/pods                  with online (heard from within 90 s) and station_uuid if already linked
POST   /discovery/probe                 {url} -> read a pod's status/plans/devices directly
POST   /discovery/pods/{id}/adopt       {lab_uuid, name} (new station) or {station_uuid} (link) -> Station, devices registered
DELETE /discovery/pods/{id}             dismiss
```

**procedures** — ordered steps, each on any station (same five routes as
above, by UUID or name), plus:

```
GET  /procedures?q=                search by name/description
POST /procedures/validate          {station_uuid, steps} -> {valid, diagnostics[]}  (saved or not)
GET  /procedures/{id}/compile      the queue items a run would dispatch
POST /procedures/{id}/duplicate    -> "<name> (copy)"
```

A step is `{id, type, plan, station_uuid, kwargs, label}`; `type` is
`plan` (a pod plan; `station_uuid` null → the procedure's default station),
`wait` (`kwargs.duration_s`), `input` (`kwargs.prompt`, `kwargs.fields:
[{name, label, type: text|number|boolean, required}]`) or `http`
(`kwargs.method, url, body, expect_status`). Any kwarg can be a template
`{{steps.<earlier id>.<path>}}`, resolved when the step is dispatched (a
whole-value reference keeps its type).

**runs** — one execution of a procedure, or a manual run of one plan.
EPIChem's orchestrator (a background thread in the API) advances runs:
dispatches each contiguous same-station block of plan steps, waits, asks,
calls out; state is observed from the pods every couple of seconds:

```
GET  /runs                         newest first, ?station_uuid=&procedure_uuid=&kind=procedure|manual
GET  /runs/{id-or-code}            items[]: per step status, kwargs_sent (resolved), run_uids, output
POST /runs                         {procedure_uuid, sample?: {...}} -> validate, register sample, dispatch
POST /runs/{id}/input              {step_id, values} answers a waiting Input step
POST /runs/{id}/stop               remove pending steps; the running one finishes
POST /runs/{id}/abort              stop now
```

Run states: `queued`, `running`, `waiting` (an Input step needs an answer),
`completed`, `failed`, `stopped` (abort ends here too), `unknown`. HTTP steps only reach hosts in
`EPICHEM_HTTP_STEP_HOSTS` (comma-separated; unset = any) and time out after
`EPICHEM_HTTP_STEP_TIMEOUT_S` (15).

**samples** — state and location change only through events:

```
GET    /samples                    ?state=&run_uuid=&q=
GET    /samples/{id-or-code}       with its event history
POST   /samples                    register by hand
PATCH  /samples/{id}               descriptive fields only
DELETE /samples/{id}
GET    /samples/{id}/events
POST   /samples/{id}/events        {to_state, reason?, station_uuid?}  (plan §7.3 lifecycle)
```

**files** — polymorphic attachment (owner_object_type + owner_object_uuid,
any entity above):

```
POST   /files                       multipart upload
GET    /files                       list, optional ?owner_object_type=&owner_object_uuid=
GET    /files/{id}                  download
DELETE /files/{id}
```

**users**, **groups** — identity (`backend/app/core/access_control/`):

```
GET/POST/PATCH/DELETE /users            (POST is the open bootstrap route)
GET/POST/PATCH/DELETE /groups
GET    /groups/{id}/members
POST   /groups/{id}/members/{user_uuid}
DELETE /groups/{id}/members/{user_uuid}
```

**revisions** — read-only audit trail:

```
GET /revisions                              paginated, ?entity_type=&entity_uuid=
GET /revisions/{entity_type}/{entity_uuid}  full history for one entity
```

**health**:

```
GET /health   -> {"status": "ok"}
```

## What's not here yet

`CapabilityClass` and most of `Device`'s descriptor fields
(transport/network/envelope/safety) don't exist yet — see
`project_plan/EPIChem_Roadmap.md` Milestone 1.3.
