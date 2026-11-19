# Agent brief — Glance Areas, Phase 0 + Phase 1

Paste this whole file as the prompt. The long-form contract is
`docs/glance-areas-PLAN.md` next to it.

---

## Mission

Build a new Lovelace card **`custom:glance-areas`** in `/workspace/glance-plus`
(new file `src/glance-areas.js`, same vanilla pattern as `src/hierarchy-area.js`,
no build step). It shows one floor as a grid of portrait area tiles; expanding one
tile turns it into a tall, one-column panel and shrinks its siblings to mini-tiles.

Deliver **Phase 0 and Phase 1 only**. Stop at the Phase 1 exit gate and report.

## Read first (in this order)

1. `docs/glance-areas-PLAN.md` — the contract. §2 nomenclature, §4 FRs, §6 schema,
   §8 visual tokens, §10 build order, §12 guardrails.
2. `docs/mockups/mockup-collapsed.png` and `mockup-expanded.png` — geometry and
   content authority. If a file is missing, ask before guessing.
3. `/workspace/glance-plus/REQUIREMENTS.md` — how this repo records decisions.
4. `/workspace/glance-plus/src/hierarchy-area.js` — the per-area renderer, `HA_HOLD`,
   `downstream`, editor patterns. Borrow by copy-adaptation.
5. `/workspace/HA/glance-plus/README.md` — preview + deploy recipe.
6. `/workspace/HA/AGENTS.md` — hard rules (historical data, live-first, node only).

If anything in those files contradicts `docs/glance-areas-PLAN.md`, the plan wins for
this card and you say so in your report.

## Scope

**Phase 0 — skeleton**
- `customElements.define("glance-areas", …)` with `setConfig`, `hass` setter,
  `VERSION`, `getConfigElement`, `getStubConfig` returning a valid empty card.
- `test/glance-areas.mjs` jsdom test (mirror `test/load.mjs`), wired into `npm test`.
- New view `glance-test` on the `home-test` dashboard (back up the dashboard JSON
  first) containing one card.
- `examples/home-test-glance-areas.json` stub.

**Phase 1 — collapsed grid**, FR-01 … FR-11 from PLAN.md §4:
floor → areas (registry, `auto`/`explicit`), per-area override, 3-column grid,
portrait tiles (`tile_height: 260`), area icon + name, readout line
(`22° · 68%`) with **omitted** missing values, power line (`⚡ 122W`, auto-scaled),
up to three domain circles with count badges (climate / covers / lights, `hold`
rules inherited), two opening pills (doors / windows) with counts + centred chevron,
icon morph table, minimal editor (card + area list only).

Out of scope: the expansion morph (Phase 2), panel contents (Phase 3), bundles
(Phase 4), expand-all, sparklines, any change to `glance-plus.js` or
`hierarchy-area.js`.

## Design decisions already made — do not relitigate

- One card per **floor**; areas are data (`areas[]` overrides), not cards.
- The expanded panel is **one grid column wide and vertical**; siblings reflow around
  it (`grid-auto-flow: dense`). Not a full-width drawer.
- Tiles are **portrait with a fixed pixel height**, not `aspect-ratio: 1`.
- Derived values: explicit override → registry → **omit**. Never average, never `0`,
  never `—` in the collapsed tile.
- No device IDs; `entity_id` only.
- Single file (inline resource deployment).
- Module-level registry/Energy cache; failure is visible, never a silent heuristic.
- Colours/layout tokens from PLAN.md §8; no new palette.

## Working method

1. Preview-first for anything visual: `node make-preview.mjs` → headless Chromium at
   **768 px** (the mockup width) → screenshot → compare against
   `docs/mockups/mockup-collapsed.png`. Do not eyeball from code.
2. Deploy with
   `node /workspace/HA/apply-live-card.mjs src/glance-areas.js GlanceAreasCard`
   (it backs up the live resource first). Hard-refresh is the user's step.
3. Keep `REQUIREMENTS.md` decisions up to date as you go (append, never rewrite).
4. Report progress per FR id, with the acceptance criterion you verified.

## Hard rules

- No `recorder/*`, no statistics writes, no unit changes, no deleting entities or
  helpers. Nothing here needs it.
- Back up before every dashboard or resource write.
- Do not commit or push to GitHub until the user confirms the card on live.
- No `python`; Node only. No secrets in files, commits or remotes.
- Ask instead of guessing on: splitting the module, touching other cards' files,
  anything that writes history.

## Definition of done (report these, with evidence)

- [ ] Card adds from the dashboard picker with no red error card.
- [ ] `glance-test` view on live shows the real floor's areas, correct count/order.
- [ ] Tile geometry matches the mockup tokens: radius 20, padding 14, icon 28,
      name 22/600, circles 44, pills 30, 3 columns at 768 px.
- [ ] Readout omits missing humidity/power (temperature-only area renders `21°`
      alone, with no gap where the rest would be).
- [ ] Temperature/humidity honour °C/°F; pt-PT decimal separator on live.
- [ ] Per-area power matches `hierarchy-power` for the same area.
- [ ] Circles act: lights-off turns off exactly the configured set and its badge
      disappears; covers badge follows open shutters; climate icon follows mode.
- [ ] Opening pills count only open ones and hide at 0; chevron expands.
- [ ] Editor can add, remove and reorder areas, and reset an override to auto.
- [ ] `npm test` green; screenshot attached; no console errors on live.
- [ ] Report: what you built, what you deliberately deferred, where the mockup asks
      for something the plan does not yet cover.

## Report format

1. **Landed** — FR ids + one line each on how it was verified.
2. **Deviations** — anything you changed in the contract and why.
3. **Open** — questions that need a human decision before Phase 2 (see PLAN §13).
4. **Next** — the Phase 2 first task, in one sentence.
