// Self-check for hierarchy-area: visibility rules and master/toggle wiring.
// No browser: stubs the handful of DOM APIs the card touches.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  customElements: { get: () => true, define() {} },
  window: {},
  document: { createElement: () => ({ append() {}, addEventListener() {} }) },
  console,
  CustomEvent: class { constructor(t, o) { Object.assign(this, o); this.type = t; } },
  setTimeout,
  clearTimeout,
};
vm.createContext(ctx);
vm.runInContext(
  readFileSync(fileURLToPath(new URL("../src/hierarchy-area.js", import.meta.url)), "utf8") +
    "\nthis.HierarchyAreaCard = HierarchyAreaCard;",
  ctx
);

const states = {
  "switch.a": "off",
  "switch.b": "off",
  "switch.c": "off",
  "switch.d": "off",
  "light.d1": "off",
  "light.d2": "off",
};
const hass = {
  states: Object.fromEntries(
    Object.entries(states).map(([k, v]) => [k, { state: v, attributes: { friendly_name: k } }])
  ),
  callService: (domain, service, data) => calls.push({ domain, service, ids: data.entity_id, data }),
};

hass.states["light.d1"].attributes = { friendly_name: "d1", supported_color_modes: ["hs"], brightness: 128 };
const card = new ctx.HierarchyAreaCard();
card.setConfig({
  name: "Sala",
  controls: [
    { entity: "switch.a", name: "Esq", group: "Triplo" },
    { entity: "switch.b", name: "Dir", group: "Triplo" },
    { entity: "switch.c", name: "Luz" },
    { entity: "switch.d", name: "Bundle", downstream: [{ entity: "light.d1" }, { entity: "light.d2" }] },
  ],
});
card.hass = hass;

const html = () => card.shadowRoot.innerHTML;

// All off, collapsed: header only, no tiles.
if (!html().includes("Sala")) throw new Error("area name missing");
if (html().includes('class="tile')) throw new Error("off entities must be hidden when collapsed");
if (!html().includes("chevron-down")) throw new Error("collapsed chevron missing");

// One switch on: only that tile appears.
hass.states["switch.a"].state = "on";
card._sig = "";
card.hass = hass;
if (!html().includes('data-e="switch.a"')) throw new Error("on entity must be visible");
if (html().includes('data-e="switch.b"')) throw new Error("off entity must stay hidden");
if (html().includes("Triplo")) throw new Error("plate label must not show while collapsed");
if ((html().match(/class="grid"/g) || []).length !== 1) throw new Error("collapsed view must use one flat grid");

// Expand: everything declared, including off entities and plate labels.
card._click({ target: { closest: (s) => (s === "[data-open]" ? {} : null) } });
for (const e of ["switch.a", "switch.b", "switch.c", "switch.d", "light.d1", "light.d2"]) {
  if (!html().includes('data-e="' + e + '"')) throw new Error("expanded view missing " + e);
}
if (!html().includes("Triplo")) throw new Error("expanded view should show the plate label");
if ((html().match(/class="grid"/g) || []).length < 2) throw new Error("expanded view must group by plate");
if (!html().includes("chevron-up")) throw new Error("expanded chevron missing");

// Collapse, then a downstream on with its rocker off: the bundle stays hidden.
card._click({ target: { closest: (s) => (s === "[data-open]" ? {} : null) } });
hass.states["light.d1"].state = "on";
card._sig = "";
card.hass = hass;
if (html().includes('data-e="switch.d"')) {
  throw new Error("a downstream must not pull its bundle into the collapsed view");
}
if (!html().includes('data-e="switch.a"')) throw new Error("rocker on must stay visible");

// Rocker on: the bundle lists every declared downstream, on or off.
hass.states["switch.d"].state = "on";
card._sig = "";
card.hass = hass;
if (!html().includes('data-e="switch.d"')) throw new Error("bundle must show when its switch is on");
if (!html().includes('data-e="light.d1"') || !html().includes('data-e="light.d2"')) {
  throw new Error("bundle must list all downstreams when the switch is on");
}

