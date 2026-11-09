import { call } from "/workspace/HA/battery_morning_audit/mcp.mjs";
import { templateFor } from "./load.mjs";
import { cards } from "../examples/home-test-cards.mjs";

for (const card of cards) {
  const tpl = templateFor(card);
  const r = await call("ha_eval_template", { template: tpl });
  let lines = [];
  const res = typeof r === "string" ? r : r;
  const txt = JSON.stringify(res);
  const m = txt.match(/\{\\"title\\":.*?(?=\\",\\"warnings|\"warnings)/s);
  console.log("=== " + card.title + "  tpl=" + tpl.length + "b");
  if (res && res.success === false) { console.log("FAIL", txt.slice(0, 900)); continue; }
  const out = res.result ?? res.output ?? res;
  let data = typeof out === "string" ? JSON.parse(out) : out;
  if (data && typeof data === "object" && "result" in data) data = data.result;
  if (typeof data === "string") data = JSON.parse(data);
  console.log("title:", data.title, "| icon:", data.icon, "| cells:", data.cells.length);
  for (const c of data.cells) console.log("   ", JSON.stringify(c));
  if (res.warnings) console.log("warnings:", JSON.stringify(res.warnings).slice(0, 300));
}
