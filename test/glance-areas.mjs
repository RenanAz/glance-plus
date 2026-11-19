// Self-check for glance-areas (Phase 1): resolver, formatting, circles, pills,
// toggle_off scope and empty states. No browser: stubs the few DOM APIs the
// card touches, like test/hierarchy-area.mjs.
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
  console: { ...console, info() {} },
  CustomEvent: class { constructor(t, o) { Object.assign(this, o); this.type = t; } },
  setTimeout,
  clearTimeout,
  Date,
  Intl,
};
vm.createContext(ctx);
vm.runInContext(
  readFileSync(fileURLToPath(new URL("../src/glance-areas.js", import.meta.url)), "utf8") +
    "\nthis.GlanceAreasCard = GlanceAreasCard;\nthis.gaConfig = gaConfig;\nthis.gaPower = gaPower;",
  ctx
);

const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log("ok: " + msg);
};

// ---- fixture --------------------------------------------------------------

const areas = {
  sala: {
    area_id: "sala", name: "Sala", floor_id: "first", icon: "mdi:sofa-outline",
    temperature_entity_id: "sensor.t_sala", humidity_entity_id: "sensor.h_sala",
  },
  corredor: {
    area_id: "corredor", name: "Corredor", floor_id: "first", icon: "mdi:coat-rack",
    temperature_entity_id: "sensor.t_corredor", humidity_entity_id: null,
  },
  varanda: { area_id: "varanda", name: "Varanda", floor_id: "first", icon: "mdi:door-sliding-open" },
  cozinha: { area_id: "cozinha", name: "Cozinha", floor_id: "first", icon: "mdi:fridge" },
  garage: { area_id: "garage", name: "Garagem", floor_id: "ground", icon: "mdi:garage" },
};

const entity = (entity_id, area_id, extra) => ({ entity_id, area_id, ...(extra || {}) });
const entities = {
  "sensor.t_sala": entity("sensor.t_sala", "sala"),
  "sensor.h_sala": entity("sensor.h_sala", "sala"),
  "sensor.t_corredor": entity("sensor.t_corredor", "corredor"),
  "sensor.sala_power": entity("sensor.sala_power", "sala"),
  "sensor.child_power": entity("sensor.child_power", "sala"),
  "sensor.orphan_power": entity("sensor.orphan_power", null),
  "climate.sala": entity("climate.sala", "sala"),
  "cover.sala": entity("cover.sala", "sala"),
  "light.sala_teto": entity("light.sala_teto", "sala"),
  "switch.sala_lampada": entity("switch.sala_lampada", "sala"),
  "switch.sala_config": entity("switch.sala_config", "sala", { entity_category: "config" }),
  "binary_sensor.porta_sala": entity("binary_sensor.porta_sala", "sala"),
  "binary_sensor.janela_sala": entity("binary_sensor.janela_sala", "sala"),
  "light.cozinha": entity("light.cozinha", "cozinha"),
};

const st = (state, attributes) => ({ state, attributes: attributes || {} });
const states = {
  "sensor.t_sala": st("21.5", { device_class: "temperature" }),
  "sensor.h_sala": st("68.4", { device_class: "humidity" }),
  "sensor.t_corredor": st("19.2", { device_class: "temperature" }),
  "sensor.sala_power": st("1400"),
  "sensor.child_power": st("300"),
  "climate.sala": st("heat"),
  "cover.sala": st("open"),
  "light.sala_teto": st("on"),
  "switch.sala_lampada": st("on"),
  "switch.sala_config": st("on"),
  "binary_sensor.porta_sala": st("on", { device_class: "door" }),
  "binary_sensor.janela_sala": st("off", { device_class: "window" }),
  "light.cozinha": st("off"),
};

const prefs = {
  device_consumption: [
    { stat_consumption: "sensor.sala_energy", stat_rate: "sensor.sala_power" },
    { stat_consumption: "sensor.child_energy", stat_rate: "sensor.child_power", included_in_stat: "sensor.sala_energy" },
    { stat_consumption: "sensor.orphan_energy", stat_rate: "sensor.orphan_power" },
    { stat_consumption: "sensor.no_rate_energy" },
  ],
};

const hass = {
  areas, floors: { first: { floor_id: "first", name: "Primeiro" } }, entities, devices: {},
  states,
  locale: { language: "pt-PT" },
  language: "pt-PT",
  callWS: async () => prefs,
  callService: (domain, service, data) => calls.push({ domain, service, ids: data.entity_id }),
};