// Dimmable downstream on -> embedded slider present, drag calls light.turn_on.
if (!html().includes('class="slide cover"') || !html().includes('data-b="light.d1"')) {
  throw new Error("on dimmable downstream must render an embedded brightness slider");
}
calls.length = 0;
card._brightness({ value: "40", dataset: { b: "light.d1" } });
if (calls.length !== 1 || calls[0].domain !== "light" || calls[0].service !== "turn_on") {
  throw new Error("brightness should call light.turn_on: " + JSON.stringify(calls));
}
if (calls[0].ids !== "light.d1" || calls[0].data.brightness_pct !== 40) {
  throw new Error("brightness payload wrong: " + JSON.stringify(calls[0]));
}

// Rocker tap must NOT touch downstream by default (they keep their own power).
calls.length = 0;
card._toggle("switch.d");
if (calls.length !== 1 || calls[0].ids.length !== 1) {
  throw new Error("downstream must not follow unless follow: true");
}
if (calls[0].ids[0] !== "switch.d" || calls[0].service !== "turn_off") {
  throw new Error("rocker on -> turn_off the rocker only: " + JSON.stringify(calls[0]));
}

// follow: true opts back in.
const followCard = new ctx.HierarchyAreaCard();
followCard.setConfig({
  name: "Follow",
  controls: [
    { entity: "switch.f", downstream: [{ entity: "light.f1" }, { entity: "light.f2" }], follow: true },
  ],
});
followCard.hass = {
  states: {
    "switch.f": { state: "off", attributes: {} },
    "light.f1": { state: "off", attributes: {} },
    "light.f2": { state: "off", attributes: {} },
  },
  callService: (domain, service, data) => calls.push({ domain, service, ids: data.entity_id }),
};
calls.length = 0;
followCard._toggle("switch.f");
if (calls[0].ids.length !== 3) throw new Error("follow: true must include downstream");

// Master when everything is off -> turns everything on, then opens the card.
for (const st of Object.values(hass.states)) st.state = "off";
card._sig = "";
card.hass = hass;
calls.length = 0;
card._master();
if (calls[0].service !== "turn_on") throw new Error("master all-off -> turn_on");
if (calls[0].ids.length !== 4) throw new Error("master must only target the 4 switches");
if (calls[0].ids.some((id) => id.startsWith("light."))) {
  throw new Error("master must never touch downstream lights: " + JSON.stringify(calls[0].ids));
}
if (!card._open) throw new Error("master should open the card");

// Master again: all on -> everything off.
for (const st of Object.values(hass.states)) st.state = "on";
card._sig = "";
card.hass = hass;
calls.length = 0;
card._master();
if (calls[0].service !== "turn_off") throw new Error("master on -> turn_off");

console.log("ok: hierarchy-area self-check passed");


// show_helper: opens the card; tapping only collapses it, never releases the helper.
{
  const c = new ctx.HierarchyAreaCard();
  c.setConfig({
    name: "Idle",
    show_helper: "input_boolean.show_x",
    controls: [{ entity: "switch.x" }],
  });
  const calls = [];
  const hass = {
    states: {
      "switch.x": { state: "off", attributes: {} },
      "input_boolean.show_x": { state: "off", attributes: {} },
    },
    callService(d, s, data) {
      calls.push({ d, s, id: data.entity_id });
    },
  };
  c.hass = hass;
  const hasTile = () => c.shadowRoot.innerHTML.includes('data-e="switch.x"');
  if (hasTile()) throw new Error("idle card with helper off must be collapsed");

  c.hass.states["input_boolean.show_x"].state = "on";
  c._sig = "";
  c.hass = hass;
  if (!hasTile()) throw new Error("helper on must expand the card");

  // Collapsing under a helper closes this card and leaves the helper alone.
  calls.length = 0;
  c._click({ target: { closest: (s) => (s === "[data-open]" ? {} : null) } });
  if (calls.some((x) => x.s === "turn_off")) throw new Error("shared helper must not be released");
  if (hasTile()) throw new Error("collapse must close the card");
  if (!c._helperOn()) throw new Error("helper must stay on");

  // Helper on + switch on: the card still opens with everything.
  c.hass.states["switch.x"].state = "on";
  c._open = false;
  c._override = false;
  c._sig = "";
  c.hass = hass;
  if (!c.shadowRoot.innerHTML.includes('class="body"')) throw new Error("body missing");
  if (!c._isOpen()) throw new Error("helper must open active cards too");
  console.log("ok: show_helper summon/collapse");
}

