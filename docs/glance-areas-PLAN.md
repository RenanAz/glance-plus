# Glance Areas — planning document

Status: **draft v2, mockup-aligned** · Author: Renan + agent · Date: 2026-11-19
Repo: `github.com/RenanAz/glance-plus` (checkout `/workspace/glance-plus`)
Companion: [`glance-areas-AGENT-BRIEF.md`](./glance-areas-AGENT-BRIEF.md) — the short,
executable brief.

This document is the contract for a new card. It is written so that an agent can
execute it phase by phase without re-deciding the design, and so that a human can
reject a phase without reading code.

**How to use it**

1. Read §1–§3 once, for intent.
2. Work through §4 (FRs) and §6 (schema); those are the behaviour contract.
3. Pick up §5 (decisions) only when a phase touches one.
4. §10 is the build order. A phase is done when its exit criteria pass **and**
   the live check in §11.4 passes.
5. Anything not in this document is out of scope for the phase being built.
   Add it to §13, don't freelance it.

---

## 1. Context

### 1.1 What exists today

| Thing | Where | What it is | Reuse |
|---|---|---|---|
| `glance-plus` | `src/glance-plus.js` | Flat aligned grids; Jinja name/icon/colour/`show_if`; blocks; visual editor | Editor patterns, batched `render_template`, error badge |
| `hierarchy-area` | `src/hierarchy-area.js` | **One area per card**: header row, controls flat list, `group` plates, `downstream` bundles, `hold` logic, editor | The entire "per-area detail" renderer + hold/downstream semantics |
| `hierarchy-areas` | `src/hierarchy-areas.js` | Superseded floor switch board (pill → expand) | Layout/morph ideas only; do not extend |
| `hierarchy-power` / `hierarchy-energy` | `/workspace/hierarchy-cards` | Per-area power/energy inferred from `energy/get_prefs` → `device_consumption` | The area→power/energy resolver |
| Preview harness | `/workspace/HA/glance-plus` | `make-preview.mjs` pulls live states → `preview.html` → headless screenshot | Every visual iteration |
| Deploy tool | `/workspace/HA/apply-live-card.mjs` | Writes a live inline resource **after backing it up** | Every deploy |

### 1.2 What is new

A **floor card**: N area tiles in one card, one tile expanded at a time into a
tall tab-shaped panel, siblings demoted to mini-rectangles that reflow around it,
auto-collapse on a timer. The collapsed tile is the "glance" surface; the panel is
the "detail" surface and reuses `hierarchy-area`'s material.

### 1.3 Reference mockups (received 2026-11-19)

Two renders by Gemini from a hand sketch. Treat them as the **geometry and content
authority**; treat anything they contradict in prose as superseded by them.

- [ ] `mockup-collapsed.png` — floor "Primeiro", 3 × 3 area tiles. Commit to
      `docs/mockups/`.
- [ ] `mockup-expanded.png` — Sala expanded, siblings as mini-tiles, full detail
      stack. Commit to `docs/mockups/`.

Measured from the 768 px-wide renders (values become the §8 tokens):

| Element | Measurement |
|---|---|
| page margin / grid gap | 40 px / 12 px |
| collapsed tile | **225 × 260** (portrait, not square), radius 20, padding 14 |
| tile header | area icon 28 px left; readout right-aligned, 2 lines of ~16 px |
| tile name | 22 px / 600 |
| domain circle | 44 px, icon 20 px, count badge 16 px at top-right |
| opening pill | 30 px tall, radius 15, icon 16 + count 13 |
| mini-tile | 225 × ~96, radius 18, icon 26, name 18, bubbles 22 |
| expanded panel | one column wide × ~3 rows tall (≈215 × 715), radius 20 |
| section micro-label | 11 px, uppercase, letter-spacing +0.08 em, muted |
| detail row | 56–64 px tall, radius 12, 1 px hairline |

Two structural facts the mockups settle:

1. **Tiles are portrait, and the panel is vertical.** The expanded area stays one
   column wide and grows tall; the remaining tiles shrink and flow around it. It is
   not a full-width drawer.
2. **Missing data is omitted, not placeholdered.** "Corredor" shows only `21°` —
   no humidity, no power line. "Varanda" shows no power line.

---

## 2. Nomenclature (settle this before writing code)

Your prompt mixed four different things under "square/card". Fixing the words now
prevents a schema that cannot be edited later.

| Term | Means | Not to be confused with |
|---|---|---|
| **Dashboard** | The Lovelace page (`/home-test`) | |
| **View** | A tab inside a dashboard ("Home", "Glance test") | |
| **Section** | HA's sections-view container inside a view | |
| **Card** | One custom element instance — **one per floor** | |
| **Tile** | One area's portrait rectangle in the collapsed grid | a card, or an area |
| **Panel** | The expanded form of a tile (one column, tall, tab-shaped) | the card |
| **Mini-tile** | What siblings become while a panel is open | a tile |
| **Area** | HA area-registry object (`area_id`, optional `floor_id`) | a tile |
| **Circle** | The 44 px domain button on a tile (climate / covers / lights) | the opening pills |
| **Badge** | The count drawn on a circle or pill | a bubble |
| **Spot** | A light that is on, shown in the panel as `name · duration` | a group |
| **Bundle** | An upstream control plus its downstream devices (existing `hierarchy-area` term) | a group |

