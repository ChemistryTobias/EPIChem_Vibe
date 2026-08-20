# DESIGN.md — MPI-FKF Software & UI Design Reference

Source of truth: *Max-Planck-Gesellschaft Corporate-Design-Manual, Version 1.2 (19.07.2022)*, adapted here for **online use and software/UI projects** at the **Max Planck Institute for Solid State Research (MPI-FKF)** — color, type, logo handling, layout logic, and component styling translated from the brand system for screens.

---

## 1. Institute identity

- **Name:** Max Planck Institute for Solid State Research (MPI-FKF)
- **Parent org:** Max-Planck-Gesellschaft (MPG)
- **Logo model:** MPI-FKF uses its own name set in the standard Max Planck wordmark style, paired with the Minerva bildmarke ("Variante 1 / 2" in the CD manual — institute name + Minerva). MPG leadership's stated preference is Variante 1 (name only, no separate institute logo) — don't design a standalone FKF logo/mark for a tool; use "MPI-FKF" or "Max Planck Institute for Solid State Research" as a text wordmark instead.
- **Minerva:** the profile-head bildmarke is MPG/institute IP. Don't reproduce, recolor, or redraw it in an app — if a UI needs a mark, use text (institute name/initialism) or a neutral, non-Minerva glyph instead.

---

## 2. Color

Official MPG specs, given here as sRGB hex for direct screen use.

### Primary (header bars, primary buttons, active nav state)

| Name | Hex | Notes |
|---|---|---|
| MPG green | `#006C66` | primary brand color, preferred logo/accent color |
| MPG green dark | `#005555` | secondary brand color, strong accent |

### Neutrals (text, chrome, borders)

| Name | Hex |
|---|---|
| Black | `#000000` |
| MPG grey dark | `#777777` |
| MPG grey | `#A7A7A8` |
| MPG grey light | `#EEEEEE` |
| White | `#FFFFFF` |

### Accents (charts, tags, status indicators — never the dominant UI color)

| Name | Hex |
|---|---|
| MPG green light | `#C6D325` |
| MPG blue dark | `#29485D` |
| MPG blue light | `#00B1EA` |
| MPG orange | `#EF7C00` |

**Rules that still apply on screen:**
- Max **4 MPG colors** in one view; of those, max **2** as large fill/background colors (prefer colors from one family, e.g. green + green light).
- With MPG green dark present, use **no more than 3** accent colors at once.
- **MPG blue dark** (`#29485D`) is the officially sanctioned institute-variant color (mirrors the blue set MPG uses for institutes on its web CMS) — good as a secondary accent or dark-mode surface for FKF-branded tools.
- Accent colors (green light, blue light, orange) are reserved for large fills only in "younger audience" contexts (IMPRS) — use them as small UI accents (tags, chart series, badges), not as dominant backgrounds.

### Suggested UI tokens

```
--color-primary:        #006C66;   /* MPG green — primary actions, links */
--color-primary-dark:   #005555;   /* MPG green dark — headers, hover/active */
--color-accent-alt:     #29485D;   /* MPG blue dark — institute variant, dark mode */
--color-text:           #000000;
--color-text-secondary: #777777;   /* MPG grey dark */
--color-border:         #A7A7A8;   /* MPG grey */
--color-surface-muted:  #EEEEEE;   /* MPG grey light */
--color-bg:             #FFFFFF;

--color-chart-1: #006C66;
--color-chart-2: #C6D325;
--color-chart-3: #00B1EA;
--color-chart-4: #EF7C00;
--color-chart-5: #29485D;
```

---

## 3. Typography

MPG deliberately uses free/open fonts so institutes aren't blocked by licensing.

- **Roboto** — the primary typeface family.
  - Headlines: **Roboto Bold**, tracking +50…+100 (generous letterspacing on headings/all-caps)
  - Body/intro text: **Roboto Light**, tracking +25…+40
  - Subheads: **Roboto Bold**, uppercase, tracking +25
  - Get it: https://fonts.google.com/specimen/Roboto
- **Merriweather** — secondary/editorial typeface, contrast face for research/human-interest content (article headlines, pull quotes, italic captions). Only relevant for narrative/editorial screens (e.g. a research-news reader), not for tool UI.
  - Get it: https://fonts.google.com/specimen/Merriweather
- **Fallback:** Arial.
- **Self-host fonts.** Loading Roboto/Merriweather from Google's CDN requires user consent (cookie banner) under GDPR — self-host the font files in any web app instead of linking fonts.googleapis.com.

