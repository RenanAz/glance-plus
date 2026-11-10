# Glance Plus

A Lovelace card for compact, formally aligned grids of house state: per-cell
filtering, Jinja labels/colours, a small centred header that toggles a `show_*`
helper, and a card-level background.

Status: pre-release, running live on `/home-test`. Requirements and decisions
live in [REQUIREMENTS.md](REQUIREMENTS.md).

## Config

```yaml
type: custom:glance-plus
title: "Doors & Windows"        # Jinja allowed
icon: mdi:door                  # header icon, Jinja allowed
columns: 5
gap: 6px
cell_height: 32px
title_size: 14px
font_size: 12px                 # cell text
icon_size: 16px                 # cell icon
align_title: center             # or start
background: rgba(255,145,0,0.08) # card background (CSS colour / HA colour name)
cell_background: transparent     # default for every cell
state_color: false               # icon yellow when the entity is `on`
show_if: "{{ ... }}"             # gates the GRID only; the header always stays
toggle_entity: input_boolean.show_doors_and_windows  # header click target
cells:                           # simple grid
  - entity: sensor.power_meter_active_power
blocks:                          # or blocks, each with its own label + grid
  - name: Doors                  # Jinja allowed
    icon: mdi:door
    color: red                   # default icon colour for this block's cells
    background: transparent      # default cell background for this block
    columns: 4                   # overrides the card's columns
    show_if: "{{ ... }}"         # block gate (applied to each of its cells)
    cells:
      - entity: binary_sensor.d02_sotao_contact
        name: "Sótão"
        icon: mdi:door-closed
        show_if: "{{ is_state('binary_sensor.d02_sotao_contact','on') or is_state('input_boolean.show_doors_and_windows','on') }}"
        background: "{{ 'rgba(244,67,54,0.14)' if is_state('binary_sensor.d02_sotao_contact','on') else 'transparent' }}"
  - name: Windows
    icon: mdi:window-open-variant
    color: yellow
    columns: 5
    cells: [ ... ]
```

Per cell: `entity`, `name`, `icon`, `color`, `background`, `show_if`, `span`,
`tap_action`. A block's `name`/`icon`/`color`/`background`/`show_if` are defaults
for its cells; a cell value always wins.

- Newlines in a rendered cell text become separate lines (each ellipsised on its
  own); cells grow to `min-height: cell_height` accordingly.
- Title defaults to left-aligned (`align_title: start`).
- Every Jinja field is rendered server-side in **one** `render_template`
  subscription per refresh, not one per cell.
- The header (title, icon, expand arrow) **always renders**, even when the grid
  is empty — that is the way back to "show all". Only the grid is conditional.
- A block with no visible cell is skipped entirely, label included.
- `name` is the cell text. Without it the entity's formatted state is used
  (`on`/`off` stays raw — template the name for contacts).
- `color` paints the icon only. HA colour names (`red`, `yellow`, `accent`)
  resolve to theme variables; anything else passes through as CSS.
- `show_if` takes Jinja only (`{% %}` blocks are not supported inside cell
  fields; use one `{{ ... }}` expression).
- A template error keeps the last good render and shows a `!` badge whose
  tooltip carries the error.

## Gotchas

- **`render_template` on HA 2026 is a subscription, not a request/response.**
  `callWS` acks with `{success: true, result: null}`; the render arrives as an
  `event` message `{result, listeners}` or `{error, level}`. Use
  `hass.connection.subscribeMessage()` and unsubscribe after the first event
  (`src/glance-plus.js: _renderOnce`). Reading `.result` from the ack always
  gives null.
- Jinja `|int` / `|float` with no default raise on `unknown`/`unavailable`, and
  one raise kills the whole batched render — always `|int(0)` / `|float(0)`.
- Time templates (`now()`) never change a state signature; the card re-renders
  them on a 60 s tick.

## Deploy (live-first)


Live HA serves this card as an inline Lovelace resource
`7bb0f762cab94e569fefd78ebe203a46` (`module`).

```bash
node /workspace/HA/apply-live-card.mjs /workspace/glance-plus/src/glance-plus.js GLANCE-PLUS
```

Backs up the current live content to `/workspace/HA/live_card_backups/` first.
Only build/commit/push after the user confirms the change on live.

## Visual editor

`Edit card` → visual editor (element `glance-plus-editor`, same module). Covers
card options, per-cell fields (entity/icon pickers, text, colours, `show_if`,
span) and blocks: add/delete/reorder blocks, add/delete cells, group cells into
blocks, flatten blocks back to cells. Colours are a text field (accepts CSS or
Jinja) plus a native colour swatch that writes a hex value.

Not yet: drag-and-drop reordering of cells, live preview of Jinja while typing.

## Not yet

- Native `show_if` condition objects — Jinja only.

## Checks (no browser needed)

Run from the repo root:

