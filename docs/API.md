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

`CapabilityClass`, `Sample`, and most of `Device`'s descriptor fields
(ophyd/transport/network/envelope/safety) don't exist yet — see
`project_plan/EPIChem_Roadmap.md` Milestone 1.3.
