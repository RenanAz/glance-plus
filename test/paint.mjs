import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { call } from "../scripts/mcp.mjs";
import { cards } from "../examples/home-test-cards.mjs";
globalThis.console.info = () => {};
globalThis.HTMLElement = class { constructor(){ this.style={}; } attachShadow(){ this.shadowRoot={ innerHTML:"", addEventListener(){}, querySelector: () => null }; } };
globalThis.customElements = { get: () => null, define: () => {} };
globalThis.window = {};
globalThis.document = { createElement: () => ({}) };
new Function(readFileSync(fileURLToPath(new URL("../src/glance-plus.js", import.meta.url)), "utf8").replace(/GlancePlusCard/g, "GPC") + "\nglobalThis.__C = GPC;\n")();
const Card = globalThis.__C;

for (const card of cards) {
  // Render the card's template on live HA and paint it with stub states.
  const el = new Card();
  el.setConfig(card);
  const r = await call("ha_eval_template", { template: el._template() });
  const data = typeof r.result === "string" ? JSON.parse(r.result) : r.result;
  const states = {};
  for (const { cell } of el._flat) states[cell.entity] = { state: "on", attributes: { unit_of_measurement: "" } };
  el._hass = { states, formatEntityState: (s) => s.state, callService() {}, connection: {} };
  el._cells = data.cells; el._blocks = data.blocks; el._show = data.show;
  el._title = data.title; el._hicon = data.icon;
  el._paint();
  const html = el.shadowRoot.innerHTML;
  console.log(
    (card.title + "                    ").slice(0, 20),
    "cells:", data.cells.length,
    "| html:", html.length,
    "| header:", html.includes('class="htitle"'),
    "| chevron:", html.includes('class="chev"'),
    "| blocks:", (html.match(/class="blabel"/g) || []).length,
    "| grids:", (html.match(/class="grid"/g) || []).length
  );
}
const el = new Card();
el.setConfig(cards[3]);
el._hass = { states: {}, formatEntityState: (s) => s.state, callService() {}, connection: {} };
el._cells = []; el._blocks = []; el._show = true; el._title = "Doors & Windows"; el._hicon = "mdi:door";
el._paint();
const empty = el.shadowRoot.innerHTML;
console.log("empty-grid case | header:", empty.includes('class="htitle"'), "| chevron:", empty.includes('class="chev"'), "| grid:", empty.includes('class="grid"'));
console.log("\nsample block html:\n" + el.shadowRoot.innerHTML.slice(0, 0));