```bash
node test/render-check.mjs    # renders examples/home-test-cards.mjs on live HA (ha_eval_template)
node test/paint.mjs           # builds card HTML with stubbed states; checks header/blocks/lines
node test/editor.mjs          # jsdom test of the visual editor (npm i jsdom first)
node test/fetch-subscription.mjs  # render_template subscription path against the test HA
```

`examples/home-test-cards.mjs` is the source of the four cards currently on
`/home-test`; `scripts/patch-home-test.mjs` writes them to that dashboard.

---

# Hierarchy Area (`custom:hierarchy-area`) — current

One area per card, stacked like cards. Replaces the multi-area card below in
`/home-test`; the older `hierarchy-areas` resource is kept but unused.

- **Compact until needed.** Collapsed shows the header and only entities
  that are ON, all in ONE flat grid (no plate groups). Tap the header or the
  chevron to expand: every declared entity appears, grouped by plate.
- **Header inside the card by default.** Icon + name + chevron + master power
  form a top row inside the card. `header_style: title` lifts the same row
  above the card, outside its margins.
- **Brightness.** Every dimmable light that is ON — top-level control or
  downstream — is an embedded slider: the whole tile is the track and fill. A
  standalone light shows its timestamp next to the name; that one slot swaps to
  the live brightness percent while dragging and returns to the timestamp ~1.8 s
  after release. The icon toggles. Hold anywhere for more-info. Values are
  clamped to 1..100 and use a trailing throttled send, so the released value
  always lands.
- **Auto size.** `auto_size: true` (editor "Auto size") makes a collapsed card
  span 6 of 12 columns; expanding it, or showing it via a helper, spans 12.
  Collapsed grids shrink to the number of visible tiles, so a half-width card
  has no empty trailing columns.
- **Size is dashboard-owned.** Cards follow `grid_options` when auto size is off.
- **Grid and size.** `columns: 4` (changeable). `size: small | medium | large`
  (default **medium**) scales the area header font/icon plus tile height,
  padding, fonts, icons, rail and gaps together, so the proportions never
  change. Small = the 1.8.1 thin build (24 px light tile), medium = 28 px,
  large = 32 px.
- **Off** is a slim dark-red pill at the right end of the header, shown only
  while the card is active. It turns off every control with `hold` ticked and
  nothing else — downstream devices and unticked controls keep their power.
- **Area state = holding controls.** A card is "active" while a control marked
  `hold` is on. Switches hold by default; lamps/LEDs do not (unless the area
  has no switch at all). Untick "Holds card" in the editor to stop a control
  from keeping the card visible. Defaults are frozen into config on the first
  editor save, so adding a switch later cannot flip existing lights.
- **Visibility is generated.** HA's native card `visibility` is rebuilt from
  the controls marked `hold` plus `show_helper` — on every editor change and
  when the editor opens (HA persists on Save). Removing or renaming an entity
  drops it, so it cannot keep a card on screen; native visibility also removes
  the grid row completely (no blank space). Hand-authored (screen/user/etc.)
  visibility is detected and left alone. For raw-YAML or bulk changes run
  `scripts/sync-visibility.mjs` (see below).
- **Shared floor helper.** A `show_helper` can be shared by many cards (one
  per floor, driven by the floor heading): every card opens with all controls,
  and a tap collapses only that card. The helper is never turned off by a tap.
- **Bundles.** A switch with `downstream` encapsulates its devices in one
  blue box: the switch's icon, name and relative last change (min / h / d) sit
  on the left rail, the device sliders nest to the right. One downstream =
  half width, so two one-device switches sit side by side; two or more = full
  width. A downstream tile shows its own icon, a bold name and brightness
  percent. `hide_name_on` (editor: "Hide Name when On", **default on**) drops
  the switch name while it is on, leaving only its icon and last change on the
  rail. All secondary text is the same size.
- **Downstream visibility:** a bundle appears when its own switch is on, or when
  the card is expanded. A downstream that is on does NOT pull the bundle into
  the collapsed view.
- **Downstream power:** toggling a switch does **not** touch its downstream
  devices (they keep their own power). Set `follow: true` per control — or tick
  "With switch" in the editor — to switch them together.
- **Secondary info.** `secondary_info: last-changed | last-updated | none`
  (default `last-changed`, editor "Secondary info") picks the relative
  timestamp shown next to solo switch names and on switch rails.
- **Plate grouping:** consecutive controls with the same `group` render under
  that plate label when expanded. Collapsed mode drops labels.
- Hold any tile for more-info; with a keyboard use Shift+Enter or the Context
  Menu key. Colours: on = amber (light), blue (switch), cyan (fan), violet
  (boolean); each area has its own accent for the left trace and icon. All
  names are centred. Secondary text is 10 px at Medium.

Live inline resource: `57aef9a9bb594ebeaa09bee679a90244` (`module`).

```bash
node /workspace/HA/apply-live-card.mjs /workspace/glance-plus/src/hierarchy-area.js HierarchyAreaCard
```

