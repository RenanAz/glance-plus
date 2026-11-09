import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.customElements = window.customElements;
globalThis.CustomEvent = window.CustomEvent;
globalThis.console.info = () => {};

const src = readFileSync("src/hierarchy-area.js", "utf8");
new Function("window", "document", "HTMLElement", "customElements", "CustomEvent", src)(
  window,
  window.document,
  window.HTMLElement,
  window.customElements,
  window.CustomEvent
);

const Ed = window.customElements.get("hierarchy-area-editor");
if (!Ed) throw new Error("editor element not registered");

const el = document.createElement("hierarchy-area-editor");
document.body.append(el);
el.setConfig({
  type: "custom:hierarchy-area",
  name: "Sala",
  accent: "#fb7185",
  columns: 4,
  controls: [
    { entity: "switch.a", name: "Esq", group: "Triplo" },
    { entity: "switch.b", name: "Dir", downstream: [{ entity: "light.b1" }] },
  ],
});

const sr = el.shadowRoot;
if (!sr.querySelector(".ed")) throw new Error("editor built nothing");
if (!sr.querySelectorAll("details").length) throw new Error("no control rows rendered");
if (!sr.textContent.includes("Switches & devices")) throw new Error("controls section missing");

// HA feeds each config-changed back in as a clone; emulate it.
let last = null;
el.addEventListener("config-changed", (e) => {
  last = e.detail.config;
  el.setConfig(JSON.parse(JSON.stringify(last)));
});

// Name edit.
const nameRow = [...sr.querySelectorAll(".row")].find((r) => r.querySelector("label").textContent === "Name");
const nameInput = nameRow.querySelector("input");
nameInput.value = "Sala Nova";
nameInput.dispatchEvent(new window.Event("change"));
if (last.name !== "Sala Nova") throw new Error("name edit did not emit");

// Native visibility is regenerated from the controls on every edit.
const vis = (last.visibility || []).flatMap((x) => x.conditions || []).map((x) => x.entity);
if (!vis.includes("switch.a") || !vis.includes("switch.b")) {
  throw new Error("editor must generate visibility from the controls: " + JSON.stringify(last.visibility));
}

// + Control appends an entry.
const addBtn = [...sr.querySelectorAll("button")].find((b) => b.textContent === "+ Control");
addBtn.click();
if (last.controls.length !== 3) throw new Error("+ Control did not append");

// Downstream is a list of entity pickers: add, edit, remove.
const d1 = [...sr.querySelectorAll("details.ctl")][1];
const addDown = [...d1.querySelectorAll("button")].find((b) => b.textContent === "+ Downstream");
addDown.click();
let dRows = d1.querySelectorAll(".dsrow");
if (dRows.length !== 2) throw new Error("+ Downstream did not append a row");
const newPick = dRows[1].querySelector("input");
newPick.value = "light.z9";
newPick.dispatchEvent(new window.Event("change"));
const c = last.controls.find((x) => x.entity === "switch.b");
if (!c || c.downstream.length !== 2 || c.downstream[1].entity !== "light.z9") {
  throw new Error("downstream picker edit failed: " + JSON.stringify(c));
}
dRows = d1.querySelectorAll(".dsrow");
dRows[1].querySelector("button").click();
const c2 = last.controls.find((x) => x.entity === "switch.b");
if (c2.downstream.length !== 1) throw new Error("downstream remove failed");

// "With switch" opts downstream into following.
const withRow = [...d1.querySelectorAll(".row")].find(
  (r) => r.querySelector("label").textContent === "With switch"
);
const cb = withRow.querySelector("input[type=checkbox]");
cb.checked = true;
cb.dispatchEvent(new window.Event("change"));
const c3 = last.controls.find((x) => x.entity === "switch.b");
if (!c3 || c3.follow !== true) throw new Error("With switch did not set follow");

// "Holds card" opts a control out of keeping the area visible.
const holdRow = [...sr.querySelectorAll("details.ctl")[0].querySelectorAll(".row")].find(
  (r) => r.querySelector("label").textContent === "Holds card"
);
const hold = holdRow.querySelector("input[type=checkbox]");
if (!hold.checked) throw new Error("switch controls must hold the card by default");
hold.checked = false;
hold.dispatchEvent(new window.Event("change"));
const cHold = last.controls.find((x) => x.entity === "switch.a");
if (!cHold || cHold.hold !== false) throw new Error("Holds card did not set hold: false");
const vis2 = (last.visibility || []).flatMap((x) => x.conditions || []).map((x) => x.entity);
if (vis2.includes("switch.a")) throw new Error("hold: false must drop the entity from visibility");