const make = (config) => {
  const c = new ctx.GlanceAreasCard();
  c.setConfig(config);
  c.hass = hass;
  return c;
};
const html = (c) => c.shadowRoot.innerHTML;

// Energy prefs are fetched once per page; load them before the power checks so
// later cards render with the mapping in place.
{
  const boot = make({ floor: "first" });
  await new Promise((r) => setTimeout(r, 0));
  ok(html(boot).includes("1,4kW"), "energy prefs load populates per-area power");
}

// ---- config normalisation -------------------------------------------------

{
  const cfg = ctx.gaConfig({
    floor: "first",
    columns: 9,
    tile_height: 40,
    unknown_key: true,
    areas: [{ area: "sala", bubbles: ["doors", "windows", "lights", "extra"],
      circles: [{ type: "climate" }, { type: "bogus" }, { type: "lights" }, { type: "covers" }, { type: "climate" }] }],
  });
  ok(cfg.columns === 6, "columns clamped to 6");
  ok(cfg.tile_height === 160, "tile height clamped to 160");
  ok(cfg.areas[0].bubbles.length === 3, "bubbles capped at 3");
  ok(cfg.areas[0].circles.length === 3, "circles capped at 3");
  ok(cfg.areas[0].circles.map((c) => c.type).join(",") === "climate,lights,covers", "unknown/duplicate circles dropped in order");
  ok(cfg.areas_mode === "explicit", "areas present implies explicit");
  ok(ctx.gaPower(122, "pt-PT") === "122W", "power under 1 kW");
  ok(ctx.gaPower(1400, "pt-PT") === "1,4kW", "pt-PT decimal separator");
  ok(ctx.gaPower(12000, "pt-PT") === "12kW", "power over 10 kW");
}

// ---- floor → areas, registry order ---------------------------------------

{
  const c = make({ floor: "first" });
  const txt = html(c);
  ok(c._resolvedAreas().map((a) => a.area).join(",") === "sala,corredor,varanda,cozinha",
    "auto mode lists the floor's areas in registry order");
  ok(!txt.includes("Garagem"), "other floors are excluded");
  ok(txt.includes('style="--cols:3;--th:260px"'), "default geometry tokens");
}

// ---- readout omission -----------------------------------------------------

{
  const c = make({ floor: "first" });
  const txt = html(c);
  ok(txt.includes('<div class="r1"><span>22°</span><i class="dot">·</i><span>68%</span></div>'),
    "temp + humidity rounded (21.5 → 22)");
  ok(txt.includes('<div class="r1"><span>19°</span></div>'), "temperature-only area omits humidity, no gap");
  const corredor = txt.split('data-area="corredor"')[1].split('class="tile"')[0];
  ok(!corredor.includes("r2"), "unmapped area has no power line");
  const varanda = txt.split('data-area="varanda"')[1].split('class="tile"')[0];
  ok(!varanda.includes("r1"), "area with no sensors has no readout line");
}

// ---- power from Energy prefs ---------------------------------------------

{
  const c = make({ floor: "first" });
  const txt = html(c);
  ok(txt.includes("1,4kW"), "per-area power resolves from energy/get_prefs rate sensor");
  ok(!txt.includes("1,7kW"), "child meter inside the same area is not double counted");
}

// ---- circles --------------------------------------------------------------

{
  const c = make({ floor: "first", areas: [{ area: "sala" }] });
  const txt = html(c);
  ok(txt.includes('data-circle="climate"'), "climate circle renders");
  ok(txt.includes('data-circle="covers"'), "covers circle renders");
  ok(txt.includes('data-circle="lights"'), "lights circle renders");
  ok(txt.includes('icon="mdi:fire"'), "climate icon follows hvac mode (heat)");
  const lights = txt.split('data-circle="lights"')[1].split("</button>")[0];
  ok(lights.includes('<span class="badge">2</span>'), "lights badge counts on members only (config entity skipped)");
  ok(txt.includes('class="circ on"'), "active circle is tinted");
  const covers = txt.split('data-circle="covers"')[1].split("</button>")[0];
  ok(covers.includes("1 not closed"), "covers aria-label follows open shutters");
}

{
  const c = make({ floor: "first", areas: [{ area: "cozinha" }] });
  const txt = html(c);
  ok(!txt.includes("climate") && !txt.includes("covers"), "no circle without members");
  ok(!txt.includes('class="badge"'), "no badge when count is 0");
}