// Embedded slider is the default for every dimmable entity (top level too).
{
  const c = new ctx.HierarchyAreaCard();
  c.setConfig({
    name: "Sala",
    controls: [
      { entity: "light.top", name: "Topo" },
      { entity: "switch.s", downstream: [{ entity: "light.l" }] },
    ],
  });
  c.hass = {
    states: {
      "light.top": { state: "on", last_changed: new Date(Date.now() - 5 * 60000).toISOString(),
        attributes: { supported_color_modes: ["brightness"], brightness: 200 } },
      "switch.s": { state: "on", last_changed: new Date(Date.now() - 5 * 60000).toISOString(), attributes: {} },
      "light.l": { state: "on", last_changed: new Date(Date.now() - 2 * 3600000).toISOString(),
        attributes: { supported_color_modes: ["brightness"], brightness: 100 } },
    },
    callService() {},
  };
  const html = c.shadowRoot.innerHTML;
  if ((html.match(/kidbox emb/g) || []).length !== 2) throw new Error("both dimmable entities need an embedded slider");
  if (!html.includes('class="slide cover"')) throw new Error("embedded tile must be a full-cover slider");
  if (!html.includes('class="kicon" data-e="light.top"')) throw new Error("top-level icon must be the toggle target");
  if (!html.includes('class="kicon" data-e="light.l"')) throw new Error("downstream icon must be the toggle target");
  if (html.includes('class="kname" data-e')) throw new Error("the downstream name must not toggle");
  // The rail (icon + last change) belongs to the SWITCH, not the light.
  if (!/<button class="brail on" data-e="switch\.s"[^>]*>.*<span class="btime">5 min<\/span>/s.test(html)) {
    throw new Error("switch rail must carry the switch last changed");
  }
  if (html.includes("2 h")) throw new Error("the light's own last changed must not be rendered");
  if (!html.includes("78%")) throw new Error("brightness percent missing");
  // Standalone light carries the timestamp (swaps with % while dragging);
  // a downstream kid leaves secondary info to the switch rail.
  if (!/class="kidbox emb has-time"/.test(html)) throw new Error("standalone light must carry a timestamp");
  if ((html.match(/class="kidbox emb"/g) || []).length !== 1) {
    throw new Error("only the standalone light should carry the timestamp");
  }

  // Relative label switches to hours as time passes.
  c.hass.states["switch.s"].last_changed = new Date(Date.now() - 3 * 3600000).toISOString();
  c._sig = "";
  c.hass = c.hass;
  if (!c.shadowRoot.innerHTML.includes("3 h")) throw new Error("relative last changed must switch to hours");

  // Header sits inside the card by default; `title` moves it outside.
  if (!/<ha-card><div class="head in">/s.test(html)) throw new Error("header must be inside ha-card by default");
  c.setConfig({ name: "Sala", header_style: "title", controls: [{ entity: "light.top" }] });
  c.hass = c.hass;
  if (!/<div class="head">.*<ha-card>/s.test(c.shadowRoot.innerHTML)) {
    throw new Error("header_style: title must put the head outside ha-card");
  }
  console.log("ok: embedded slider default + header styles");

  // Sliding updates the visible percent immediately (no state refresh).
  const lab = { textContent: "" };
  const box = { style: { setProperty() {} }, querySelector: (s) => (s === ".kpct" ? lab : null) };
  c._brightness({ value: "40", dataset: { b: "light.top" }, closest: () => box });
  if (lab.textContent !== "40%") throw new Error("slider must update the percent live, got " + lab.textContent);
  console.log("ok: live brightness percent");

  // hide_name_on defaults ON: the rail drops the name and the time grows.
  c.setConfig({
    name: "Sala",
    controls: [{ entity: "switch.s", name: "Rocker", downstream: [{ entity: "light.l" }] }],
  });
  c.hass = c.hass;
  const h2 = c.shadowRoot.innerHTML;
  if (h2.includes('<span class="bname">Rocker')) throw new Error("hide_name_on must default to on");
  if (!h2.includes('class="btime"')) throw new Error("hide_name_on must keep the timestamp");
  // Opt out: name comes back, timestamp stays small.
  c.setConfig({
    name: "Sala",
    hide_name_on: false,
    controls: [{ entity: "switch.s", name: "Rocker", downstream: [{ entity: "light.l" }] }],
  });
  c.hass = c.hass;
  const h3 = c.shadowRoot.innerHTML;
  if (!h3.includes('<span class="bname">Rocker')) throw new Error("hide_name_on: false must show the switch name");
  if (!h3.includes('class="btime"')) throw new Error("hide_name_on: false must keep the timestamp");
  console.log("ok: hide switch name when on");
}