Two naming traps:

- HA already ships a dashboard type called **"Glance"**, and this repo has a card
  called **`glance-plus`**. Calling the collapsed state "the Glance phase" in code
  will confuse every future reader. Use **collapsed / expanded** in code and docs;
  "Glance" stays a product word only.
- "Square bundled in a minimum of 3 and 6 at most" is a **layout fact** (3 columns,
  two rows), not a data constraint. Don't put a 3–6 limit in the schema.

Proposed card name: **`custom:glance-areas`**, file `src/glance-areas.js`
(alternatives considered in D2).

---

## 3. Intent and non-goals

### 3.1 Jobs

1. **Scan the floor in one look** — which areas are warm, humid, drawing power,
   have something on, have a window open.
2. **Act without navigating** — kill the lights in an area, see/close shutters,
   read the AC state.
3. **Drill into one area** without leaving the floor — spots, dimmers, climate,
   covers, doors/windows, nested bundles, presence and battery.
4. **Stay out of the way** — the panel closes itself; the floor is back.

### 3.2 Non-goals (this card, this phase)

- No charting / history graphs (sparklines are a later idea, §13 Q7).
- No editing of areas or devices; the card reads registries and Energy prefs and
  calls services the user configured.
- No statistics writes, no recorder changes, no `.storage` edits. Ever.
- No replacement of `hierarchy-power`/`hierarchy-energy`; only their per-area numbers.
- No "expand all areas at once" in v1 (parked: FR-24 / Phase 5).
- No theming engine; HA theme variables + a small token block only.

---

## 4. Feature requirements

Priorities: **M** must (blocks the phase) · **S** should · **C** could (later).
Each FR has acceptance criteria that a test or a live check can verify.

### 4.1 Card scope

**FR-01 — One card per floor (M)**
A card renders every area of one floor, or an explicit area list.
*Accept:* `floor: piso_0` with 9 areas renders 9 tiles in registry order;
unknown floor → empty-state card with an error, not a blank element.

**FR-02 — Area resolution (M)**
`areas_mode: auto` derives areas from the area registry (filtered by `floor`,
`include`/`exclude`); every derived value can be overridden per area. Explicit
`areas:` entries win and may add areas the registry does not know.
*Accept:* renaming an area in HA updates the card on reload; an explicit `name`
override survives; a non-admin user still gets tiles and the card says so once in
the console.

**FR-03 — Grid (M)**
3 columns default, `columns` configurable; portrait tiles from a fixed tile height
(§8), not from the viewport; 9 areas = 3 rows; no half-rows, no reflow when text is
long (name ellipsised, readout never wraps).
*Accept:* 3, 4, 5, 6, 9, 12 areas render without gaps; widening the section changes
tile width, not the layout order.

**FR-04 — Card header (S)**
Optional title/icon matching `hierarchy-*`; hidden by default (the mockup has none).

### 4.2 Collapsed tile

**FR-05 — Area identity (M)**
Area icon top-left (registry icon, overridable), name below the readout at 22 px,
per-area accent for active elements. Name ellipsised at one line.
*Accept:* icon and name come from the area registry with zero config; a 24-character
name ellipsises without pushing the readout.

**FR-06 — Readout line (M)**
`{temp}° · {humidity}%` at the top-right, compact (no unit letter in the tile),
locale decimal separator, units from `hass.config.unit_system`. A missing or
`unavailable` sensor is **omitted from the line**, not shown as `—` or `0`; if both
are missing the line is absent and the power line moves up.
*Accept:* Corredor-like area with temperature only renders `21°`; °F instance renders
`72 °F` in the panel and `72°` in the tile; `unavailable` never prints `NaN`.

**FR-07 — Power line in the tile (M)**
Second readout line: lightning glyph + live power, auto-scaled (`122W`, `1.4kW`).
Energy today is **not** in the tile (it is in the panel). No mapping → line absent.
*Accept:* matches `hierarchy-power` for the same area; unmapped area has no line and
no reserved gap.

**FR-08 — Domain circles (M)**
Up to three 44 px circles per area, ordered and individually disable-able:
1. **climate** — AC; tinted by mode, badge = number of active units;
2. **covers** — badge = number of covers not `closed`;
3. **lights** — badge = number of lights/switches `on` that the area "holds"
   (`hold` rules inherited from `hierarchy-area`, D11).
Badge renders only when count > 0; no badge → outlined circle, not a `0`.
`behavior` per circle: `focus` (expand + scroll to group, default) · `toggle_off`
(call `turn_off` on the set, opt-in `confirm`) · `none`.
*Accept:* tapping covers on a collapsed tile expands the panel scrolled to the
covers group; `toggle_off` turns off exactly the configured set and the badge
disappears; circles are keyboard reachable with `aria-label`s.