{
  const c = make({ floor: "first", areas: [{ area: "sala", circles: [{ type: "lights", exclude: ["light.sala_teto"] }] }] });
  const lights = html(c).split('data-circle="lights"')[1].split("</button>")[0];
  ok(lights.includes('<span class="badge">1</span>'), "circle exclude survives");
}

{
  const c = make({ floor: "first", areas: [{ area: "sala", circles: [{ type: "covers", behavior: "toggle_off" }] }] });
  calls.length = 0;
  const circle = html(c).split('data-circle="covers"')[0];
  c._turnOff(["cover.sala"]);
  ok(calls.length === 0, "covers are never turned off by toggle_off");
  ok(circle !== undefined, "toggle_off on an unsupported domain is a no-op");
}

// ---- lights toggle_off ----------------------------------------------------

{
  const onStates = { ...states, "light.cozinha": st("on") };
  const c = new ctx.GlanceAreasCard();
  c.setConfig({
    floor: "first",
    areas: [{
      area: "sala",
      circles: [{ type: "lights", behavior: "toggle_off", exclude: ["switch.sala_lampada"] }],
    }],
  });
  c.hass = { ...hass, states: onStates };
  calls.length = 0;
  const entry = c._resolvedAreas()[0];
  const model = c._areaModel(entry);
  const lights = model.circles.find((x) => x.type === "lights");
  c._turnOff(lights.members);
  const ids = calls.flatMap((x) => x.ids);
  ok(ids.length === 1 && ids[0] === "light.sala_teto",
    "turn_off targets exactly the included, on members, once");
  ok(!ids.includes("switch.sala_lampada"), "excluded member is never turned off");
  ok(lights.count === 1, "badge count follows the same exclusion");
  ok(calls.every((x) => x.service === "turn_off"), "service is turn_off");
}

// ---- openings -------------------------------------------------------------

{
  const c = make({ floor: "first", areas: [{ area: "sala" }] });
  const txt = html(c);
  ok(txt.includes('data-pill="doors"') && txt.includes('<span class="pcount">1</span>'),
    "open door increments the door pill");
  ok(!txt.includes('data-pill="windows"'), "closed window hides its pill at 0");
  ok(txt.includes('class="chev"'), "chevron always renders");
}

{
  const c = make({ floor: "first", areas: [{ area: "varanda" }] });
  const txt = html(c);
  ok(!txt.includes('data-pill="doors"') && !txt.includes('data-pill="windows"'),
    "no openings → chevron alone");
}

// ---- explicit list wins ---------------------------------------------------

{
  const c = make({ floor: "first", areas: [{ area: "cozinha" }, { area: "sala", name: "Sala Grande" }] });
  const txt = html(c);
  ok(txt.indexOf("Cozinha") < txt.indexOf("Sala Grande"), "explicit area order is respected");
  ok(txt.includes("Sala Grande"), "explicit name override survives");
  ok(!txt.includes(">Corredor<"), "areas outside the explicit list are not rendered");
}

// ---- empty / error states -------------------------------------------------

{
  const c = make({ floor: "first", areas_mode: "explicit", areas: [] });
  ok(html(c).includes("No areas on this floor."), "explicit empty list renders the empty state");
}

{
  const c = make({ floor: "nope" });
  ok(html(c).includes("No areas on this floor."), "unknown floor renders the empty state");
}

{
  const c = make({ floor: "first" });
  c._regError = "boom";
  c._sig = "";
  c._render();
  ok(html(c).includes("Area registry unavailable"), "registry failure is visible");
}

// ---- escaping -------------------------------------------------------------

{
  const c = make({ floor: "first", areas: [{ area: "sala", name: '<img src=x onerror="1">' }] });
  const txt = html(c);
  ok(!txt.includes("<img src=x"), "area names are escaped");
  ok(txt.includes("&lt;img"), "escaped name is rendered");
}

// ---- °F instance ----------------------------------------------------------

{
  const fStates = { ...states, "sensor.t_sala": st("71.6", { device_class: "temperature" }) };
  const c = new ctx.GlanceAreasCard();
  c.setConfig({ floor: "first", areas: [{ area: "sala" }] });
  c.hass = { ...hass, states: fStates, locale: { language: "en-US" } };
  ok(html(c).includes("<span>72°</span>"), "°F reading renders without a unit letter in the tile");
}

console.log("\nall glance-areas checks passed");
