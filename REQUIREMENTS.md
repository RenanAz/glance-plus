# Glance Plus — Requirements

Living document. Append a row to **Decisions** and to **Changelog** whenever a
requirement changes; do not rewrite history.

Status: v1 card written and in daily use; stage 1 confirmed
user verdict. Stage 1 (glance + auto-entities) confirmed the limits that justify
the card.

## 1. Goal

One Lovelace card that shows a compact, formally aligned grid of cells for the
parts of the house that matter, where every cell can be filtered, labelled and
coloured from Jinja, with a card-level background.

It replaces the "chip row" pattern (mushroom chips + conditional chips) with a
fixed grid that does not reflow and does not need one YAML block per entity.

## 2. Scope (v1)

- `custom:glance-plus` card, single custom element, no framework, no build deps
  beyond Node concatenation (same model as `hierarchy-cards`).
- Cells: `entity`, `name` (Jinja), `icon`, `color` (Jinja), `background`
  (per-cell), `show_if` (Jinja bool, or HA-native condition object),
  `tap_action` / `hold_action`, optional `span`.
- Card options: `title`, `columns`, `gap`, `background`, `cell_background`,
  `state_color` shorthand, `show_empty`.
- Jinja rendered **server-side, batched**: one `render_template` call per
  render cycle returns all cells; never one call per cell.
- Fixed grid layout: equal columns, fixed row height, ellipsis, icon+text
  aligned; no reflow when a cell disappears (unlike glance columns).
- Card background: any CSS colour / HA token.

## 3. Non-goals (v1)

- No section-level background (a card cannot style its HA section; needs theme
  or card-mod). Card only.
- No visual config editor for `cells` (YAML only). `getConfigForm` for the
  card-level options later.
- No charting, no actions beyond tap/hold, no per-cell history.
- Not a replacement for `hierarchy-power-card` / `hierarchy-energy-card`.

## 4. Behaviour details

- `show_if` false → cell omitted from the grid (not hidden with a gap).
- Template error → keep last good render, show a small red badge; never blank.
- Re-render only when an entity referenced by the config changes, throttled
  (~500 ms), same pattern as `HierarchyPowerCard`.
- `state_color: true` → icon/value yellow when `on`, otherwise theme colour.
- Explicit `color` overrides `state_color`.
- Missing entity → cell rendered as unavailable, not dropped.

## 5. Constraints

- Live-first workflow: edit `src/`, apply to the live inline resource via
  the live inline resource, confirm on a test dashboard, then
  build + commit + push.
- Dashboards are config-only; no entity/statistics history is touched.
- Test surface: dashboard `home-test` (`/home-test`), Home view copy.

## 6. Decisions