**FR-09 — Icon morphing (M)**
Icon follows state wherever a state exists: climate (`heat`→fire, `cool`→snowflake,
`dry`→droplet, `fan_only`→fan, `off`→power), cover (open/closed/opening/closing),
light/switch, dehumidifier, fan. One table in code, per-area override.
*Accept:* changing AC mode in Developer Tools repaints within one render cycle;
unknown state → neutral icon, never empty.

**FR-10 — Opening pills (M)**
Bottom row: up to two outlined pills (default `doors`, `windows`) with icon + count
of **open** ones, chevron centred between them. Count 0 → pill hidden (mockup shows
both pills only where an opening exists). Types configurable per area; a third type
is supported on mini-tiles only (FR-21).
*Accept:* opening a door in HA increments the door pill without a reload; area with
no openings renders the chevron centred alone.

**FR-11 — Expand affordance (M)**
Chevron centred in the bottom row toggles the panel; the tile body and the area name
also toggle it; chevron rotates 180°; `aria-expanded` on the tile.
*Accept:* mouse, touch and `Enter`/`Space` all expand; focus ring visible on the tile.

### 4.3 Expansion

**FR-12 — Vertical morph (M)**
The expanded tile stays **one grid column wide** and grows to the height of its
content (typically 2–3 rows, per mockup), radius 20, top edge reads as a tab
(the name + chevron stay in the header of the panel). Every sibling becomes a
mini-tile (~96 px tall) and reflows around the panel (`grid-auto-flow: dense`).
Contents cross-fade; height animates ~220 ms; `prefers-reduced-motion` → instant.
No scroll jump, no view reflow.
*Accept:* at 9 areas, expanding the middle tile leaves the other 8 as mini-tiles,
none clipped or overlapped; animation ≤ 300 ms; scroll position preserved.
`expand.width: full` is supported as an option for wide sections (D4) but is not
the default and is not built before Phase 3.

**FR-13 — One expanded at a time (M)**
Expanding B while A is open retargets (A → mini, B → panel) without passing through
"all collapsed". Same tile/chevron/`Esc` collapses.
*Accept:* A→B leaves exactly one panel; `Esc` collapses and returns focus to the
tile that was expanded.

**FR-14 — Auto-collapse timer (M)**
Default 20 s, configurable, `0` = never. Resets on interaction inside the panel
(pointer, key, scroll, input). Pauses while a bundle is open and while
`focus-within`. Pauses when the tab is hidden. Optional countdown (default off).
*Accept:* fake-clock test: expands at t0, collapses at t0+20 s; a click at t0+19 s
collapses at t0+39 s; open bundle pauses; hidden tab does not burn the timer.

### 4.4 Panel (detail)

**FR-15 — Header strip (M)**
One line under the area name, per mockup: temperature (with unit), humidity,
presence age (`4 min`), battery %; right-aligned live power `122 W` and energy today
in parentheses `(1.9 kWh)`. Each metric optional and omitted when unavailable;
divider between the climate group and the energy group.
*Accept:* with no presence sensor the strip closes the gap; a 70 % battery renders
its icon; power/energy match FR-07/FR-16 sources.

**FR-16 — Sensors and diagnostics (M)**
Rows for each declared sensor: value + `last_updated` age, battery level with
dynamic icon (charging, 10 % steps, low = warning colour). Ages use
`last_updated`/`last_reported` (never `last_changed`).
*Accept:* a sensor stuck on the same value still shows a growing age; battery at
15 % warns; `unavailable` reads as offline, not "no data".

**FR-17 — Spots (M)**
The lights that are on, as a chip row of `name · how long on` (e.g. `TV / Lareira ·
3h`), ordered by duration desc, max 3 chips + overflow. Tapping a chip toggles that
light; the section hides when no light is on.
*Accept:* turning a light off removes its chip without a reload; a light on for 3 h
reads `3h`, 4 min reads `4 min`; all-off hides the whole section including its label.

**FR-18 — Groups with per-domain renderers (M)**
Groups declared per area, each a bordered row (mockup: "AC Sala", "Persiana Sala",
"RASGO E SANCA"), rendered by domain:
- `climate`: state + current + `hvac_action` age, power button, target-temperature
  stepper (`− 20 °C +`), mode chips when `hvac_modes` > 2.
- `cover`: position (`Aberto 33%`), age (`Há 5 h`), up/stop/down, slider when
  `current_position` exists.
- `light` group: dimmer slider with % read-out, colour/effect button when supported.
- `fan` / `humidifier` / `dehumidifier`: toggle + speed/target where supported.
- unknown domain → generic row (icon, name, state, toggle).
*Accept:* each renderer degrades to a generic row when a needed attribute is
missing; a cover without `current_position` shows no slider; a light group with 3 of
4 on shows the count.

**FR-19 — Openings section (M)**
Doors and windows of the area: open ones first, `name · state · age`, `on` = open,
count in the section label. Hidden when the area has no opening.
*Accept:* opening a door moves it to the top and updates the label count live.

