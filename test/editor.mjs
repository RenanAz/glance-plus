import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.customElements = window.customElements; // ha-entity-picker absent -> text fallback
globalThis.CustomEvent = window.CustomEvent;
globalThis.console.info = () => {};
globalThis.history = window.history;
globalThis.Event = window.Event;

const src = readFileSync("src/glance-plus.js", "utf8");
new Function("window", "document", "HTMLElement", "customElements", "CustomEvent", src)(
  window, window.document, window.HTMLElement, window.customElements, window.CustomEvent
);

const Ed = window.customElements.get("glance-plus-editor");
const el = document.createElement("glance-plus-editor");
document.body.append(el);

const cfg = {
  type: "custom:glance-plus",
  title: "Doors & Windows",
  icon: "mdi:door",
  columns: 5,
  toggle_entity: "input_boolean.show_doors_and_windows",
  blocks: [
    { name: "Doors", color: "red", columns: 4, cells: [{ entity: "binary_sensor.a", name: "Sótão" }] },
    { name: "Windows", color: "yellow", cells: [{ entity: "binary_sensor.b" }, { entity: "binary_sensor.c" }] },
  ],
};
el.setConfig(cfg);
const sr = el.shadowRoot;
console.log("built:", sr.querySelectorAll(".row").length, "rows |", sr.querySelectorAll("details").length, "details |", sr.querySelectorAll("button").length, "buttons");

// HA feeds every config-changed back in as a fresh clone; emulate that so the
// click handlers are exercised against the config the editor keeps.
let last = null;
el.addEventListener("config-changed", (e) => {
  last = e.detail.config;
  el.setConfig(JSON.parse(JSON.stringify(last)));
});

// edit the title text input
const rows = [...sr.querySelectorAll(".row")];
const titleRow = rows.find((r) => r.querySelector("label").textContent === "Title");
const titleInput = titleRow.querySelector("input");
titleInput.value = "Portas";
titleInput.dispatchEvent(new window.Event("change"));
console.log("title edit ->", last && last.title, "| blocks kept:", !!(last && last.blocks));

// edit a block colour (block 0, Default icon colour): find inside first details
const d0 = sr.querySelectorAll(".sec > details")[0];
const colorRow = [...d0.querySelectorAll(".row")].find((r) => r.querySelector("label").textContent === "Default icon colour");
const colorText = colorRow.querySelector("input[type=text], input:not([type])");
colorText.value = "#ff0000";
colorText.dispatchEvent(new window.Event("change"));
console.log("block colour ->", last.blocks[0].color);

// add a cell to block 1, twice: the 2nd one is the regression (echo replaced
// the config object, so the rebuilt buttons used to point at a dead object)
const clickAdd = () => [...el.shadowRoot.querySelectorAll(".sec > details")[1].querySelectorAll("button")].find((b) => b.textContent === "+ Cell").click();
clickAdd();
clickAdd();
assert.equal(last.blocks[1].cells.length, 4, "two clicks on + Cell must add two cells");
assert.equal(el.shadowRoot.querySelectorAll(".sec > details").length, 2, "blocks survive the adds");

// reorder blocks
const up = [...el.shadowRoot.querySelectorAll(".sec > details")[1].querySelectorAll("button")].find((b) => b.textContent === "↑");
up.click();
console.log("after move up -> first block:", last.blocks[0].name);

// delete a cell
const del = [...el.shadowRoot.querySelectorAll(".sec > details")[0].querySelectorAll("button")].find((b) => b.textContent === "Delete cell");
del.click();
console.log("after delete cell -> blocks[0].cells:", last.blocks[0].cells.length);

// card-level show_if -> empty should delete key
const showRow = [...el.shadowRoot.querySelectorAll(".sec")[1].querySelectorAll(".row")].find((r) => r.querySelector("label").textContent === "Card show_if");
const ta = showRow.querySelector("textarea");
ta.value = "{{ is_state('input_boolean.x','on') }}";
ta.dispatchEvent(new window.Event("change"));
console.log("show_if set:", last.show_if);
ta.value = "";
ta.dispatchEvent(new window.Event("change"));
console.log("show_if cleared (key deleted):", !("show_if" in last));

// echo guard: feeding our own config back must not rebuild DOM
const before = el.shadowRoot.querySelectorAll(".row").length;
el.setConfig(JSON.parse(JSON.stringify(last)));
console.log("echo rebuild?", el.shadowRoot.querySelectorAll(".row").length !== before);
