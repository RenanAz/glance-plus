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
import { call, bestPracticeKey } from "./mcp.mjs";

const [, , urlPath, dryFlag] = process.argv;
const dry = dryFlag === "--dry";
if (!urlPath) throw new Error("usage: node scripts/sync-visibility.mjs <dashboard-url-path> [--dry]");

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

const key = await bestPracticeKey();
const out = await call("ha_config_set_dashboard", {
  url_path: urlPath,
  config: cfg,
  config_hash: hash,
  BestPracticeKey: key,
  MandatoryBPS: false,
});
console.log(out.success ? `saved ${urlPath}` : JSON.stringify(out).slice(0, 400));