// One-kid bundles take half a 4-column grid; two-kid bundles take the row.
{
  const c = new ctx.HierarchyAreaCard();
  c.setConfig({
    name: "Sala",
    columns: 4,
    controls: [
      { entity: "switch.a", downstream: [{ entity: "light.a" }] },
      { entity: "switch.b", downstream: [{ entity: "light.b" }] },
      { entity: "switch.c", downstream: [{ entity: "light.c" }, { entity: "light.c2" }] },
    ],
  });
  c.hass = {
    states: Object.fromEntries(
      ["switch.a", "switch.b", "switch.c"].map((e) => [e, { state: "on", attributes: {} }])
    ),
    callService() {},
  };
  const html = c.shadowRoot.innerHTML;
  if (!/class="bundle[^"]*" style="[^"]*--kw:1;--bw:2/.test(html)) {
    throw new Error("one-kid bundle must span 2 of 4 columns: " + html.slice(0, 400));
  }
  if (!html.includes("bundle on wide")) throw new Error("two-kid bundle must take the row");
  console.log("ok: bundle spans");
}

// Size scale: medium by default, small/large change the --k factor.
{
  const c = new ctx.HierarchyAreaCard();
  const hass = {
    states: { "switch.s": { state: "off", attributes: {} } },
    callService() {},
  };
  const k = () => c.shadowRoot.innerHTML.match(/--k:([\d.]+)/)?.[1];
  c.setConfig({ name: "Size", controls: [{ entity: "switch.s" }] });
  c.hass = hass;
  if (k() !== "1") throw new Error("default size must be medium: " + k());
  c.setConfig({ name: "Size", size: "small", controls: [{ entity: "switch.s" }] });
  c.hass = hass;
  if (k() !== "0.86") throw new Error("small size wrong: " + k());
  c.setConfig({ name: "Size", size: "large", controls: [{ entity: "switch.s" }] });
  c.hass = hass;
  if (k() !== "1.16") throw new Error("large size wrong: " + k());
  console.log("ok: size scale");
}