// Delete removes it.
const del = sr.querySelectorAll(".ctlrow")[0].querySelector(".del");
del.click();
if (last.controls.some((x) => x.entity === "switch.a")) throw new Error("delete failed");

console.log("ok: hierarchy-area editor self-check passed");

// Repeated edits in one session (the reported bug): a plate edit must not
// swallow the next click, and arrows must keep working.
const el2 = document.createElement("hierarchy-area-editor");
document.body.append(el2);
el2.setConfig({
  type: "custom:hierarchy-area",
  name: "Sala",
  controls: [{ entity: "switch.1" }, { entity: "switch.2" }, { entity: "switch.3" }],
});
let cfg2 = null;
el2.addEventListener("config-changed", (e) => {
  cfg2 = e.detail.config;
  el2.setConfig(JSON.parse(JSON.stringify(cfg2))); // HA echo
});
const sr2 = el2.shadowRoot;

const plateInput = (n) => {
  const d = sr2.querySelectorAll("details.ctl")[n];
  const row = [...d.querySelectorAll(".row")].find((r) => r.querySelector("label").textContent === "Plate");
  return row.querySelector("input");
};

plateInput(0).value = "Placa A";
plateInput(0).dispatchEvent(new window.Event("change"));
if (cfg2.controls[0].group !== "Placa A") throw new Error("first plate edit lost");

plateInput(1).value = "Placa B";
plateInput(1).dispatchEvent(new window.Event("change"));
if (cfg2.controls[1].group !== "Placa B") throw new Error("second plate edit lost");

const moveKey = (n, key) => {
  const row = sr2.querySelectorAll(".ctlrow")[n];
  row.querySelector("[data-drag]").dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, composed: true })
  );
};
moveKey(0, "ArrowDown");
const order1 = cfg2.controls.map((c) => c.entity).join();
if (order1 !== "switch.2,switch.1,switch.3") throw new Error("first arrow lost: " + order1);
moveKey(1, "ArrowDown");
const order2 = cfg2.controls.map((c) => c.entity).join();
if (order2 !== "switch.2,switch.3,switch.1") throw new Error("second arrow lost: " + order2);
moveKey(2, "ArrowUp");
if (cfg2.controls.map((c) => c.entity).join() !== "switch.2,switch.1,switch.3") {
  throw new Error("arrow up after arrows failed");
}
if (!sr2.querySelectorAll("details.ctl").length) throw new Error("control list vanished");

console.log("ok: repeated edits stay live");

// Reorder keeps the moved control's panel open, even though the rows are
// re-rendered from the model (the handler lives on the shadow root).
const firstEntity = cfg2.controls[0].entity;
sr2.querySelectorAll("details.ctl")[0].open = true;
moveKey(0, "ArrowDown");
const movedRow = sr2.querySelectorAll(".ctlrow[data-i=\"1\"] details")[0];
if (!movedRow || !movedRow.open) throw new Error("moved panel did not stay open");
if (cfg2.controls[1].entity !== firstEntity) throw new Error("moved control is not at index 1");

// An external setConfig that differs (HA adding a key) rebuilds the editor;
// the next arrow must still work through the delegated listener.
const snapshot = JSON.parse(JSON.stringify(cfg2));
snapshot.grid_options = { columns: 12 };
el2.setConfig(snapshot);
const orderBefore = el2._config.controls.map((c) => c.entity).join();
moveKey(1, "ArrowDown");
if (cfg2.controls.map((c) => c.entity).join() === orderBefore) {
  throw new Error("arrow dead after external rebuild");
}
console.log("ok: reorder survives rebuilds");

// Harshest realistic HA echo: a deep clone with a different key order, which
// defeats the JSON equal-guard and forces a full editor rebuild. Three actions
// in a row must still land.
{
  const el3 = document.createElement("hierarchy-area-editor");
  document.body.append(el3);
  el3.setConfig({
    type: "custom:hierarchy-area",
    name: "X",
    controls: [{ entity: "switch.1" }, { entity: "switch.2" }, { entity: "switch.3" }],
  });
  let cfg3 = null;
  const reverseKeys = (o) => Object.fromEntries(Object.entries(o).reverse());
  el3.addEventListener("config-changed", (e) => {
    cfg3 = e.detail.config;
    const clone = reverseKeys(JSON.parse(JSON.stringify(cfg3)));
    el3.setConfig(clone); // differs -> setConfig rebuilds
  });
  const click = (act, i) => {
    const b = [...el3.shadowRoot.querySelectorAll(`[data-act="${act}"]`)].find(
      (x) => act === "add" || x.dataset.i === String(i)
    );
    if (!b) throw new Error(`no ${act} button at ${i}`);
    b.click();
  };
  const moveKey3 = (n, key) => {
    const row = el3.shadowRoot.querySelectorAll(".ctlrow")[n];
    row.querySelector("[data-drag]").dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, composed: true })
    );
  };
  const order = () => cfg3.controls.map((c) => c.entity).join();
  moveKey3(0, "ArrowDown");
  if (order() !== "switch.2,switch.1,switch.3") throw new Error("rebuild echo killed first move: " + order());
  moveKey3(1, "ArrowDown");
  if (order() !== "switch.2,switch.3,switch.1") throw new Error("rebuild echo killed second move: " + order());
  click("del", 0);
  if (order() !== "switch.3,switch.1") throw new Error("delete after rebuild failed: " + order());
  click("add", 0);
  if (cfg3.controls.length !== 3) throw new Error("add after rebuild failed");
  console.log("ok: actions survive full rebuild echoes");
}

