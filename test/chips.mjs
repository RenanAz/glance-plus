// Idle-area chip row: chips stay while the area is idle, selected when the
// helper is on, hidden when the area is active.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const calls = [];
class HTMLElement {
  constructor() {
    this.style = {};
    this.shadowRoot = { innerHTML: "", addEventListener() {}, querySelectorAll: () => [] };
  }
  attachShadow() {
    return this.shadowRoot;
  }
}
const ctx = {
  HTMLElement,
  customElements: { get: () => false, define() {} },
  window: { customCards: [] },
  document: { createElement: () => ({ append() {} }) },
  console,
  CustomEvent: class {},
  setTimeout,
  clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(
  readFileSync("/workspace/glance-plus/src/hierarchy-area.js", "utf8") +
    "\nthis.HierarchyAreaChips = HierarchyAreaChips;",
  ctx
);

const chips = new ctx.HierarchyAreaChips();
chips.setConfig({
  items: [
    { name: "Sala", helper: "input_boolean.show_sala", switches: ["switch.a"] },
    { name: "Corredor", helper: "input_boolean.show_corredor", switches: ["switch.b"] },
  ],
});
chips.hass = {
  states: {
    "switch.a": { state: "on", attributes: {} }, // Sala active -> no chip
    "switch.b": { state: "off", attributes: {} },
    "input_boolean.show_sala": { state: "off", attributes: {} },
    "input_boolean.show_corredor": { state: "off", attributes: {} },
  },
  callService: (d, s, data) => calls.push({ d, s, id: data.entity_id }),
};

let html = chips.shadowRoot.innerHTML;
if (!html.includes("Corredor")) throw new Error("idle area chip missing");
if (html.includes("Sala")) throw new Error("active area must not have a chip");
if (chips.style.display === "none") throw new Error("chip row must be visible");

// Tap the chip -> helper toggles on.
chips._click({ target: { closest: () => ({ dataset: { h: "input_boolean.show_corredor" } }) } });
if (calls[0].d !== "input_boolean" || calls[0].s !== "toggle" || calls[0].id !== "input_boolean.show_corredor") {
  throw new Error("chip tap must toggle the helper: " + JSON.stringify(calls[0]));
}

// Helper on -> the chip STAYS (selected) so it can be toggled back.
chips.hass.states["input_boolean.show_corredor"].state = "on";
chips.hass = chips.hass;
html = chips.shadowRoot.innerHTML;
if (!html.includes("Corredor")) throw new Error("summoned area chip must stay visible");
if (!html.includes("chip sel")) throw new Error("summoned chip must be marked selected");
if (chips.style.display === "none") throw new Error("row must stay visible");

// Every area active -> the row hides.
chips.hass.states["switch.a"].state = "on";
chips.hass.states["switch.b"].state = "on";
chips.hass = chips.hass;
if (chips.style.display !== "none") throw new Error("row must hide when no area is idle");

// Everything off again -> chips return.
chips.hass.states["switch.a"].state = "off";
chips.hass.states["switch.b"].state = "off";
chips.hass = chips.hass;
if (!chips.shadowRoot.innerHTML.includes("Sala")) throw new Error("idle chips must return");
if (chips.style.display === "none") throw new Error("chip row must unhide");
console.log("ok: idle chip row self-check passed");

// Hiding must target <hui-card> (the section grid item), never a shadow host.
{
  const c = new ctx.HierarchyAreaChips();
  c.setConfig({ items: [{ name: "X", helper: "input_boolean.show_x", switches: ["switch.x"] }] });
  const section = { style: {} };
  c.getRootNode = () => ({ host: section });
  c.parentElement = { tagName: "HUI-CARD", style: {} };
  c.hass = {
    states: {
      "switch.x": { state: "on", attributes: {} },
      "input_boolean.show_x": { state: "off", attributes: {} },
    },
    callService() {},
  };
  if (c.parentElement.style.display !== "none") throw new Error("empty row must hide its hui-card");
  if (section.style.display) throw new Error("must never hide the section");

  // Unknown wrapper -> hide the card itself, never the wrapper.
  c.parentElement = { tagName: "DIV", style: {} };
  c._sig = "";
  c.hass = c.hass;
  if (c.style.display !== "none") throw new Error("non hui-card parent must hide the card itself");
  if (c.parentElement.style.display) throw new Error("must not hide an unknown wrapper");
  console.log("ok: chip row hides the right element");
}