// Secondary info: solo switches show a timestamp next to the name.
{
  const min = (n) => new Date(Date.now() - n * 60000).toISOString();
  const c = new ctx.HierarchyAreaCard();
  const hass = {
    states: {
      "switch.solo": { state: "on", last_changed: min(5), last_updated: min(2), attributes: {} },
    },
    callService() {},
  };
  const set = (cfg) => {
    c.setConfig(Object.assign({ name: "Sec", controls: [{ entity: "switch.solo" }] }, cfg));
    c.hass = hass;
    return c.shadowRoot.innerHTML;
  };
  if (!set({}).includes('<span class="tsub">5 min</span>')) {
    throw new Error("solo switch must show last changed by default");
  }
  if (!set({ secondary_info: "last-updated" }).includes('<span class="tsub">2 min</span>')) {
    throw new Error("secondary_info: last-updated must use last_updated");
  }
  if (set({ secondary_info: "none" }).includes(`class="tsub"`)) {
    throw new Error("secondary_info: none must hide the timestamp");
  }
  console.log("ok: secondary info");
}

// Shared floor helper: all cards open, tap collapses only its own card and
// never releases the helper.
{
  const c = new ctx.HierarchyAreaCard();
  const calls = [];
  const hass = {
    states: {
      "switch.on": { state: "on", attributes: {} },
      "switch.off": { state: "off", attributes: {} },
      "input_boolean.floor": { state: "on", attributes: {} },
    },
    callService: (d, s, data) => calls.push({ d, s, id: data.entity_id }),
  };
  c.setConfig({
    name: "Shared",
    show_helper: "input_boolean.floor",
    release_helper: false,
    controls: [{ entity: "switch.on" }, { entity: "switch.off" }],
  });
  c.hass = hass;
  const html = () => c.shadowRoot.innerHTML;
  if (!html().includes('data-e="switch.off"')) throw new Error("shared helper must open every switch");
  calls.length = 0;
  c._click({ target: { closest: (s) => (s === "[data-open]" ? {} : null) } });
  if (calls.some((x) => x.s === "turn_off")) throw new Error("shared helper must not be released");
  if (html().includes('data-e="switch.off"')) throw new Error("tap must collapse this card only");
  c._click({ target: { closest: (s) => (s === "[data-open]" ? {} : null) } });
  if (!html().includes('data-e="switch.off"')) throw new Error("second tap must expand again");
  console.log("ok: shared floor helper");
}

// hold: false opts a control out of keeping the area active.
{
  const c = new ctx.HierarchyAreaCard();
  const hass = {
    states: {
      "switch.holds": { state: "off", attributes: {} },
      "switch.free": { state: "on", attributes: {} },
    },
    callService() {},
  };
  c.setConfig({
    name: "Hold",
    controls: [{ entity: "switch.holds" }, { entity: "switch.free", hold: false }],
  });
  c.hass = hass;
  if (c._active()) throw new Error("hold: false must not activate the card");
  hass.states["switch.holds"].state = "on";
  c._sig = "";
  c.hass = hass;
  if (!c._active()) throw new Error("holding switch on must activate the card");
  console.log("ok: hold flag");
}

// Off targets only controls with hold ticked, and never downstreams.
{
  const c = new ctx.HierarchyAreaCard();
  c.setConfig({
    name: "Off",
    controls: [
      { entity: "switch.a" },
      { entity: "light.held", hold: true },
      { entity: "light.free", hold: false },
      { entity: "switch.b", downstream: [{ entity: "light.kid" }] },
    ],
  });
  const calls = [];
  c.hass = {
    states: Object.fromEntries(
      ["switch.a", "light.held", "light.free", "switch.b", "light.kid"].map((e) => [e, { state: "on", attributes: {} }])
    ),
    callService: (d, s, data) => calls.push({ d, s, ids: data.entity_id }),
  };
  c._master();
  const ids = calls[0].ids;
  if (!ids.includes("switch.a") || !ids.includes("light.held") || !ids.includes("switch.b")) {
    throw new Error("Off must include every holding control: " + JSON.stringify(ids));
  }
  if (ids.includes("light.free")) throw new Error("Off must skip hold: false");
  if (ids.includes("light.kid")) throw new Error("Off must never touch downstreams");
  console.log("ok: Off scope");
}
