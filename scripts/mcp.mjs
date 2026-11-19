// Minimal ha-mcp JSON-RPC client shared by the helper scripts.
//
// Set HA_MCP_URL to the ha-mcp endpoint. The endpoint URL carries its own
// auth token, so no separate credential is needed:
//
//   HA_MCP_URL="http://host:port/private_token" node scripts/<script>.mjs
let nextId = 1;

export function mcpUrl() {
  const url = process.env.HA_MCP_URL;
  if (!url) throw new Error("set HA_MCP_URL to the ha-mcp endpoint");
  return url;
}

export async function call(tool, args = {}) {
  const URL = mcpUrl();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300000);
  let body;
  try {
    const resp = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: tool, arguments: args } }),
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

// Write tools need the best-practice key from the skill guide.
export async function bestPracticeKey(file = "SKILL.md") {
  const guide = await call("ha_get_skill_guide", file ? { file } : {});
  const txt = typeof guide === "string" ? guide : JSON.stringify(guide);
  const key = txt.match(/I-HAVE-READ-THE-BEST-PRACTICES-GUIDE-[a-f0-9]+/)?.[0];
  if (!key) throw new Error("best-practice key not found in skill guide");
  return key;
}
