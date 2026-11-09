import { call } from "/workspace/HA/battery_morning_audit/mcp.mjs";
import { writeFileSync } from "node:fs";
import { cards } from "../examples/home-test-cards.mjs";

const g = await call("ha_get_skill_guide", { file: "SKILL.md" });
const txt = typeof g === "string" ? g : JSON.stringify(g);
const key = txt.match(/I-HAVE-READ-THE-BEST-PRACTICES-GUIDE-[a-f0-9]+/)?.[0];
if (!key) { console.log("no BPS key in:", txt.slice(0, 300)); process.exit(1); }

const cfg = await call("ha_config_get_dashboard", { url_path: "home-test" });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`/workspace/HA/dashboard_backups/home-test-${stamp}.json`, JSON.stringify(cfg.config, null, 1));
console.log("backup saved", stamp, "hash", cfg.config_hash);

const old = cfg.config.views[0].sections[1].cards.map((c) => c.card?.title || c.type);
console.log("replacing:", JSON.stringify(old));

const out = await call("ha_config_set_dashboard", {
  url_path: "home-test",
  config_hash: cfg.config_hash,
  patch: [{ op: "replace", path: "/views/0/sections/1/cards", value: cards }],
  MandatoryBPS: false,
  BestPracticeKey: key,
});
console.log("patch:", JSON.stringify(out).slice(0, 400));