### Suggested UI type scale

```
--font-display: "Roboto", system-ui, sans-serif;   /* weight 700, letter-spacing 0.02–0.05em for headings */
--font-body:    "Roboto", system-ui, sans-serif;   /* weight 300–400 for body text */
--font-mono:    ui-monospace, "SFMono-Regular", monospace; /* for data/code — not in the source manual */
```
Text sets left-aligned (ragged-right) — don't justify body text.

---

## 4. Layout logic

- **Consistent corner placement for identity:** MPG anchors the logo top-right in print but mirrors it to top-left for web (its own web style guide does this because the menu occupies the top-right online). Follow that: put the institute/product identity top-left in a nav bar, and keep the space around it clear — no other elements crowding it (the manual's "Logoschutzzone" principle).
- **Modular content blocks** ("Hauptfläche" / "Nebenfläche"): the brand system composes views from one dominant content area plus smaller supporting blocks (text, color fields, small images/stats). Maps directly onto dashboard/card layouts — one primary panel, secondary panels for metadata/status/actions.
- **Generous whitespace, asymmetric composition:** favor left-aligned, module-based layouts over centered/symmetric ones.
- **Circles & Lines motif:** the manual's signature decorative system is a grid of small circles (4 circles per square module) and tapering vertical lines, used as watermark-like texture behind headlines/numbers. Good optional flourish for a landing/splash screen; keep it out of dense data views where it would compete with content.

---

## 5. Buttons & interactive elements

The brand system has no explicit screen-component spec (it's a print manual), so the following extrapolates its stated visual principles — **flat, geometric, no gloss/gradient finishes, sharp typography with wide tracking, restrained accent use** — into concrete button rules.

### Shape

- **Corner radius: sharp to minimally rounded.** The brand's core motif is squares and circles used as pure geometric fields (Quadrateraster grid, Circles), never soft blends between the two — so buttons should read as clean rectangles, not pill-shaped. Use `0–4px` radius; `4px` is the practical ceiling for a "soft but still geometric" feel. This app sits at the **sharp end** — `--radius: 1px`, a single hairline softening — applied uniformly to buttons, cards, inputs and alerts. Avoid fully rounded/pill buttons — they contradict the square-grid identity.
- **Fill, not outline, for primary actions.** The manual explicitly rejects glossy/gradient print finishes ("von Glanzlack-Veredelungen raten wir ab") in favor of flat, matte color — translate that to flat, single-color fills with no gradient, no drop shadow, no inner glow. A 1–2px flat border in the same hue (darker shade) is acceptable for secondary/outline buttons.
- **No skeuomorphism.** No 3D bevels, no glossy highlight, no soft elevation shadows on hover — state changes should be communicated by flat color shift and/or a thin focus ring, not by depth effects.

### Sizing & spacing

- Padding: generous horizontal padding relative to height (the manual's textboxes consistently favor width over height — "Kasten nicht ganz mit Text ausfüllen"), e.g. `10–12px vertical / 20–24px horizontal` for a standard button.
- Label type: **Roboto Bold, uppercase, tracking ~+50–80** (matching the manual's headline/label tracking spec) for primary and secondary buttons — this is one of the more distinctive, transferable pieces of the brand voice. Reserve sentence-case/no-tracking labels for low-emphasis tertiary/text-only buttons, where all-caps would be visually too loud.
- **Two sizes, one component.** All buttons come from the single `Button` primitive (`components/Button.tsx`) — never a restyled `<button>`. It has a **standard** size and a **compact** (`sm`) size (~`5px/12px` padding, ~10px label): use `sm` for the "non-main" companion buttons that sit next to a primary action in a toolbar or a canvas overlay (Back, 2D toggle, Cancel, Edit floor), so the primary action stays the largest thing in the group and the rest read as secondary by size, not by louder color. Keep the *variant* meaningful (primary = the one main action, secondary/text = the rest); use the size to express "smaller, alongside."
- **Compact buttons stay quiet until hovered.** A `sm` button reads **white fill, not bold, grey text and a thin grey border** at rest; on hover **only the text** turns the action colour (the white fill and grey border stay put) — MPG green normally, the one-off red for a destructive action — and it goes a **lighter grey when disabled** to read as not-clickable. This is the same restraint as the location path: colour on text = you can click it. It keeps a toolbar of companions calm next to the single filled primary while still signalling intent (green = go, red = careful).

### Color by state

| State | Primary button | Secondary button |
|---|---|---|
| Default | fill `#006C66`, text `#FFFFFF` | transparent fill, 1–2px border `#006C66`, text `#006C66` |
| Hover | fill `#005555` | fill `#EEEEEE`, border/text unchanged |
| Active/pressed | fill `#005555`, slightly reduced padding or 1px inset border in black at 10% opacity (flat, not a shadow) | fill `#A7A7A8` at low opacity |
| Disabled | fill `#A7A7A8`, text `#FFFFFF` at reduced opacity | border/text `#A7A7A8` |
| Focus (keyboard) | 2px solid focus ring in `#00B1EA` (MPG blue light) offset ~2px from the button edge — bright enough to be clearly visible against both green and white | same |

Destructive actions: don't invent a new red — none exists in the MPG palette. If you need a warning/destructive color, treat it as a deliberate one-off exception (a standard accessible red, e.g. `#C0392B`-class) rather than trying to force-fit MPG orange (`#EF7C00`), which reads as "warning/attention" but not "destructive" to most users.

### Icon buttons / tags / chips

- Same flat-fill, sharp-corner logic as buttons.
- Status chips/tags are a good home for the accent colors (green light, blue light, orange) at small scale — this matches how the manual scopes those colors to illustrations, charts, and small-scale use rather than large fills.

### Alerts & notifications (one schema)

There is **one** alert look for the whole app — a flat card (`.notice`) with a coloured **left edge** carrying the meaning, white fill, sharp corners, no gloss (consistent with the button rules above). Don't invent per-screen alert boxes; raise everything through the shared component so warnings and errors look identical everywhere.

- **Kinds → colour** (left edge only; the accents are used at small scale, as the manual intends):
  - **info** → MPG blue light `#00B1EA`
  - **success** → MPG green `#006C66`
  - **warning** → MPG orange `#EF7C00`
  - **error** → the one-off red `#C0392B`
- **Placement:** transient, event-driven messages ("saved", "couldn't move that there", a network error) **pop out bottom-left** and stack there (`components/Notifications.tsx`, `useNotify()`); newest nearest the corner. Info/success/warning auto-dismiss; **errors stay** until dismissed. A repeated event (a hint fired on every attempt) reuses a stable key so it replaces rather than piles up.
- **When _not_ to use a toast:** field-level validation stays **inline next to the field**, and a whole-screen load/error state stays in `AsyncBoundary`. Toasts are for events, not for form errors or page state. A persistent, live readout (e.g. the layout's "not drawn correctly" list) may reuse the same `.notice` card **inline** — same look, pinned in place rather than popped out.

---

## 6. Quick reference — do / don't

**Do:**
- Use MPG green (`#006C66`) as the primary interactive color; MPG green dark (`#005555`) for emphasis/headers/hover states.
- Set headings and button labels in Roboto Bold with increased letter-spacing.
- Keep buttons flat-filled, sharp-to-minimally-rounded, with no gradients or shadows.
- Keep the institute name as a text wordmark; don't invent a new FKF logo mark.
- Self-host fonts.

**Don't:**
- Redraw, recolor, or stylize the Minerva bildmarke.
- Use more than ~4 MPG colors in one screen, or the bright accent colors as dominant backgrounds.
- Use pill-shaped/fully-rounded buttons, gradients, glossy highlights, or soft drop-shadow elevation — none of these are part of the brand's flat, geometric visual language.

---

## 7. Implementation reference (current frontend)

This section pins down what `frontend/` actually built, so a rewrite (the
Roadmap's 0.3) can match the current look pixel-for-pixel rather than
re-deriving it from the brand rules above. Source of truth for these values
is `frontend/src/styles/tokens.css` — if this section and that file ever
disagree, the file wins; re-sync this section then.

### Spacing scale

A single 4px-based scale, used via `gap`/padding, not ad-hoc margins:

```
--space-1: 4px   --space-2: 8px   --space-3: 12px
--space-4: 16px  --space-5: 24px  --space-6: 32px
```

### Shell dimensions

```
--sidebar-width:    236px   /* dark left rail, MPG green dark */
--header-height:    72px    /* screen header: title/subtitle + outline buttons */
--inspector-width:  316px   /* right-hand panel in list+inspector layouts */
```

### Additional tokens beyond §2/§3

```
--color-border-soft: #dcdcdc   /* lightened grey — table hairlines */
--color-danger:       #c0392b  /* the one-off destructive red, §5 */
--tracking-label:    0.08em    /* uppercase labels */
--tracking-heading:  0.03em    /* headings */
--tracking-button:   0.10em    /* button labels, §5's +50–80 spec */
--radius:            1px       /* the sharp end of §5's 0–4px range, applied
                                   uniformly to buttons/cards/inputs/alerts */
```

### Shared components (`frontend/src/components/`)

The vocabulary a rewrite should keep, not reinvent — one component per
concern, styled entirely off the tokens above:

| Component | Role |
|---|---|
| `AppShell` | sidebar + header + content frame |
| `Sidebar` | dark left rail, nav + section grouping |
| `ScreenHeader` | 72px title/subtitle/actions bar |
| `Inspector` | right-hand detail/edit panel |
| `Button` | the one button primitive — standard + `sm` sizes, primary/secondary/text variants, no restyled `<button>` elsewhere (§5) |
| `AsyncBoundary` | loading/error/empty triad around a data fetch |
| `Notifications` | bottom-left toast stack (`useNotify()`) — info/success/warning/error, errors persist until dismissed |
| `Pager` | limit/offset pagination control over `X-Total-Count` |
| `StatusDot` | small live-state indicator |
| `TokenField` | tag/chip-style input |

Two gaps a rewrite should close rather than copy forward (flagged in the
2026-08-20 backend/frontend audit, see `docs/PROJECT_HISTORY.md`): there is
**no shared confirm/modal** component (one raw `window.confirm(...)` in the
whole app) and no shared submit/error-handling hook (`try/catch → notify` is
copy-pasted per screen). Both are small, token-driven additions — not a
visual redesign — see `docs/project_plan/EPIChem_Roadmap.md` 0.3.

---

## 8. Lab map & isometric layout

Design reference for the **Device Management → Lab Layout** editor (plan §10, ADR 0007/0009):
the site map, the per-lab isometric floor, and the per-station device sub-layout. The brand's core
motif is **squares and circles as pure geometric fields** on a raster (Quadrateraster) — which maps
onto a grid-based lab editor almost literally, so lean into it rather than fighting it.

### Site map (2-D floorplan)

- A plan-view of the site, optionally over an **uploaded floorplan image**. Keep the plan itself
  quiet: floorplan on a `#EEEEEE` (grey light) surface, lab rectangles as **flat outlines** in
  `#A7A7A8` (grey), the selected/active lab filled `#006C66` (MPG green) or outlined
  `#005555` (green dark). No gloss, no shadow — a lab is a flat filled rectangle, not a card.
- The manual's **Circles & Lines** motif is a landing/splash flourish only — keep it **out** of the
  map and the isometric floor, where it competes with data.

### Isometric floor (per lab)

- **Tiles are flat geometric fields**, not skeuomorphic 3-D boxes. Station tiles read as clean
  diamonds/rectangles in the **green family** (`#006C66` fill, `#005555` edges); differentiate
  station *kind* with the small-scale accents (blue light, orange, green light) as edge/badge
  colour, never as a second large fill (respect the "max 2 large fills, prefer one family" rule).
- **Box height** (the user-editable isometric depth, §10.3) is rendered as the tile's extruded
  side faces in a **darker shade of the same hue** — a flat tonal step, *not* a drop shadow or a
  gloss gradient. Depth is communicated by geometry + flat shading, consistent with §5's
  "no skeuomorphism, flat color shift not depth effects."
- The **grid raster** itself is a light `#A7A7A8`/`#EEEEEE` line set — present enough to read as a
  raster (echoing the Quadrateraster identity), faint enough to sit behind the tiles.

### Zones (human vs. robot, hazard)

Zones are drawn regions, so they use **outline + tint**, never a dominant fill:

- **Human area:** neutral — grey (`#A7A7A8`) dashed outline, no tint or a very light grey wash.
- **Robot area:** `#29485D` (MPG blue dark, the sanctioned institute-variant colour) outline/tint —
  distinct from the green plant, reads as "machine".
- **Hazard zone:** `#EF7C00` (MPG orange, the manual's attention colour) outline/hatch.
- Keep these as accents at region scale; the green stations remain the visual subject.

### Devices in the station sub-layout & live status

- In a station's sub-layout, **modules are squares, leaf devices are circles** (§10.1) — the exact
  square/circle pairing the brand system is built on.
- **Live status badges** use the accent set at small scale: `#C6D325` (green light) = ok/idle,
  `#EF7C00` (orange) = warning, and for a genuine fault use a **deliberate accessible red**
  (`#C0392B`-class) as the one-off exception §5 already sanctions — do **not** press MPG orange into
  double duty as "error". Every badge carries its timestamp/staleness (plan §13 UI principle).
