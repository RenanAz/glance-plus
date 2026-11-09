import { readFileSync } from "node:fs";
import vm from "node:vm";

const calls = [];
const listeners = {};
class HTMLElement {
  constructor() { this.shadowRoot = { innerHTML: "", addEventListener() {}, querySelectorAll: () => [] }; }
  attachShadow() { return this.shadowRoot; }
}
const ctx = {
  HTMLElement,
  customElements: { get: () => true, define() {} },
  window: {},
  document: { createElement: () => ({ append() {}, addEventListener() {}, set innerHTML(v) {} }) },
  console,
  CustomEvent: class { constructor(t, o) { Object.assign(this, o); this.type = t; } },
  requestAnimationFrame: (f) => f(),
  setTimeout, clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(readFileSync("/workspace/glance-plus/src/hierarchy-areas.js", "utf8") + "\nthis.HierarchyAreasCard = HierarchyAreasCard;", ctx);
const Card = ctx.HierarchyAreasCard;
if (!Card) throw new Error("class not defined");

const card = new Card();
card.setConfig({
  title: "Sala",
  areas: [
    { name: "Sala", plates: [{ rockers: [{ entity: "switch.a", downstream: [{ entity: "light.a1" }] }] }] },
    { name: "Hall", plates: [{ rockers: [{ entity: "switch.b", downstream: [{ entity: "light.b1", follow: false }] }] }] },
    { name: "Cozinha", devices: ["light.c"] },
  ],
});
card._hass = {
  states: { "switch.a": { state: "off", attributes: {} }, "light.a1": { state: "off", attributes: {} },
            "switch.b": { state: "off", attributes: {} }, "light.b1": { state: "off", attributes: {} },
            "light.c": { state: "off", attributes: {} } },
  callService: (d, s, data) => calls.push([d, s, data.entity_id]),
};
card._sig = ""; card._render();
const html = card.shadowRoot.innerHTML;
if (!html.includes("Sala") || !html.includes("Cozinha")) throw new Error("names missing");
if (!html.includes('class="pill"')) throw new Error("idle areas should render as pills");

// all off -> compact pills, no expanded row body
if (html.includes('class="abody"')) throw new Error("nothing should be expanded by default");

// tap pill -> expands plus "show all" header
card._toggleOpen(0);
if (!card.shadowRoot.innerHTML.includes('class="abody"')) throw new Error("tap should expand");
card._click({ target: { closest: (s) => (s === "[data-head]" ? {} : null) } });
if (!card.shadowRoot.innerHTML.includes('class="arow open"')) throw new Error("header should expand all");

// rocker with default follow turns downstream on too
calls.length = 0;
card._toggle("switch.a");
if (calls.length !== 1 || calls[0][2].length !== 2) throw new Error("rockers with downstream should send one call with both ids");
// follow:false leaves downstream alone
calls.length = 0;
card._toggle("switch.b");
if (calls[0][2].length !== 1) throw new Error("follow:false must not touch downstream");

// master powers the whole area
calls.length = 0;
card._master(0);
if (calls[0][2].length !== 2) throw new Error("master should send every area entity");
console.log("ok: areas self-check passed");
