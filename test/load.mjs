import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
globalThis.console.info = () => {};
globalThis.HTMLElement = class { constructor(){ this.style={}; } attachShadow(){ this.shadowRoot={ addEventListener(){} }; } };
globalThis.customElements = { get: () => null, define: () => {} };
globalThis.window = {};
globalThis.document = { createElement: () => ({}) };
const src = readFileSync(fileURLToPath(new URL("../src/glance-plus.js", import.meta.url)), "utf8")
  .replace(/GlancePlusCard/g, "GPC") + "\nglobalThis.__C = GPC;\n";
new Function(src)();
export const Card = globalThis.__C;
export function templateFor(config) {
  const c = new Card();
  c.setConfig(config);
  return c._template();
}