| # | Date | Decision |
|---|------|----------|
| 1 | 2026-11-02 | New standalone repo (not a card inside `hierarchy-cards`). |
| 2 | 2026-11-02 | "Background" means the card background, not the HA section. |
| 3 | 2026-11-02 | Requirements tracked in this file, updated per change. |
| 4 | 2026-11-02 | Stage 1 (auto-entities + glance feasibility) runs before the card is written. |
| 5 | 2026-11-02 | Test dashboard `home-test` contains the Home view only. |
| 6 | 2026-11-02 | One card per top-level category (Energy & Power, Appliances, Car, Doors & Windows, …), replacing heading + chip row. |
| 7 | 2026-11-02 | Comparison layout: new section on `home-test` holds the category cards beside the original section. |
| 8 | 2026-11-02 | Card-level `show_if` added: the whole card (header included) hides when nothing is worth showing, not only the cell grid. |
| 9 | 2026-11-02 | Header is the expand control: clicking toggles `toggle_entity` (`homeassistant.toggle`); chevron shows the helper state. Replaces the separate `show_*` chip row per category. |
| 10 | 2026-11-02 | `name` is the only cell text field (Jinja). No name → formatted state. `color` paints the icon only, matching the chips. |
| 11 | 2026-11-02 | `show_if` is Jinja-only. Native condition objects deferred: they cannot be evaluated in the batched Jinja render without a JS-side evaluator. |
| 12 | 2026-11-02 | Deferred to v2: visual editor. YAML for now; the HA YAML editor still works from the UI. |
| 13 | 2026-11-02 | Cells are omitted, not space-reserved, when hidden: columns stay fixed, positions compact. Revisit if the shifting looks jumpy. |
| 14 | 2026-11-02 | Supersedes 8: the header always renders and `show_if` gates the grid only, so the expand arrow is always reachable. |
| 15 | 2026-11-02 | `blocks` inside a card: optional label/icon, own `columns`, and `color`/`background`/`show_if` defaults for its cells. Rendered in config order; an empty block is skipped with its label. |
| 16 | 2026-11-02 | Supersedes 12: visual editor shipped as `glance-plus-editor` in the same module — card options, cells, blocks, colour swatches, entity/icon pickers. |
| 17 | 2026-11-02 | Cell text takes `\n` as line breaks; title defaults to left-aligned. |
| 18 | 2026-11-19 | New card `glance-areas` (one floor per card) starts as Phase 0+1 of `docs/glance-areas-PLAN.md`; built on branch `mvp`, test surface is the `OpenCode MVP` view on `home-test`. |
| 19 | 2026-11-19 | Phase 1 keeps the mockup's accent-tinted circles instead of per-domain colours (D12): tint still means "active member", and the badge stays amber. |
| 20 | 2026-11-19 | Registry-derived circles skip `entity_category: config/diagnostic` and hidden/disabled entities; otherwise a room's Tuya config switches would inflate the lights badge. |
| 21 | 2026-11-19 | In Phase 1, `behavior: focus` opens HA's own more-info dialog as the stand-in for the Phase 2 detail panel; the chevron is rendered but inert. |
| 22 | 2026-11-19 | Lights circle adopts `hierarchy-area`'s hold rule: **only holders are counted and only they are switched off**. `controls[]` (entity, `hold`, `downstream`) on an area overrides the registry pool; a downstream device is never counted and never switched off on its own. |
| 23 | 2026-11-19 | A power meter at ~0 W draws no line (rounded to 0 W). |
| 24 | 2026-11-19 | **Debt:** `focus` → more-info is a Phase 1 stand-in. Decide "focus/expand" vs "toggle" per circle before Phase 2 ships controls. |
| 25 | 2026-11-19 | Development moved to the **test instance** (192.168.70.103): dashboard `home-test` (HomeTest, views Home/Lab/Wide) with mock covers, lights, climate, doors/windows and temp/humidity. |
| 26 | 2026-11-20 | Visual pass: tighter tile padding, smaller name/readout/power, bigger circle icons, door/window as round corner nubs with floating badges, borderless chevron on the bottom rail. |
| 27 | 2026-11-20 | Phase 2: open panel is one column, spans measured content height in 96 px rows; siblings are mini-tiles with door/window/lights bubbles; retarget and `Esc` keep exactly one open. |
| 28 | 2026-11-20 | Timer pauses preserve the remaining time; only a real interaction resets it. `focus` on a circle expands the panel (the more-info stand-in is gone). |
| 29 | 2026-11-21 | Supersedes 28: circles never expand. `auto` = more-info for a single entity, turn-off for a multi switch/light set. Expand is icon / name / chevron only. |
| 30 | 2026-11-21 | Supersedes D4: the tab opens in place and the detail block spans the full card width right after the expanded row; everything below is pushed down in order. Header 120, mini 90, gap 6. |
| 31 | 2026-11-21 | Panel renders `controls[]` plates with their `downstream` chips (hierarchy-area parity); auto areas list their registry switches/lights. |
| 32 | 2026-11-21 | Detail block gets a container outline; the metric row is a borderless subtitle with icons for temp / humidity / presence age / battery and a divider before power + energy. |
| 33 | 2026-11-21 | Slim tab 90 px: name on top, icon + readout at the bottom, chevron top-right. |
| 34 | 2026-11-21 | Door/window back to the mockup pill with a suspended count badge, parked in the bottom corners. |
| 35 | 2026-11-21 | v0.3.0 deployed to **prod** (live inline resource) on `home-test` → `OpenCode MVP`. |

## 7. Open questions

1. Card name: `glance-plus` (current working name) confirmed?
2. ~~Per-cell `span` in v1, or defer?~~ In v1 (`span: N`).
3. Do we need a second layout mode (dense list vs tile grid) or is one grid enough?
4. Where should card-level defaults live — card config only, or also a theme variable?
5. Does the card replace the category chip rows + headings on the live dashboard,
   or coexist with them for a while?

## 8. Changelog

- 2026-11-02 — file created from the plan agreed in session (goal, scope,
  non-goals, decisions 1–5, open questions).
- 2026-11-02 — decisions 6–7 added (one card per top-level category; comparison
  section on `/home-test`); Stage 1 feasibility prototype confirmed working
  (Jinja labels + per-cell filtering via `auto-entities` template filter).
- 2026-11-02 — v1 card implemented (`src/glance-plus.js`): fixed grid, one batched
  `render_template` call, Jinja title/name/icon/colour/background/show_if, header
  click toggles `toggle_entity`, card-level `show_if`, error badge keeps the last
  good render. Deployed as an inline resource and used for the four category
  cards in a test dashboard (decisions 8–13).
- 2026-11-02 — bugfix: HA 2026 `render_template` is a subscription — the command
  acks `result: null` and the render comes as an `event` (`{result, listeners}`
  or `{error}`). `_renderOnce` now subscribes via
  `hass.connection.subscribeMessage`, takes the first event and unsubscribes;
  the old request/response path stays as a fallback for older cores.
- 2026-11-02 — header always renders (grid-only gating); `hide_when_empty` removed
  because an empty card must still offer its expand arrow. Cell text defaults to
  12px (`font_size`), icons 16px (`icon_size`), cell height 32px. `blocks` added:
  each block has its own optional label, columns and colour/background defaults for
  its cells; blocks render in config order. Doors & Windows card split into
  `Doors` (red) then `Windows` (yellow).
- 2026-11-02 — cell text supports line breaks (`\n` → one ellipsised line each,
  cell grows to `min-height`); title defaults to left-aligned; visual editor
  shipped (`glance-plus-editor`): card options, per-cell fields with
  entity/icon pickers and colour swatches, blocks with add/delete/reorder,
  group-into-blocks and flatten. A config with neither `cells` nor `blocks` is
  now an empty card instead of a config error.
