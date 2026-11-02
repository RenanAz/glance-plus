# Glance Plus — Requirements

Living document. Append a row to **Decisions** and to **Changelog** whenever a
requirement changes; do not rewrite history.

Status: pre-implementation (Stage 1 feasibility test running on `/home-test`).

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
  `/workspace/HA/apply-live-card.mjs`, user confirms on `/home-test`, then
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

## 7. Open questions

1. Card name: `glance-plus` (current working name) confirmed?
2. Per-cell `span` in v1, or defer?
3. Do we need a second layout mode (dense list vs tile grid) or is one grid enough?
4. Where should card-level defaults live — card config only, or also a theme variable?

## 8. Changelog

- 2026-11-02 — file created from the plan agreed in session (goal, scope,
  non-goals, decisions 1–5, open questions).
