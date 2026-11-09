import { readFileSync } from "node:fs";
import { cards } from "../examples/home-test-cards.mjs";
const TOKEN = readFileSync("./.secrets/testha_token", "utf8").trim();

// --- load card class with DOM stubs -------------------------------------
globalThis.console.info = () => {};
globalThis.HTMLElement = class {
  constructor() { this.style = {}; }
  attachShadow() { this.shadowRoot = { innerHTML: "", addEventListener() {}, querySelector: () => null }; }
};
globalThis.customElements = { get: () => null, define: () => {} };
globalThis.window = {};
globalThis.document = { createElement: () => ({}) };
const src = readFileSync("src/glance-plus.js", "utf8").replace(/GlancePlusCard/g, "GPC") + "\nglobalThis.__C = GPC;\n";
new Function(src)();
const Card = globalThis.__C;

// --- fake hass.connection.subscribeMessage over a real websocket ---------
const ws = new WebSocket("ws://homeassistant.local:8123/api/websocket");
let cmdId = 10;
const pending = new Map();
const subs = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "auth_required") return ws.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
  if (m.type === "auth_ok") return start();
  if (m.type === "event" && subs.has(m.id)) { subs.get(m.id)(m.event); if (m.id) ws.send(JSON.stringify({ id: ++cmdId, type: "unsubscribe_events", subscription: m.id })); return; }
  if (m.type === "result" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(msg) {
  const id = ++cmdId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, ...msg }));
    setTimeout(() => reject(new Error("ws timeout")), 12000);
  });
}
const connection = {
  subscribeMessage(cb, msg) {
    const id = ++cmdId;
    subs.set(id, cb);
    ws.send(JSON.stringify({ id, ...msg }));
    return Promise.resolve(() => { subs.delete(id); return Promise.resolve(); });
  },
};
const hass = {
  states: {},
  connection,
  callWS: send,
  formatEntityState: (st) => st.state,
};

async function start() {
  for (const card of cards) {
    const el = new Card();
    el.setConfig(card);
    el._hass = hass;
    el._paint = function () { this._paintCalled = true; };
    await el._fetch();
    el._paint();
    const html = el.shadowRoot.innerHTML || "";
    console.log("   html:", html.length, "b | blabel:", html.includes('class="blabel"'), "| grids:", (html.match(/class="grid"/g) || []).length, "| header:", html.includes('class="htitle"'));
    console.log(
      (card.title + "                    ").slice(0, 20),
      "cells:", el._cells ? el._cells.length : "null",
      "| show:", el._show,
      "| title:", JSON.stringify(el._title),
      "| error:", el._error
    );
  }
  ws.close();
  process.exit(0);
}
setTimeout(() => { console.log("timeout"); process.exit(1); }, 20000);