**FR-20 — Bundles (upstream/downstream) (M)**
A group whose `main` control has `downstream` devices renders the upstream row plus
its downstream as **child rows inside the same bordered block** (mockup: Persiana
Sala → Corredor `Fechado`, Varanda `Grande · Pequena`). Children collapse behind a
disclosure by default; expanding them does not collapse the panel and pauses the
timer. `upstream:` on a device declared elsewhere adds it under that parent and
shows a back-chip. Depth limit 2.
*Accept:* "Todos da Sala" shows 3 downstream rows collapsed; expanding does not
trigger the card-level collapse; a recursive declaration cannot loop.

### 4.5 Siblings, editor, states

**FR-21 — Mini-tiles (M)**
Siblings become ~96 px rectangles: icon, name, 1–3 bubbles with counts (defaults:
doors, windows, lights-on). No temperature, no power (per mockup). Bubbles
configurable per card and per area; overflow → `+N`.
*Accept:* 8 siblings at 3 columns remain legible; bubble text never clips; tapping a
mini-tile expands that area (retarget).

**FR-22 — Visual editor (M)**
`getConfigElement` with sections **Card** (floor/areas/columns/tile height/timer/
panel width), **Areas** (list, reorder, per-area overrides with `auto` vs
`override` state and reset), **Circles & pills** (domains, behaviour, include/exclude,
opening types), **Detail** (sensors, battery, groups, spots, openings, bundles).
Entity/icon pickers only. `getStubConfig` returns a valid empty card.
*Accept:* a card built in the editor renders identically to the YAML in `examples/`;
clearing an override restores the auto value immediately.

**FR-23 — Empty, error, loading states (M)**
No areas → "No areas on this floor" + editor hint. Registry/Energy failure → render
what is possible + one visible error row (never a silent heuristic fallback). Loading
→ skeleton tiles matching final geometry.

### 4.6 Parked (explicitly out of scope now)

**FR-24 — Expand-all (C, Phase 5)** all areas at once in a stacked formation, first
on top, each showing a compact summary; one chevron per stack.

---

## 5. Design decisions

Options → recommendation → why. Numbers match §14.

### D1 — One card per floor, or one card per area? **→ one card per floor**

| Option | Pros | Cons |
|---|---|---|
| A. One card per **area** (like `hierarchy-area`) | Simple element, exists already | No shared state: expanding one cannot shrink siblings; no single timer; no expand-all; one render cycle per area |
| B. One card per **floor** (N tiles) | Shared layout state, one timer, one render cycle, expand-all free, masonry reflow possible | Bigger element; area list must be resolved |
| C. Both: floor card + standalone area card | Floor card on the dashboard, single-area card elsewhere | Two entry points — cheap once the panel renderer is shared |

**Recommendation: B now, C as a thin wrapper in Phase 5.** The morph *is* the
feature, and it is a property of the whole grid (siblings shrinking, one panel,
one timer, later a stack). Per-area cards could only fake it with a cross-element
event bus and absolute positioning, and it breaks on reload. Per-area *config* is
not lost: `areas[]` carries full overrides inside the floor card. The mockups
confirm this reading — the mini-tiles are sized by what the panel left over.

### D2 — Component identity **→ new element `glance-areas` in `glance-plus`**

Do not extend `hierarchy-areas` (superseded, different semantics) or `hierarchy-area`
(one area, different lifecycle). New file `src/glance-areas.js`, same vanilla style,
no build step. Borrow `hierarchy-area`'s renderer by copy-adaptation, never refactor
it in place, until `glance-areas` is confirmed on live.
`hierarchy-areas` retirement is a separate decision (§13 Q6) — check consumers first.

### D3 — Single file or split modules? **→ single file, sections**

Live deployment is an **inline module resource**, so the card must load as one file.
Sections + one `VERSION` constant, like the existing cards. Past ~1 800 lines, ask
before splitting into `/local/glance-areas/*.js` (changes the deploy story).

### D4 — Layout engine **→ dense CSS grid, one-column vertical panel**

Grid with `--cols`; the expanded tile gets `grid-row: span 3` (measured, clamped
2–4) and `grid-column: span 1`; mini-tiles are `span 1`; `grid-auto-flow: dense` so
the remaining tiles fill the columns beside and below the panel — exactly the mockup
arrangement. Panel height animates from tile height to measured content height
(`ResizeObserver`), siblings animate to mini height at the same time.

Rejected: full-width panel (`grid-column: 1 / -1`) — contradicts the mockup and
wastes width in a phone-sized section. It stays as `expand.width: full` (opt-in,
Phase 3+) for wide desktop sections. Also rejected: animating
`grid-template-columns` (janky), FLIP libraries (needless dependency).

### D5 — Where temp/humidity come from **→ registry first, explicit override wins, never average**

1. `temperature:` / `humidity:` (explicit) — wins.
2. Registry: entities in the area with `device_class: temperature|humidity`.
3. Nothing → the segment is omitted (FR-06).
Multiple valid sensors are **not** averaged (an average of an indoor and an outdoor
sensor is a lie). Tile shows the first/declared; the panel lists all with a
"primary" marker.