```yaml
type: custom:hierarchy-area
name: Cozinha
icon: mdi:fridge-outline
accent: "#34d399"
columns: 4
size: medium             # small | medium | large
auto_size: true          # 6 col collapsed, 12 expanded
header_style: inside     # default; title = above the card
controls:
  - entity: switch.switch_cozinha_principal_left
    name: Luz teto
    group: Cozinha principal
    hold: true             # on = keeps the card visible
    downstream:
      - entity: light.switch_cozinha_principal_left
        name: Teto
  - entity: switch.leds_cozinha_lora1
    name: Leds cozinha
```

`group` is just a visual plate bucket; controls without it sit in the default
grid. Short form `downstream: [light.x]` is accepted. Editor (Edit card) covers
name, icon, accent, columns, header placement and the control list: entity
picker, name, plate, icon, downstream entity pickers, reorder and delete. Card options include header
placement and `hide_name_on`.

Editor architecture: **HA deep-freezes the config object carried by
`config-changed`** (`hui-dialog-edit-card` calls `deepFreeze(ev.detail.config)`).
The editor therefore emits a deep copy and keeps its own mutable `_config`;
mutating the emitted object made the second action throw. On top of that, one
delegated click listener on the shadow root resolves every action index against
the live config at click time, and the list is re-rendered from the model after
each change.

Reorder: drag anywhere on a row (the handle or its text) past a 5 px threshold.
Pointer move/up are bound to `window` in the capture phase, so it does not rely on
`setPointerCapture` (which fails inside some modals). Form controls are excluded
from dragging. Arrow Up/Down on the focused handle does the same from the
keyboard. Delete is the ✕ next to the row. Downstream devices are entity-picker rows (plus optional name
and remove), not free text.

Checks: `npm test` runs `test/hierarchy-area.mjs` (model/interaction, brightness)
and `test/editor-area.mjs` (jsdom editor).

Bulk visibility/hold sync (after raw-YAML edits or a control change outside the
editor):

```bash
HA_MCP_URL="http://host:port/private_token" node scripts/sync-visibility.mjs home-test
```

It loads `src/hierarchy-area.js` headlessly and applies the same rules; cards
with hand-authored visibility are skipped. Add `--dry` to preview.

---

# Hierarchy Areas (`custom:hierarchy-areas`) — superseded

A room/floor switch board. Idle areas stay collapsed as pills at the top; areas
with anything on expand below. Same left colour-trace language as the Hierarchy
Power/Energy cards.

Live inline resource: `246daea675f54b17aff4f50e5325679c` (`module`).

```bash
node /workspace/HA/apply-live-card.mjs /workspace/glance-plus/src/hierarchy-areas.js HierarchyAreasCard
```

## Behaviour

- **Two groups, fixed order.** Areas with nothing on = pills at the top; areas
  with something on = expanded rows below. Within each group, config order.
- **Tap a pill** to expand that area in place. **Tap an expanded area's name /
  icon** to collapse it. **Tap the card header** to expand everything
  ("show more"); tap again to collapse.
- **Master power** (the round button on the right of an expanded area) turns
  every listed entity in that area on/off. Omit with `toggle: false`, or point
  it at a helper with `toggle_entity:`.
- **Upstream → downstream.** Tapping a rocker also sets its `downstream`
  entities to the same state. Add `follow: false` to a downstream entry when it
  must stay independent (a smart strip on an always-live circuit).
- **Expanded areas show every declared entity**, on or off. Nothing is filtered.
- **Hold** any rocker or chip for more-info.
- Colours: off = muted slate; on = amber (light), emerald (switch), sky (fan),
  violet (input_boolean). Each area gets its own accent for the trace/icon, and
  the row only glows while the area has something on.

## Config

```yaml
type: custom:hierarchy-areas
title: 1º Andar
icon: mdi:home-floor-1
areas:
  - name: Cozinha
    icon: mdi:fridge-outline
    accent: "#34d399"        # any CSS colour; defaults to a palette entry
    toggle: true             # master power button (default true)
    plates:                  # one entry per wall plate
      - name: Cozinha principal
        rockers:
          - entity: switch.switch_cozinha_principal_left
            name: Luz teto
            downstream:
              - entity: light.switch_cozinha_principal_left
                name: Teto
          - entity: switch.switch_cozinha_principal_right
            name: Leds
    devices:                 # standalone entities, no wall plate
      - entity: switch.leds_cozinha_lora1
        name: Leds cozinha
```

Strings are accepted anywhere an entity object is (`devices: [light.x]`,
`downstream: [light.y]`), which is the short form when the default name/icon
from the entity is fine.

`plates[]` is only a visual grouping: a 3-gang rocker plate is one plate with
three rockers, and a second plate in the same area renders separately with its
own label. A rocker with `downstream` renders as a nested group (rocker on top,
device chips underneath) exactly like the reference mock.

## Checks

```bash
node test/hierarchy-areas.mjs   # model + interaction self-check, no browser
```

`/workspace/HA/glance-plus/` holds a browser preview harness:
`node make-preview.mjs` pulls the live states into `preview.html`, then open it
(normal + "show all" variants). `preview.png` is the rendered result.
