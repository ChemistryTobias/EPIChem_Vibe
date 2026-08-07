# EPIChem frontend

React + TypeScript + plain CSS console for the EPIChem registry. Four screens — **Lab layout**
(isometric), **Topology**, **Devices**, **Samples** — all reading the real API. There is no mock
data anywhere in this app; if the backend is down, the screens say so.

## Run it

From the repo root, this app plus everything it needs — seeded database included:

```bash
docker compose up          # → http://localhost:5173
```

Or on its own, against a backend you are already running:

```bash
# 1. backend, with something in it (from ../backend)
.venv/bin/epichem init-db
.venv/bin/epichem import-dir --descriptors-dir ../descriptors
.venv/bin/epichem sample add SMP-2026-0001 "PEDOT:PSS film" --substance "PEDOT:PSS" \
  --amount 1.5 --unit mL --location RACK-A/3
.venv/bin/uvicorn epichem.api.app:app --reload      # :8000

# 2. frontend (from here)
npm install
npm run dev                                          # → http://localhost:5173
```

The dev server proxies `/api` to `http://127.0.0.1:8000` (`vite.config.ts`), so the browser only
ever talks to one origin and **no CORS configuration is needed for local development**. Point it
somewhere else with `EPICHEM_API_URL=http://host:port npm run dev` — which is exactly what
`compose.yaml` does, pointing it at `http://api:8000`.

In production the Vite proxy doesn't exist, so `Dockerfile`'s runtime stage serves the built
bundle through nginx and gives it the same job (`nginx.conf.template`). Same single origin, so
still no CORS. If you ever do serve this build from a different origin than the API, set
`EPICHEM_CORS_ORIGINS` on the backend — see `backend/epichem/api/app.py`.

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # typecheck + production bundle into dist/
```

Tests sit next to what they cover (`topologyTree.test.ts` beside
`topologyTree.ts`). They target the three places where a bug wouldn't be
obvious on sight: the tree-building logic, the API client's problem+json
handling, and the pager's boundaries. Screens themselves aren't
snapshot-tested — the churn would outweigh what it catches.

## Layout

```
src/
  main.tsx                 mounts App, imports the two global stylesheets
  App.tsx                  route -> screen, and nothing else
  api/
    client.ts              the only place that calls fetch; unwraps RFC 9457 problem+json
    types.ts               hand-written mirrors of backend/epichem/api/schemas.py
    topology.ts            per-area endpoint wrappers
    devices.ts
    samples.ts
  hooks/
    useAsync.ts            {data, error, loading, reload} — the whole data layer
    useHashRoute.ts        ~30-line hash router
  components/              shell + shared primitives (Button, StatusDot, Inspector, …)
  screens/
    layout/                isometric floor plan — isometric.ts is pure geometry (plan §10.3),
                           useIsometricPaper.ts is all the JointJS lifecycle, shapes.ts the tiles
    topology/              tree view + tree-building logic (topologyTree.ts is pure)
    devices/               card grid + filters
    samples/               table + register form + inspector
  styles/
    tokens.css             MPG brand tokens, straight from project_plan/DESIGN.md
    base.css               reset + the .label / .mono / .muted primitives
```

Component CSS lives next to the component (`Button.tsx` / `Button.css`) and is imported by it, so
a component is one place, not two directories. Only `tokens.css` and `base.css` are global.

## Choices worth knowing about

- **No UI kit, no CSS framework.** `styles/tokens.css` is `project_plan/DESIGN.md` in
  machine-readable form; if a value here and DESIGN.md disagree, DESIGN.md wins.
- **No router dependency.** Three screens, no params, no nesting — `useHashRoute.ts` is smaller
  than the README section explaining why you'd add React Router. Swap it in if routing grows.
- **No data-fetching library.** `useAsync.ts` is ~40 lines and every screen consumes the same
  four-field shape, so replacing it with TanStack Query later touches this file and its call sites
  only.
- **Paged lists** (`/samples`, `/devices`) come back as `{items, total}` via `apiGetPage`, reading
  the API's `X-Total-Count` header. Topology lists aren't paged, on purpose — see
  `backend/epichem/api/pagination.py`.
- **The API token** lives in localStorage, set by one field in the sidebar. That is not a login
  screen and shouldn't become one until the backend has real identities: today it's a shared
  secret with no user behind it.
- **Hand-written API types** rather than OpenAPI codegen: there are about ten of them and a human
  can read this file. Revisit if it stops fitting on a screen.
- **Visual language** — sidebar, header, list + right-hand inspector, flat cards, status dots —
  follows the approved standalone HTML prototype in `project_plan/`. Its *data model* is not
  followed: that prototype was hard-coded around one spin-coating cell, and the plan says so.

## The isometric layout

Built on **`@joint/core` alone** (MPL-2.0) — no Stencil, Inspector, Halo, Toolbar, Navigator or
Selection, all of which are JointJS+ commercial. Plan §10.2 recommends exactly this: the free core
plus React-side panels, which is what `LayoutInspector` is. The projection is §10.3's formulas,
implemented as pure functions in `isometric.ts` and unit-tested there, including that `toGrid`
inverts `toScreen` for every cell of a grid — that inverse is what makes dragging land where you
dropped it.

The canvas holds no authoritative state, per §10.3: a drag reports a grid cell, the screen PUTs it
and refetches, and the redraw is what moves the tile. A rejected write snaps it back for free.

`@joint/core` is ~435 kB, so this screen is lazy-loaded (`App.tsx`) and the other three don't pay
for it.

What's *not* built from §10: multi-bench rooms, zone drawing, creating/deleting stations, resizing
benches, multi-select, align/distribute, copy-paste, undo/redo. The live-status, sample-occupancy,
transport-route and utilisation layers need M2's device plane — there is no live state to draw.

## Not here, on purpose

- **The procedure/workflow editor** (M3). When it is built it will use **React Flow** (MIT), not
  JointJS — decision recorded, nothing to build against yet: no procedure IR or backend exists.
  React Flow is *not* a dependency of this app and is not used by the Samples screen.
- **Live device state, jog/home controls, signal plots** (M2). The Devices screen shows the
  registry record for each device, not its runtime.
- **Sample lineage graphs, event history, containers** (M4, plan §7.4/§7.3). See `docs/adr/0005`
  for exactly what the minimal sample model does and doesn't have.
- **Login/auth.** The backend has none yet (§12.1), so neither does this.
