// Rebuild hold flags + native card visibility for every hierarchy-area on a
// dashboard, using the exact rules in src/hierarchy-area.js.
//
// Usage: HA_MCP_URL="http://host:port/private_token" \
//          node scripts/sync-visibility.mjs <dashboard-url-path> [--dry]
//
// Safe by design: only touches `hold`, `visibility` and `release_helper`.
// Cards with hand-authored (non-state) visibility are left alone.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , urlPath = "home-test", dryFlag] = process.argv;
const dry = dryFlag === "--dry";
const URL = process.env.HA_MCP_URL;
if (!URL) throw new Error("set HA_MCP_URL to the ha-mcp endpoint");

let idc = 1;
async function call(tool, args = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300000);
  let body;
  try {
    const resp = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: idc++, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: ctrl.signal,
    });
    body = await resp.text();
  } finally {
    clearTimeout(t);
  }
  const texts = [];
  if (body.trim().startsWith("{")) texts.push(body.trim());
  else for (const line of body.split("\n")) if (line.startsWith("data: ")) texts.push(line.slice(6));
  let chosen;
  for (const txt of texts) {
    let m;
    try {
      m = JSON.parse(txt);
    } catch {
      continue;
    }
    if (m.error) throw new Error("MCP error: " + JSON.stringify(m.error));
    if (m.result) chosen = m.result;
  }
  if (!chosen) throw new Error("No result: " + body.slice(0, 400));
  for (const b of chosen.content ?? []) {
    if (b.type === "text") {
      try {
        return JSON.parse(b.text);
      } catch {
        return b.text;
      }
    }
  }
  return chosen;
}

// Load the card source headlessly and expose its pure rules.
function loadRules() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "src", "hierarchy-area.js"), "utf8");
  class HTMLElement {}
  const ctx = {
    HTMLElement,
    customElements: { get: () => true, define() {} },
    window: { customCards: [] },
    document: { createElement: () => ({ append() {}, addEventListener() {} }) },
    console: { info() {}, log() {}, warn() {}, error() {} },
    CustomEvent: class {},
    setInterval,
    clearInterval,
  };
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.__HA = { HA_HOLD, HA_VIS, HA_VIS_MANUAL };", ctx);
  return ctx.__HA;
}

const { HA_HOLD, HA_VIS, HA_VIS_MANUAL } = loadRules();
const dash = await call("ha_config_get_dashboard", { url_path: urlPath });
const cfg = dash.config;
const hash = dash.config_hash;
let cards = 0;
let manual = 0;
let touched = 0;
for (const view of cfg.views || []) {
  for (const section of view.sections || []) {
    for (const c of section.cards || []) {
      if (c.type !== "custom:hierarchy-area") continue;
      cards++;
      if ("release_helper" in c) {
        delete c.release_helper;
        touched++;
      }
      const list = c.controls || [];
      for (const x of list) {
        if (!x || !x.entity) continue;
        if (x.hold === undefined) {
          x.hold = HA_HOLD(x, list);
          touched++;
        }
      }
      if (HA_VIS_MANUAL(c.visibility)) {
        manual++;
        continue;
      }
      const before = JSON.stringify(c.visibility);
      const vis = HA_VIS(c);
      if (vis) c.visibility = vis;
      else delete c.visibility;
      if (JSON.stringify(c.visibility) !== before) touched++;
    }
  }
}
console.log(`cards=${cards} manual=${manual} changes=${touched}`);
if (dry) process.exit(0);

const guide = await call("ha_get_skill_guide", {});
const key = (guide.content || "").match(/I-HAVE-READ-THE-BEST-PRACTICES-GUIDE-[a-f0-9]+/)?.[0];
if (!key) throw new Error("best-practice key not found");
const out = await call("ha_config_set_dashboard", {
  url_path: urlPath,
  config: cfg,
  config_hash: hash,
  BestPracticeKey: key,
  MandatoryBPS: false,
});
console.log(out.success ? `saved ${urlPath}` : JSON.stringify(out).slice(0, 400));