### D6 — Power/energy source **→ Energy prefs, same as `hierarchy-power`**

Never hardcode sensors. `energy/get_prefs` → `device_consumption[]` → entities →
area; per-area override for the odd meter. Cache prefs per page, retry on failure.
One number everywhere: if the tile and the power card disagree, the card is wrong.

### D7 — Tile size **→ fixed height, width from the grid**

`tile_height: 260` (px) and width = column width. The portrait ratio in the mockup
is a consequence of a 768 px phone, not a rule; pinning `aspect-ratio` would make
tiles enormous on a wide desktop section. Internal row budget is fixed (identity /
readout / circles / pills), so the height never jumps when data appears.

### D8 — Timer ownership **→ one card-level timer, reset on interaction**

`_expanded`, `_deadline`, `_paused`. One timer per card. Rules in FR-14. No timer
while `document.visibilityState === "hidden"`.

### D9 — Bundles **→ inline child rows, timer paused**

Downstream renders as indented rows inside the parent's bordered block (per mockup),
not as nested cards and not as a card-level morph. Disclosure expands the block in
place; panel height animates; timer pauses while open; depth 2.

### D10 — Registry access **→ module-level cache, visible fallback**

`area_registry/list`, `floor_registry/list`, `energy/get_prefs` are admin-only in
some setups. Cache once per page, invalidate on `area_registry_updated` /
`floor_registry_updated`, and on failure render the explicit config plus one console
warning + one discreet card hint. **Never** invent names from entity IDs (that path
is what made `ambient-glance` hostile — `ambient-glance-audit.md` §P0.4).

### D11 — `hold` **→ membership, not visibility**

In `hierarchy-area`, `hold` decides whether an area appears. Every area always has a
tile here, so `hold` is re-pointed: it decides which switches/lights contribute to
the lights circle badge and to "something is on". Defaults stay `hierarchy-area`'s
(switches hold, lights hold only in switch-less areas). No hiding, ever.

### D12 — Colour and badges **→ tint means "has active members"**

Circle/pill background = domain colour at ~18 % + solid icon when count > 0;
transparent + hairline when 0. Badge only when count > 0. This is why the mockup has
no "N more on": the counts already say it. No full-tile tinting (reads as an alarm),
no colour-only meaning.

### D13 — Time and numbers **→ HA locale, relative time**

`Intl.RelativeTimeFormat`/`NumberFormat` with `hass.locale` (`Há 5 h`, `4 min`,
`22,5` in pt-PT). Durations use a compact ladder (`<1 min`, `4 min`, `3h`, `2d`).
Units from `hass.config.unit_system`, never hardcoded.

---

## 6. Configuration contract

Draft schema. Keys marked `auto` may be omitted; every derived value can be
overridden. `examples/` must contain a working instance.

```yaml
type: custom:glance-areas
title: "Primeiro"          # optional, hidden by default
floor: primeiro            # floor_id; omit when areas: is explicit
columns: 3
tile_height: 260
areas_mode: auto           # auto | explicit

expand:
  timeout: 20              # seconds; 0 = never
  width: column            # column (mockup) | full (wide sections, later)
  pause_on_focus: true
  pause_on_bundle: true
  countdown: false

areas:
  - area: sala
    name: Sala             # override
    icon: mdi:sofa         # else registry
    accent: "#818cf8"
    temperature: sensor.sala_temp      # explicit primary (D5)
    humidity: sensor.sala_hum
    power: { entity: sensor.sala_power }        # else Energy prefs (D6)
    energy: { entity: sensor.sala_energy_today }
    climate: climate.sala_ac
    controls:                     # hierarchy-area shape: the lights circle's pool
      - entity: switch.sala_triplo_0_left
        hold: true                # the checkbox: counts as a holder
        downstream: [light.sala_triplo_0_center]   # never counted / never switched off
      - entity: light.led_strip_rgbw_2
        hold: false
    circles:
      - type: climate
        behavior: focus
      - type: covers
        behavior: focus
      - type: lights
        behavior: toggle_off      # opt-in; confirm: true to require a second tap
        include: [light.sala_teto, light.sala_led]
        exclude: [light.sala_frigorifico]
        hold: auto                # D11
    openings:                     # pills + panel section
      doors: [binary_sensor.sala_porta]
      windows: [binary_sensor.sala_janela, binary_sensor.sala_varanda]
    bubbles: [doors, windows, lights]     # mini-tile; max 3
    detail:
      presence: binary_sensor.sala_movimento
      battery: [sensor.sala_temp_battery]
      sensors: [sensor.sala_temp, sensor.sala_hum]
      groups:
        - name: Luz
          type: light
          entities: [light.sala_teto, light.sala_led]
          dimmer: true
          color: true
        - name: Shutters
          type: cover
          main: cover.sala_all
          downstream: [cover.sala_janela, cover.sala_porta, cover.sala_varanda]
        - name: AC
          type: climate
          entity: climate.sala_ac
```