// HA deep-freezes the config object emitted in config-changed
// (hui-dialog-edit-card: deepFreeze(ev.detail.config)). The editor must not
// keep mutating that object, or the second action throws.
{
  const deepFreeze = (o) => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  };
  const el4 = document.createElement("hierarchy-area-editor");
  document.body.append(el4);
  el4.setConfig({
    type: "custom:hierarchy-area",
    name: "Frozen",
    controls: [{ entity: "switch.a" }, { entity: "switch.b" }, { entity: "switch.c" }],
  });
  let cfg4 = null;
  el4.addEventListener("config-changed", (e) => {
    cfg4 = e.detail.config;
    deepFreeze(cfg4); // exactly what the dialog does
    el4.setConfig(cfg4); // and then it feeds the frozen object back
  });
  const act = (a, i) => {
    const b = [...el4.shadowRoot.querySelectorAll(`[data-act="${a}"]`)].find(
      (x) => a === "add" || x.dataset.i === String(i)
    );
    if (!b) throw new Error(`missing ${a} ${i}`);
    b.click();
  };
  const moveKey4 = (n, key) => {
    const row = el4.shadowRoot.querySelectorAll(".ctlrow")[n];
    row.querySelector("[data-drag]").dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, composed: true })
    );
  };
  const order = () => cfg4.controls.map((c) => c.entity).join();
  moveKey4(0, "ArrowDown");
  if (order() !== "switch.b,switch.a,switch.c") throw new Error("freeze: first move failed " + order());
  moveKey4(1, "ArrowDown");
  if (order() !== "switch.b,switch.c,switch.a") throw new Error("freeze: second move failed " + order());
  act("del", 0);
  if (order() !== "switch.c,switch.a") throw new Error("freeze: delete failed " + order());
  console.log("ok: survives HA deep-freeze");
}

// Opening the editor materialises hold and regenerates state-only visibility.
{
  const el3 = document.createElement("hierarchy-area-editor");
  document.body.append(el3);
  let opened = null;
  el3.addEventListener("config-changed", (e) => { opened = e.detail.config; });
  el3.setConfig({
    type: "custom:hierarchy-area",
    name: "Open",
    show_helper: "input_boolean.floor",
    controls: [{ entity: "switch.a" }, { entity: "light.b" }],
    visibility: [{ condition: "or", conditions: [{ condition: "state", entity: "switch.a", state: "on" }] }],
  });
  if (!opened) throw new Error("editor open must emit the normalised config");
  const holds = opened.controls.map((c) => c.hold);
  if (holds[0] !== true || holds[1] !== false) throw new Error("hold defaults not materialised: " + JSON.stringify(holds));
  const vis = (opened.visibility || []).flatMap((x) => x.conditions || []).map((x) => x.entity);
  if (!vis.includes("input_boolean.floor") || !vis.includes("switch.a") || vis.includes("light.b")) {
    throw new Error("open must regenerate visibility: " + JSON.stringify(opened.visibility));
  }
  console.log("ok: editor open sync");
}

// Hand-authored visibility is preserved.
{
  const el4 = document.createElement("hierarchy-area-editor");
  document.body.append(el4);
  let last4 = null;
  el4.addEventListener("config-changed", (e) => { last4 = e.detail.config; });
  el4.setConfig({
    type: "custom:hierarchy-area",
    name: "Manual",
    controls: [{ entity: "switch.a" }],
    visibility: [{ condition: "screen", media_query: "(min-width: 800px)" }],
  });
  if (!last4) throw new Error("no emit for manual visibility config");
  if (!(last4.visibility || []).some((x) => x.condition === "screen")) {
    throw new Error("manual visibility must survive: " + JSON.stringify(last4.visibility));
  }
  console.log("ok: manual visibility preserved");
}
