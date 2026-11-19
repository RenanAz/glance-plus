// Author dev script: replace one dashboard section with the cards from
// examples/home-test-cards.mjs.
//
// DANGER: this overwrites a real dashboard section. It is kept as a reference
// for programmatic dashboard edits; the examples in this repo are anonymised,
// so running it against your own dashboard will apply generic room names.
//
// Usage: HA_MCP_URL="http://host:port/private_token" \
//          BACKUP_DIR=./backups \
//          node scripts/patch-home-test.mjs <dashboard-url-path> [section-index]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { call, bestPracticeKey } from "./mcp.mjs";
import { cards } from "../examples/home-test-cards.mjs";

const [, , urlPath, sectionArg] = process.argv;
if (!urlPath) throw new Error("usage: node scripts/patch-home-test.mjs <dashboard-url-path> [section-index]");
const section = Number.isInteger(Number(sectionArg)) ? Number(sectionArg) : 1;
const backupDir = process.env.BACKUP_DIR || "./backups";

const key = await bestPracticeKey("SKILL.md");

const cfg = await call("ha_config_get_dashboard", { url_path: urlPath });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(backupDir, { recursive: true });
writeFileSync(join(backupDir, `${urlPath}-${stamp}.json`), JSON.stringify(cfg.config, null, 1));
console.log("backup saved", stamp, "hash", cfg.config_hash);

const old = (cfg.config.views[0]?.sections?.[section]?.cards || []).map((c) => c.card?.title || c.type);
console.log("replacing:", JSON.stringify(old));

const out = await call("ha_config_set_dashboard", {
  url_path: urlPath,
  config_hash: cfg.config_hash,
  patch: [{ op: "replace", path: `/views/0/sections/${section}/cards`, value: cards }],
  MandatoryBPS: false,
  BestPracticeKey: key,
});
console.log("patch:", JSON.stringify(out).slice(0, 400));