Rules:

- Unknown keys are ignored at render time but flagged by the editor (no crash).
- `circles` order is render order; `type` required; unknown `type` → skipped with a
  console warning; max 3.
- `bubbles` > 3 → extras dropped with a warning.
- `areas: []` + `areas_mode: explicit` is a valid empty card (FR-23).
- No device IDs anywhere. `entity_id` only (AGENTS.md / best-practice rule).

---

## 7. Behaviour spec

### 7.1 State machine

```
collapsed ──(tile body / name / chevron / Enter)──▶ expanding
expanding ──(anim 220ms)──▶ expanded(area)
expanded(A) ──(tap tile B / mini-tile B)──▶ retarget(A→B, no collapse)
expanded ──(timer / same tile / Esc / chevron)──▶ collapsing ──▶ collapsed
expanded ──(bundle disclosure open)──▶ expanded(paused)
```

Invariants: at most one `expanded`; the panel is always one column wide; focus never
lands on a hidden element; collapse always returns focus to the tile.

### 7.2 Timer rules (testable)

| Event | Effect |
|---|---|
| expand | `deadline = now + timeout` |
| `pointerdown` / `keydown` / `input` / `change` inside panel | reset deadline |
| panel scrolled | reset deadline |
| `focus-within` (if `pause_on_focus`) | pause |
| bundle open (if `pause_on_bundle`) | pause |
| tab hidden | pause; recompute on visible |
| collapse / retarget | clear timer |
| `timeout: 0` | no timer at all |

### 7.3 Render contract

- One `requestAnimationFrame`-coalesced render per hass change; signature-gated.
- Shared 60 s tick for ages/countdowns (module-level, like `hierarchy-area`).
- Expanding must not rebuild the card's DOM (toggle classes + measure only).
- Service calls: optimistic state is **not** faked; the card waits for `hass`.

---

## 8. Visual spec (from mockup, per §1.3)

| Token | Value |
|---|---|
| tile | 100 % width × `tile_height` 260 px, radius 20, padding 14 |
| tile background | `rgba(255,255,255,0.05)` over the card background (mockup: near-black, no border) |
| tile grid | 3 cols, gap 12 |
| area icon | 28 px, muted when nothing active, accent when active |
| readout | 16 px, tabular-nums, right-aligned, 2 lines max, 4 px gap |
| name | 22 px / 600, ellipsis, margin-top 6 |
| circles | 44 px, gap 10, icon 20, badge 16 at top-right (−4 px offsets) |
| pills | 30 px tall, radius 15, padding 0 10, icon 16, count 13 |
| chevron | 30 px circle, centred, rotates 180° when open |
| mini-tile | height 96, radius 18, icon 26, name 18/600, bubbles 22 |
| panel | one column, radius 20, padding 14, sections gap 10 |
| micro-label | 11 px uppercase, +0.08 em, muted, 6 px above its block |
| detail row | min-height 56, radius 12, `rgba(255,255,255,0.04)`, hairline `rgba(255,255,255,0.08)` |
| chip (spot) | height 34, radius 10, hairline; selected = accent border + 10 % accent |
| enter animation | 220 ms `cubic-bezier(.2,.8,.2,1)`; content opacity 120 ms |

Colour: reuse `hierarchy-*` domain colours so the family reads as one system
(`light #fbbf24`, `switch #34d399`, `fan #38bdf8`, `cover #2dd4bf`, climate heat
`#fb7185`; the mockup's violet is the accent, not a domain colour). No new palette.

Accessibility: every icon-only control has `aria-label`; panel is `role="region"`
with `aria-labelledby`; chevron `aria-expanded`; `Esc` closes; focus trapped only
inside an open bundle; `prefers-reduced-motion` honoured; contrast ≥ 4.5:1 for the
11 px micro-labels.

---

## 9. Editor spec

Element `glance-areas-editor`, `ha-form`-based, one accordion per section:

1. **Card** — title, floor picker, columns, tile height, areas mode, timer, panel
   width.
2. **Areas** — ordered list; row: area picker, icon, name, accent, `auto`/`override`
   badge per field, reset to auto, ↑↓ reorder.
3. **Circles & pills** — per area: three circle slots (type, behaviour, confirm,
   include/exclude, hold), opening types and entities, bubble order.
4. **Detail** — presence, battery, sensors, groups (type, entities, main +
   downstream, dimmer/colour), spots limit.
5. **Bundles** — upstream/downstream mapping with a back-reference warning.

Non-negotiables: pickers only for entities (never free text), delete always
available, `config-changed` emitted immediately (live preview), editor never writes
derived values into YAML (only overrides).

---

## 10. Build plan

Phase boundaries are review gates. Do not start a phase before the previous one is
confirmed on live.

### Phase 0 — Skeleton and test surface (½ day)

- [ ] `src/glance-areas.js`: element, `setConfig`, `hass`, `VERSION`,
      `getConfigElement`, `getStubConfig`, empty render.
- [ ] `test/glance-areas.mjs` jsdom harness (copy `test/load.mjs` pattern).
- [ ] New view **`glance-test`** on the `home-test` dashboard (back up the dashboard
      JSON first) with one empty card.
- [ ] `examples/home-test-glance-areas.json` stub.
- **Exit:** card adds from the picker with no red error; test green; view live.

### Phase 1 — Collapsed grid to mockup geometry (2–3 days)

FR-01 … FR-11. Resolver (floor/areas/sensors/power/openings) + tile render + circles
+ pills + icon table + readout omission rules + tile height + editor stub
(card + areas only). Visual target: `mockup-collapsed.png` at 3 columns.
- **Exit:** live view matches the mockup at 3/6/9 areas (screenshot diff by eye),
  readouts match `hierarchy-power`, circles act, editor adds/removes/reorders areas.

### Phase 2 — Vertical morph shell (2 days)

FR-12 … FR-14, FR-21 (mini-tiles, placeholder panel body). Dense-grid reflow,
height animation, timer, keyboard, focus return.
- **Exit:** expanding any tile at 9 areas leaves 8 legible mini-tiles with no
  overlap or clipping; timer matrix green; `Esc` returns focus; no scroll jump.

**Status 2026-11-20: built on the test instance.** The panel spans as many 96 px
mini rows as its content needs (3–10, measured), siblings reflow around it with
`grid-auto-flow: dense`, `Esc` collapses and returns focus, and the timer
matrix is unit-tested (pause/resume keeps the remaining time). Phase 3 replaces
the placeholder panel body.

### Phase 3 — Panel contents (3–4 days)

FR-15 … FR-19, FR-22 detail sections of the editor.
- **Exit:** Sala panel matches `mockup-expanded.png` block for block
  (header strip, spots, dimmer group, AC row, cover row); an area with no climate
  and no covers degrades cleanly.

### Phase 4 — Bundles, states, polish (2 days)

FR-20, FR-23, a11y pass, error/loading states, `README.md` + `REQUIREMENTS.md`
updates.
- **Exit:** "Todos da Sala" with 3 downstream expands inline, timer pauses, depth
  limit holds; reduced-motion pass; a11y checklist.

### Phase 5 — Parked

FR-24 expand-all stack; `glance-area` standalone wrapper (D1 option C); sparklines;
`expand.width: full`; `hierarchy-areas` retirement decision.

---

## 11. Test plan

### 11.1 Unit (jsdom, no browser)

- Resolver: floor→areas, area→temp/humidity (registry + override + multiple),
  area→power (Energy prefs fixture), openings per type, non-admin fallback.
- Config normalisation: unknown keys, >3 bubbles, >3 circles, bad circle type,
  empty areas.
- Timer: fake-clock matrix from §7.2.
- Icon table: every documented state → expected icon; unknown → fallback.
- Formatting: °C, °F, pt-PT decimals, duration ladder (`<1 min`, `4 min`, `3h`, `2d`).

### 11.2 Render checks

`test/render-check.mjs` pattern: collapsed 3/6/9 areas, one panel, one bundle open;
assert no `NaN`, no `[object Object]`, no duplicated `id`, every icon-only control
has an accessible name, tile height equals `tile_height` for 1-line and 2-line names.

### 11.3 Visual

`node make-preview.mjs` (pulls live states) + headless Chromium at 768 px and
1200 px: collapsed floor, expanded Sala, bundle open. Keep PNGs in `docs/mockups/`
and compare against the two renders each phase.

### 11.4 Live acceptance (the real gate)

1. Hard-refresh `home-test` → `glance-test`.
2. **Match check:** tile power equals `hierarchy-power` for the same area.
3. **Action check:** lights circle turns off exactly its set; covers badge follows
   real shutters; AC mode changes the icon.
4. **Timer check:** panel closes at ~20 s; interaction extends; bundle pauses.
5. **Degradation:** rename an area → tile updates; sensor unavailable → segment
   disappears (not `—`); area without openings → chevron alone; non-admin → tiles.
6. **Regression:** `glance-plus`, `hierarchy-area`, `hierarchy-power` unchanged.

---

## 12. Guardrails for the executing agent

- **Historical data is untouchable.** No `recorder/*`, no `clear_statistics`, no
  unit changes on sensors, no deleting helpers/entities. Nothing here needs it.
- **Dashboard changes are config-only and backed up first** (`apply-live-card.mjs`
  backs up the resource; a view addition needs the dashboard JSON backed up too).
- **Live first, repo second:** edit `src/` → apply to the live inline resource →
  user confirms on live → only then build/commit/push.
- **Node only** (no `python`), never stream large series into chat.
- **No secrets in files or git remotes**; read from `/workspace/HA/.secrets/` into a
  throwaway env var.
- **Don't touch other cards' files** in Phase 0–4 (borrow by copy, not refactor).
- **Ask, don't guess,** on: splitting the module, retiring `hierarchy-areas`,
  changing a sensor's unit, anything that writes to the recorder.

---

## 13. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Confirm card name `glance-areas` / element `custom:glance-areas`? | use it |
| Q2 | Circle tap: `focus` (expand + scroll) or act immediately? | `focus`; `toggle_off` opt-in |
| Q3 | Does "lights off" need a confirm step? | single tap, `confirm` opt-in |
| Q4 | Temperature source when several sensors exist: declared primary or first found? | declared, else first |
| Q5 | What replaces `hierarchy-areas` on existing dashboards, and when? | keep it, decide Phase 5 |
| Q6 | Sparkline / 24 h trend in the panel — in or out? | out (Phase 5) |
| Q7 | Panel width on a wide desktop section: still one column? | one column now, `full` in Phase 5 |
| Q8 | Multi-floor view: one card per floor stacked, or one card with floor groups? | one card per floor |
| Q9 | Timer: 20 s is short for a panel this dense — 20 or 30 s default? | 20 s (your call), revisit on live |
| Q10 | Spots: which lights qualify (all on, or only `hold` ones), and cap at 3? | all on, cap 3 + overflow |
| Q11 | Should the panel open from another card (deep link / `hold_action`)? | tap only for now |
| Q12 | Mockup fidelity: pixel match or "spirit of"? | spirit; pixels only for §8 tokens |

---

## 14. Decision & change log

| # | Date | Decision |
|---|---|---|
| 1 | 2026-11-19 | Plan created; one card per floor (D1), new element (D2), single file (D3). |
| 2 | 2026-11-19 | Power/energy resolver reuses `energy/get_prefs`; no hardcoded sensors (D6). |
| 3 | 2026-11-19 | Derived values never averaged; explicit override always wins (D5). |
| 4 | 2026-11-19 | Registry failure must be visible, never a silent heuristic fallback (D10). |
| 5 | 2026-11-19 | **Mockups received; v2.** Tiles are portrait, not square (D7). |
| 6 | 2026-11-19 | **Panel is one column wide and vertical, siblings reflow around it** — replaces the full-width drawer (D4). |
| 7 | 2026-11-19 | Collapsed controls are domain circles with count badges + two opening pills; `hold` re-pointed to membership (D11, D12). |
| 8 | 2026-11-19 | Missing data is omitted in the tile, not placeholdered (FR-06, FR-07). |
| 9 | 2026-11-19 | Panel gains spots, presence and light-group dimmer/colour renderers (FR-15, FR-17, FR-18). |
| 10 | 2026-11-19 | **Phase 1 built** on branch `mvp` (live view `home-test` → `OpenCode MVP`). §8 correction: re-measured against `mockup-collapsed.png` — area icon ≈36 px (not 28) and tile padding ≈18 px (not 14); implemented as 34/16 so three columns still fit a 768 px section. |
| 11 | 2026-11-19 | D12 amended: circles use the mockup's **accent** tint (violet), not per-domain colours. The tint still means "has active members"; badges stay amber. |
| 12 | 2026-11-19 | Registry-derived control pools skip `entity_category: config/diagnostic` and hidden/disabled entities — otherwise a room's Tuya config switches inflate the lights badge. |
| 13 | 2026-11-19 | Phase 1 `focus` opens HA's own more-info dialog as the stand-in for the Phase 2 panel; the chevron is rendered but inert (`aria-disabled`). |
| 14 | 2026-11-19 | FR-11 "expand" cannot land before FR-12/13 (the panel is Phase 2), so Phase 1 ships the affordance only. Recorded as a contract conflict. |
| 15 | 2026-11-19 | Lights circle merges hierarchy-area's `hold` semantics: `controls[]` (entity, hold, downstream) on an area drives the pool; badge and `toggle_off` use the holder set only, and a downstream device is excluded from both. Auto mode uses D11's area-level rule. |
| 16 | 2026-11-19 | Power at ~0 W is omitted from the tile (same "no signal, no line" rule as an unmapped area). |
| 17 | 2026-11-19 | Development moved to the test instance: `HomeTest` dashboard (`home-test`) with mock covers/lights/climate/doors/windows. Live stays on the Phase 1 build until the test work is confirmed. |
| 18 | 2026-11-19 | Debt: `focus` → more-info is a stand-in; decide focus vs toggle per circle before Phase 2 controls land. |
| 19 | 2026-11-20 | Tile chrome tightened per review: padding 12, gap 10, name 20 px, readout 14 px, power 13 px, circle icon 23 px, thinner ring. Door/window are 34 px round nubs parked in the bottom corners with the same floating count badge; the chevron lost its outline and sits on the bottom rail. |
| 20 | 2026-11-20 | Phase 2 built: one open panel at a time, siblings become 96 px mini-tiles with `grid-auto-flow: dense`, panel spans 3–10 measured 96 px rows, `Esc` collapses and returns focus. `focus` on a circle now opens the panel (more-info debt resolved). |
| 21 | 2026-11-20 | Timer pauses keep the **remaining** time (focus/hidden tab); a full reset happens only on interaction. Tab-visibility and card-rebuild `focusout` no longer restart the countdown. |
