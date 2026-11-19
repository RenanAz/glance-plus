/*
 * Glance Areas — a floor as a grid of portrait area tiles.
 *
 * One card = one floor (or an explicit area list). Each tile shows the area
 * icon, a compact readout (temperature · humidity), the live power, up to
 * three domain circles with count badges and two opening pills around a
 * centred chevron.
 *
 * Phase 1 (this file): the collapsed grid, FR-01 … FR-11.
 * The vertical morph / detail panel (FR-12 … FR-20) is Phase 2-3 and is NOT
 * built here; the chevron is rendered but inert, and circles with
 * `behavior: focus` open Home Assistant's own more-info dialog as a stand-in.
 *
 * Derived values follow docs/glance-areas-PLAN.md D5/D6: explicit override →
 * registry → omitted. Never averaged, never zero-filled.
 *
 * https://github.com/RenanAz/glance-plus
 */

const VERSION = "0.1.0";

// ---- visual tokens (PLAN §8, mockup-measured) -----------------------------
const GA_TILE_H = 260;
const GA_COLS = 3;
const GA_ACCENT = "var(--accent-color, #818cf8)";
const GA_BADGE = "#f59e0b";

const GA_DOMAIN_COLOR = {
  light: "#fbbf24",
  switch: "#34d399",
  fan: "#38bdf8",
  cover: "#2dd4bf",
  climate: "#fb7185",
};

const GA_CIRCLE_ICON = {
  climate: "mdi:air-conditioner",
  covers: "mdi:window-shutter",
  lights: "mdi:ceiling-light",
};

const GA_CIRCLE_LABEL = {
  climate: "Climate",
  covers: "Covers",
  lights: "Lights",
};

const GA_CIRCLE_TYPES = ["climate", "covers", "lights"];
const GA_DEFAULT_CIRCLES = GA_CIRCLE_TYPES.map((type) => ({ type, behavior: "focus" }));

// FR-09 — icon follows state. Unknown state → neutral domain glyph.
const GA_MORPH = {
  climate: {
    heat: "mdi:fire",
    cool: "mdi:snowflake",
    dry: "mdi:water-percent",
    fan_only: "mdi:fan",
    heat_cool: "mdi:thermostat",
    auto: "mdi:autorenew",
    off: "mdi:power",
  },
  cover: {
    open: "mdi:window-shutter-open",
    closed: "mdi:window-shutter",
    opening: "mdi:window-shutter-open",
    closing: "mdi:window-shutter",
  },
  light: { on: "mdi:lightbulb-on", off: "mdi:lightbulb-outline" },
  switch: { on: "mdi:light-switch", off: "mdi:light-switch" },
  fan: { on: "mdi:fan", off: "mdi:fan-off" },
};

const GA_DEAD = new Set(["unavailable", "unknown", "none", ""]);
const GA_CLIMATE_ACTIVE = (s) => !GA_DEAD.has(s) && s !== "off";
const GA_COVER_OPEN = (s) => !GA_DEAD.has(s) && s !== "closed";

// ---- small helpers --------------------------------------------------------

const GA_CLAMP = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const GA_INT = (v, fallback, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return GA_CLAMP(Math.round(n), lo, hi);
};

const GA_STR = (v) => (typeof v === "string" ? v.trim() : "");

const GA_ARR = (v) => (Array.isArray(v) ? v : []);

const GA_NUM = (st) => {
  if (!st || GA_DEAD.has(st.state)) return null;
  const n = Number(st.state);
  return Number.isFinite(n) ? n : null;
};

// One shared formatter per locale; HA passes e.g. `pt-PT`. A container Node may
// ship without that locale's data, so fall back to a fixed decimal separator
// instead of silently printing the English one.
const GA_COMMA = /^(pt|es|fr|de|it|nl|pl|ru|tr|id|da|nb|sv|fi|cs|el|hr|ro|sl|sk|hu|bg|uk|ca|lt|lv|et|is)/i;

function gaFormat(value, digits, lang) {
  const loc = lang || "en";
  try {
    if (Intl.NumberFormat.supportedLocalesOf([loc]).length) {
      return new Intl.NumberFormat(loc, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    }
  } catch (e) {
    /* fall through to the manual formatter */
  }
  const sep = GA_COMMA.test(loc) ? "," : ".";
  return digits ? Number(value).toFixed(digits).replace(".", sep) : String(Math.round(value));
}

// 122 W / 1.4 kW / 12 kW, magnitude only.
function gaPower(value, lang) {
  if (value == null || !Number.isFinite(value)) return null;
  const w = Math.abs(value);
  if (w >= 1000) return gaFormat(w / 1000, w >= 10000 ? 0 : 1, lang) + "kW";
  return gaFormat(w, 0, lang) + "W";
}

const GA_ESC = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);

// ---- config normalisation (PLAN §6) --------------------------------------

function gaCircles(raw) {
  const list = Array.isArray(raw) ? raw : GA_DEFAULT_CIRCLES;
  const out = [];
  for (const item of list) {
    const c = typeof item === "string" ? { type: item } : item || {};
    const type = GA_STR(c.type);
    if (!GA_CIRCLE_TYPES.includes(type)) {
      console.warn("glance-areas: unknown circle type '" + type + "' skipped");
      continue;
    }
    if (out.some((x) => x.type === type)) continue;
    out.push({
      type,
      behavior: ["focus", "toggle_off", "none"].includes(c.behavior) ? c.behavior : "focus",
      confirm: c.confirm === true,
      hold: c.hold === true ? true : c.hold === false ? false : "auto",
      include: GA_ARR(c.include).map(GA_STR).filter(Boolean),
      exclude: GA_ARR(c.exclude).map(GA_STR).filter(Boolean),
    });
    if (out.length === 3) break;
  }
  return out;
}

function gaOpenings(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    doors: GA_ARR(o.doors).map(GA_STR).filter(Boolean),
    windows: GA_ARR(o.windows).map(GA_STR).filter(Boolean),
  };
}

// hierarchy-area's control list, reused: `hold` decides whether a switch counts
// as a holder (the lights circle badge and the toggle_off set). A downstream
// device is owned by its upstream switch and is never counted or switched off
// on its own.
function gaControls(raw) {
  const list = GA_ARR(raw)
    .map((x) => (typeof x === "string" ? { entity: x } : x || {}))
    .filter((c) => GA_STR(c.entity));
  const hasSwitch = list.some((c) => GA_STR(c.entity).startsWith("switch."));
  return list.map((c) => ({
    entity: GA_STR(c.entity),
    hold: c.hold !== undefined ? c.hold !== false : (GA_STR(c.entity).startsWith("switch.") || !hasSwitch),
    downstream: GA_ARR(c.downstream)
      .map((d) => GA_STR(d && d.entity ? d.entity : d))
      .filter(Boolean),
  }));
}

function gaArea(raw) {
  const a = typeof raw === "string" ? { area: raw } : raw || {};
  const id = GA_STR(a.area || a.area_id);
  if (!id) return null;
  return {
    area: id,
    name: GA_STR(a.name) || null,
    icon: GA_STR(a.icon) || null,
    accent: GA_STR(a.accent) || null,
    temperature: GA_STR(a.temperature) || null,
    humidity: GA_STR(a.humidity) || null,
    power: GA_STR(a.power && a.power.entity ? a.power.entity : a.power) || null,
    energy: GA_STR(a.energy && a.energy.entity ? a.energy.entity : a.energy) || null,
    climate: GA_STR(a.climate) || null,
    controls: gaControls(a.controls),
    circles: gaCircles(a.circles),
    openings: gaOpenings(a.openings),
    bubbles: GA_ARR(a.bubbles).map(GA_STR).filter(Boolean).slice(0, 3),
  };
}

function gaConfig(config) {
  const c = config && typeof config === "object" ? config : {};
  const areas = GA_ARR(c.areas).map(gaArea).filter(Boolean);
  const mode = c.areas_mode === "explicit" || c.areas_mode === "auto"
    ? c.areas_mode
    : areas.length ? "explicit" : "auto";
  return {
    type: "custom:glance-areas",
    title: GA_STR(c.title) || null,
    icon: GA_STR(c.icon) || "mdi:home",
    floor: GA_STR(c.floor) || null,
    columns: GA_INT(c.columns, GA_COLS, 1, 6),
    tile_height: GA_INT(c.tile_height, GA_TILE_H, 160, 420),
    areas_mode: mode,
    // Parsed but owned by Phase 2; kept so a config survives the upgrade.
    expand: c.expand && typeof c.expand === "object" ? c.expand : {},
    areas,
  };
}

// ---- module-level caches --------------------------------------------------
// Energy preferences: one read per page, shared by every card.
const GA_PREFS = { data: null, error: null, loading: false, retryAt: 0 };
// Registry fallback for cores/views that do not expose hass.entities.
const GA_REG = { data: null, error: null, loading: false, retryAt: 0 };
// Entity registry index, rebuilt only when the registry object changes.
let GA_INDEX = { key: null, map: null };

const GA_NONE = Object.freeze({ all: [], byDomain: new Map() });

function gaAreaIndexOf(hass) {
  if (!hass || !hass.entities) return null;
  if (GA_INDEX.key === hass.entities) return GA_INDEX.map;
  const map = new Map();
  const devices = hass.devices || {};
  for (const key of Object.keys(hass.entities)) {
    const e = hass.entities[key];
    if (!e || !e.entity_id) continue;
    if (e.disabled_by || e.hidden_by) continue;
    // Config/diagnostic entities are plumbing, never house state.
    if (e.entity_category === "config" || e.entity_category === "diagnostic") continue;
    let areaId = e.area_id || null;
    if (!areaId && e.device_id) {
      const d = devices[e.device_id];
      if (d) areaId = d.area_id || null;
    }
    if (!areaId) continue;
    let bucket = map.get(areaId);
    if (!bucket) {
      bucket = { all: [], byDomain: new Map() };
      map.set(areaId, bucket);
    }
    bucket.all.push(e.entity_id);
    const dom = e.entity_id.split(".")[0];
    if (!bucket.byDomain.has(dom)) bucket.byDomain.set(dom, []);
    bucket.byDomain.get(dom).push(e.entity_id);
  }
  GA_INDEX = { key: hass.entities, map };
  return map;
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

class GlanceAreasCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._cfg = null;
    this._sig = "";
    this._regError = null;
    this._prefsError = null;
    this.shadowRoot.addEventListener("click", (ev) => this._click(ev));
  }

  static getConfigElement() {
    return document.createElement("glance-areas-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:glance-areas",
      columns: GA_COLS,
      tile_height: GA_TILE_H,
      areas: [],
    };
  }

  setConfig(config) {
    this._config = config || {};
    this._cfg = gaConfig(config);
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureRegistry();
    this._ensureEnergy();
    this._render();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    const n = this._cfg ? this._resolvedAreas().length : 0;
    const rows = Math.max(1, Math.ceil(n / (this._cfg ? this._cfg.columns : GA_COLS)));
    return Math.max(2, rows * 6);
  }

  // ---- data plumbing ------------------------------------------------------

  _ensureEnergy() {
    if (GA_PREFS.data || GA_PREFS.loading) return;
    if (GA_PREFS.error && Date.now() < GA_PREFS.retryAt) return;
    if (!this._hass || typeof this._hass.callWS !== "function") return;
    GA_PREFS.loading = true;
    this._hass
      .callWS({ type: "energy/get_prefs" })
      .then((prefs) => {
        GA_PREFS.data = prefs || {};
        GA_PREFS.error = null;
      })
      .catch((e) => {
        GA_PREFS.error = (e && e.message) || String(e);
        GA_PREFS.retryAt = Date.now() + 60000;
      })
      .then(() => {
        GA_PREFS.loading = false;
        this._prefsError = GA_PREFS.error;
        this._sig = "";
        this._render();
      });
  }

  // hass.entities/areas/floors are always present on a modern frontend; the
  // websocket path is the fallback and the only place a non-admin can fail.
  _ensureRegistry() {
    const h = this._hass;
    if (!h) return;
    if (h.areas && h.entities && h.floors) {
      this._regError = null;
      return;
    }
    if (GA_REG.data || GA_REG.loading) {
      this._regError = GA_REG.error;
      return;
    }
    if (GA_REG.error && Date.now() < GA_REG.retryAt) {
      this._regError = GA_REG.error;
      return;
    }
    if (typeof h.callWS !== "function") return;
    GA_REG.loading = true;
    Promise.all([
      h.callWS({ type: "config/area_registry/list" }),
      h.callWS({ type: "config/floor_registry/list" }),
      h.callWS({ type: "config/entity_registry/list" }),
      h.callWS({ type: "config/device_registry/list" }),
    ])
      .then(([areas, floors, entities, devices]) => {
        GA_REG.data = {
          areas: Object.fromEntries((areas || []).map((a) => [a.area_id, a])),
          floors: Object.fromEntries((floors || []).map((f) => [f.floor_id, f])),
          entities: Object.fromEntries((entities || []).map((e) => [e.entity_id, e])),
          devices: Object.fromEntries((devices || []).map((d) => [d.id, d])),
        };
        GA_REG.error = null;
      })
      .catch((e) => {
        GA_REG.error = (e && e.message) || String(e);
        GA_REG.retryAt = Date.now() + 60000;
      })
      .then(() => {
        GA_REG.loading = false;
        this._regError = GA_REG.error;
        this._sig = "";
        this._render();
      });
  }

  _reg() {
    const h = this._hass;
    if (h && h.areas && h.floors && h.entities) {
      return { areas: h.areas, floors: h.floors, entities: h.entities, devices: h.devices || {} };
    }
    if (GA_REG.data) return GA_REG.data;
    return { areas: {}, floors: {}, entities: {}, devices: {} };
  }

  // Area list in render order: explicit entries win, else the floor's registry
  // areas in registry order (FR-01/FR-02).
  _resolvedAreas() {
    const cfg = this._cfg;
    if (!cfg) return [];
    if (cfg.areas.length) return cfg.areas;
    if (cfg.areas_mode === "explicit") return [];
    if (!cfg.floor) return [];
    const reg = this._reg();
    const out = [];
    for (const id of Object.keys(reg.areas || {})) {
      const a = reg.areas[id];
      if (a && a.floor_id === cfg.floor) out.push({ area: id, ...gaConfigDefaults() });
    }
    return out;
  }

  // Per-area power from the Energy prefs (D6): device_consumption[].stat_rate.
  _powerByArea() {
    const out = new Map();
    const prefs = GA_PREFS.data;
    if (!prefs || !this._hass) return out;
    const entries = GA_ARR(prefs.device_consumption);
    const areaOfStat = new Map();
    for (const d of entries) {
      if (!d || !d.stat_consumption) continue;
      const ent = d.stat_rate || d.stat_consumption;
      areaOfStat.set(d.stat_consumption, this._areaOfEntity(ent));
    }
    for (const d of entries) {
      if (!d || !d.stat_rate) continue;
      const area = this._areaOfEntity(d.stat_rate);
      if (!area) continue;
      // A child already counted by a parent meter in the same area would be
      // double counted; the parent owns the number.
      const parent = d.included_in_stat ? areaOfStat.get(d.included_in_stat) : null;
      if (parent && parent === area) continue;
      const w = GA_NUM(this._hass.states[d.stat_rate]);
      if (w == null) continue;
      out.set(area, (out.get(area) || 0) + w);
    }
    return out;
  }

  _areaOfEntity(entityId) {
    const h = this._hass;
    if (!h || !entityId || !h.entities || !h.entities[entityId]) return null;
    const e = h.entities[entityId];
    if (e.area_id) return e.area_id;
    if (e.device_id && h.devices && h.devices[e.device_id]) {
      return h.devices[e.device_id].area_id || null;
    }
    return null;
  }

  // ---- model --------------------------------------------------------------

  _areaModel(entry) {
    const h = this._hass;
    const reg = this._reg();
    const index = gaAreaIndexOf(h);
    const bucket = (index && index.get(entry.area)) || GA_NONE;
    const regArea = (reg.areas || {})[entry.area] || {};
    const accent = entry.accent || GA_ACCENT;
    const name = entry.name || regArea.name || entry.area;
    const icon = entry.icon || regArea.icon || "mdi:home-outline";

    const tempEnt = entry.temperature || regArea.temperature_entity_id ||
      this._firstByClass(bucket.all, "temperature");
    const humEnt = entry.humidity || regArea.humidity_entity_id ||
      this._firstByClass(bucket.all, "humidity");
    const tempVal = tempEnt ? GA_NUM(h.states[tempEnt]) : null;
    const humVal = humEnt ? GA_NUM(h.states[humEnt]) : null;

    const powerEnt = entry.power;
    let watts = powerEnt ? GA_NUM(h.states[powerEnt]) : null;
    if (watts == null && !powerEnt) {
      const mapped = this._powerByArea().get(entry.area);
      if (mapped != null) watts = mapped;
    }
    // A meter sitting at ~0 W is not a signal worth a line in a 225 px tile.
    if (watts != null && Math.round(Math.abs(watts)) === 0) watts = null;

    const circles = [];
    // D11 is an area-level rule: a lamp holds only when the area has no switch
    // at all. Decide it over the whole control pool, not over a filtered circle.
    const controlPool = entry.controls.length
      ? entry.controls.map((c) => c.entity)
      : (bucket.all || []).filter((id) => /^(light|switch)\./.test(id));
    const hasSwitch = controlPool.some((id) => id.startsWith("switch."));
    for (const c of entry.circles) {
      const m = this._circleMembers(c, entry, bucket, reg);
      if (!m.length) continue;
      circles.push(this._circleModel(c, m, entry, hasSwitch));
      if (circles.length === 3) break;
    }

    const openings = this._openings(entry, bucket, h);

    return {
      id: entry.area,
      name,
      icon,
      accent,
      temp: tempVal == null ? null : gaFormat(tempVal, 0, this._lang()),
      hum: humVal == null ? null : gaFormat(humVal, 0, this._lang()),
      watts,
      power: gaPower(watts, this._lang()),
      circles,
      doors: openings.doors,
      windows: openings.windows,
      open: false,
    };
  }

  _firstByClass(ids, deviceClass) {
    const h = this._hass;
    for (const id of ids || []) {
      if (!id.startsWith("sensor.")) continue;
      const st = h.states[id];
      if (st && st.attributes && st.attributes.device_class === deviceClass) return id;
    }
    return null;
  }

  _circleMembers(circle, entry, bucket, reg) {
    const all = bucket.all || [];
    let pool;
    if (circle.type === "climate") {
      pool = all.filter((id) => id.startsWith("climate."));
      if (entry.climate) pool = [entry.climate, ...pool.filter((id) => id !== entry.climate)];
    } else if (circle.type === "covers") {
      pool = all.filter((id) => id.startsWith("cover."));
    } else if (entry.controls.length) {
      // Declared controls win: same shape as hierarchy-area, so the hold
      // checkboxes and bundles carry over.
      pool = entry.controls.map((c) => c.entity);
    } else {
      pool = all.filter((id) => /^(light|switch|fan)\./.test(id));
    }
    if (circle.include.length) {
      const known = new Set(pool);
      pool = circle.include.filter((id) => known.has(id) || this._exists(id));
    }
    const excluded = new Set(circle.exclude);
    pool = pool.filter((id) => !excluded.has(id));
    // A downstream device is driven by its upstream switch; never treat it as
    // an independent holder or a toggle_off target.
    const downstream = new Set();
    for (const c of entry.controls) for (const d of c.downstream) downstream.add(d);
    if (circle.type === "lights") pool = pool.filter((id) => !downstream.has(id));
    return pool;
  }

  _exists(id) {
    return !!(this._hass && this._hass.states && this._hass.states[id]);
  }

  _circleModel(circle, members, entry, hasSwitch) {
    const h = this._hass;
    let count = 0;
    let icon = GA_CIRCLE_ICON[circle.type] || "mdi:circle-small";
    let activeId = null;
    const active = [];
    for (const id of members) {
      const st = h.states[id];
      const s = st ? st.state : "";
      let on = false;
      if (circle.type === "climate") on = GA_CLIMATE_ACTIVE(s);
      else if (circle.type === "covers") on = GA_COVER_OPEN(s);
      else on = s === "on" && this._holds(circle, id, entry, hasSwitch);
      if (on) {
        count += 1;
        active.push(id);
        if (!activeId) activeId = id;
      }
    }
    if (activeId) {
      const dom = activeId.split(".")[0];
      icon = (GA_MORPH[dom] && GA_MORPH[dom][h.states[activeId].state]) || icon;
    } else if (circle.type === "covers") {
      icon = GA_CIRCLE_ICON.covers;
    }
    return {
      type: circle.type,
      behavior: circle.behavior,
      confirm: circle.confirm,
      count,
      icon,
      color: GA_DOMAIN_COLOR[circle.type === "covers" ? "cover" : circle.type] || GA_ACCENT,
      first: members[0] || null,
      members,
      active,
    };
  }

  // hierarchy-area's hold rule (D11): an explicit `hold` on the control wins,
  // switches hold by default, lamps only in an area with no switch at all.
  _holds(circle, id, entry, hasSwitch) {
    if (circle.hold === true) return true;
    if (circle.hold === false) return false;
    const ctl = entry.controls.find((c) => c.entity === id);
    if (ctl) return ctl.hold;
    return id.startsWith("switch.") || !hasSwitch;
  }

  _openings(entry, bucket, hass) {
    const doors = new Set(entry.openings.doors);
    const windows = new Set(entry.openings.windows);
    for (const id of bucket.all || []) {
      if (!id.startsWith("binary_sensor.")) continue;
      const st = hass.states[id];
      const dc = st && st.attributes && st.attributes.device_class;
      if (dc === "door" || dc === "garage_door") doors.add(id);
      else if (dc === "window" || dc === "opening") windows.add(id);
    }
    const count = (ids) => [...ids].filter((id) => hass.states[id] && hass.states[id].state === "on").length;
    return { doors: count(doors), windows: count(windows) };
  }

  _lang() {
    const h = this._hass || {};
    return (h.locale && h.locale.language) || h.language || "en";
  }

  _signature(model) {
    const parts = [this._cfg.columns, this._cfg.tile_height, this._cfg.title, this._regError, this._prefsError];
    for (const a of model) {
      parts.push(
        a.id, a.name, a.icon, a.temp, a.hum, a.power, a.doors, a.windows,
        a.circles.map((c) => c.type + ":" + c.count + ":" + c.icon).join(",")
      );
    }
    return parts.join("|");
  }

  // ---- render -------------------------------------------------------------

  _render() {
    if (!this._hass || !this._cfg) return;
    const areas = this._resolvedAreas();
    const model = areas.map((a) => this._areaModel(a));
    const sig = this._signature(model);
    if (sig === this._sig) return;
    this._sig = sig;

    const cfg = this._cfg;
    const head = cfg.title
      ? '<div class="floor"><ha-icon icon="' + GA_ESC(cfg.icon) + '"></ha-icon><span>' +
        GA_ESC(cfg.title) + "</span></div>"
      : "";

    let body;
    if (!model.length) {
      const msg = this._regError
        ? "Area registry unavailable. Sign in as an administrator, or list areas explicitly."
        : cfg.floor
          ? "No areas on this floor."
          : "Set a floor, or list areas explicitly.";
      body = '<div class="empty"><ha-icon icon="mdi:home-search-outline"></ha-icon><span>' +
        GA_ESC(msg) + "</span></div>";
    } else {
      body = '<div class="grid" role="list">' + model.map((a) => this._tile(a)).join("") + "</div>";
    }

    const hints = [];
    if (this._regError) hints.push("Area registry unavailable: " + this._regError);
    if (this._prefsError) hints.push("Power unavailable, Energy preferences could not be read.");
    const warn = hints.length
      ? '<div class="warn" role="status">' + hints.map(GA_ESC).join(" · ") + "</div>"
      : "";

    this.shadowRoot.innerHTML =
      "<style>" + this._css() + "</style>" +
      '<div class="card" style="--cols:' + cfg.columns + ";--th:" + cfg.tile_height + 'px">' +
      head + body + warn + "</div>";
  }

  _tile(a) {
    const name = GA_ESC(a.name);
    const readout = [];
    if (a.temp != null) readout.push('<span>' + GA_ESC(a.temp) + "°</span>");
    if (a.hum != null) readout.push('<span>' + GA_ESC(a.hum) + "%</span>");
    const line1 = readout.length ? '<div class="r1">' + readout.join('<i class="dot">·</i>') + "</div>" : "";
    const line2 = a.power != null
      ? '<div class="r2"><ha-icon icon="mdi:lightning-bolt"></ha-icon><span>' + GA_ESC(a.power) + "</span></div>"
      : "";

    const circles = a.circles.length
      ? '<div class="circles">' + a.circles.map((c) => this._circle(a, c)).join("") + "</div>"
      : "";

    const doorPill = a.doors > 0 ? this._pill(a, "doors", a.doors) : "";
    const winPill = a.windows > 0 ? this._pill(a, "windows", a.windows) : "";

    return (
      '<div class="tile" role="listitem" data-area="' + GA_ESC(a.id) + '" style="--ac:' + GA_ESC(a.accent) + '">' +
        '<div class="top">' +
          '<ha-icon class="aicon" icon="' + GA_ESC(a.icon) + '"></ha-icon>' +
          '<div class="readout">' + line1 + line2 + "</div>" +
        "</div>" +
        '<div class="name" title="' + name + '">' + name + "</div>" +
        circles +
        '<div class="pills">' +
          '<span class="pslot">' + doorPill + "</span>" +
          '<button class="chev" type="button" aria-disabled="true" ' +
            'aria-label="Detail panel for ' + name + " (phase 2)\" title=\"Detail panel — phase 2\">" +
            '<ha-icon icon="mdi:chevron-down"></ha-icon></button>' +
          '<span class="pslot end">' + winPill + "</span>" +
        "</div>" +
      "</div>"
    );
  }

  _circle(area, c) {
    const label = GA_CIRCLE_LABEL[c.type];
    const n = c.count;
    let aria;
    if (c.type === "climate") aria = label + ": " + (n ? n + " active" : "all off");
    else if (c.type === "covers") aria = label + ": " + (n ? n + " not closed" : "all closed");
    else aria = label + ": " + (n ? n + " on" : "all off");
    if (c.behavior === "toggle_off") aria += ". Turn off";
    else if (c.behavior === "focus") aria += ". Details";
    const badge = n > 0 ? '<span class="badge">' + n + "</span>" : "";
    const cls = "circ" + (n > 0 ? " on" : "") + (c.behavior === "toggle_off" ? " act" : "");
    return (
      '<button class="' + cls + '" type="button" data-circle="' + c.type + '" data-area="' + GA_ESC(area.id) +
        '" style="--c:' + c.color + '" aria-label="' + GA_ESC(aria) + '">' +
        '<ha-icon icon="' + GA_ESC(c.icon) + '"></ha-icon>' + badge +
      "</button>"
    );
  }

  _pill(area, type, count) {
    const door = type === "doors";
    return (
      '<span class="pill" data-pill="' + type + '" aria-label="' +
      (door ? "Doors" : "Windows") + ": " + count + '">' +
      '<ha-icon icon="' + (door ? "mdi:door" : "mdi:window-closed-variant") + '"></ha-icon>' +
      '<span class="pcount">' + count + "</span>" +
      "</span>"
    );
  }

  // ---- interaction --------------------------------------------------------

  _click(ev) {
    const btn = ev.target.closest ? ev.target.closest("[data-circle]") : null;
    if (!btn) return;
    const type = btn.dataset.circle;
    const areaId = btn.dataset.area;
    const entry = (this._cfg.areas || []).find((a) => a.area === areaId) ||
      this._resolvedAreas().find((a) => a.area === areaId);
    if (!entry) return;
    const circle = (entry.circles || []).find((c) => c.type === type);
    if (!circle) return;
    const model = this._areaModel(entry);
    const cm = (model.circles || []).find((c) => c.type === type);
    if (!cm) return;

    if (circle.behavior === "none") return;
    if (circle.behavior === "focus") {
      // Phase 1 stand-in for the detail panel (Phase 2): HA's own dialog.
      const target = cm.first;
      if (!target) return;
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: target },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }
    if (circle.behavior === "toggle_off") this._turnOff(cm.active);
  }

  _turnOff(ids) {
    const h = this._hass;
    if (!h || !h.callService) return;
    const TOGGLE_OFF = new Set(["light", "switch", "fan", "input_boolean", "climate", "humidifier", "media_player"]);
    const byDomain = new Map();
    for (const id of ids) {
      const st = h.states[id];
      if (!st || st.state !== "on") continue;
      const dom = id.split(".")[0];
      if (!TOGGLE_OFF.has(dom)) continue;
      if (!byDomain.has(dom)) byDomain.set(dom, []);
      byDomain.get(dom).push(id);
    }
    for (const [domain, list] of byDomain) {
      h.callService(domain, "turn_off", { entity_id: list });
    }
  }

  // ---- styles -------------------------------------------------------------

  _css() {
    return `
      :host { display: block; }
      * { box-sizing: border-box; }
      .floor {
        display: flex; align-items: center; gap: 8px; margin: 0 2px 10px;
        font-size: 20px; font-weight: 600; color: var(--primary-text-color);
      }
      .floor ha-icon { --mdc-icon-size: 22px; opacity: .75; }

      .grid {
        display: grid;
        grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
        gap: 12px;
      }

      .tile {
        position: relative; display: flex; flex-direction: column;
        height: var(--th, 260px); min-width: 0;
        padding: 16px; border-radius: 20px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        overflow: hidden;
      }
      .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; min-height: 42px; }
      .aicon {
        --mdc-icon-size: 34px; color: var(--primary-text-color); opacity: .92; flex: none;
      }
      .readout {
        display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
        min-width: 0; text-align: right;
      }
      .r1 {
        font-size: 16px; line-height: 1.15; font-variant-numeric: tabular-nums;
        color: var(--primary-text-color); white-space: nowrap;
      }
      .r1 .dot { font-style: normal; opacity: .55; margin: 0 4px; }
      .r2 {
        display: inline-flex; align-items: center; gap: 2px;
        font-size: 15px; line-height: 1.1; font-variant-numeric: tabular-nums;
        color: var(--secondary-text-color); white-space: nowrap;
      }
      .r2 ha-icon { --mdc-icon-size: 15px; opacity: .8; }

      .name {
        margin-top: 8px; font-size: 22px; font-weight: 600; line-height: 1.15;
        letter-spacing: -.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .circles { display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 12px; }
      .circ {
        position: relative; flex: none; width: 44px; height: 44px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%; cursor: pointer;
        color: var(--secondary-text-color);
        background: transparent;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 16%, transparent);
        transition: background .12s ease, border-color .12s ease, color .12s ease;
      }
      .circ ha-icon { --mdc-icon-size: 20px; }
      .circ.on {
        color: var(--primary-text-color);
        background: color-mix(in srgb, var(--ac, #818cf8) 22%, transparent);
        border-color: color-mix(in srgb, var(--ac, #818cf8) 45%, transparent);
      }
      .circ.act.on { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ac, #818cf8) 40%, transparent); }
      .circ:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .badge {
        position: absolute; top: -4px; right: -4px;
        min-width: 18px; height: 18px; padding: 0 4px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600; line-height: 1;
        color: ${GA_BADGE};
        background: var(--card-background-color, #11141a);
        border: 1px solid color-mix(in srgb, ${GA_BADGE} 45%, transparent);
        border-radius: 999px;
      }

      .pills {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 8px; margin-top: 16px; min-height: 30px;
      }
      .pslot { display: flex; min-width: 0; }
      .pslot.end { justify-content: flex-end; }
      .pill {
        display: inline-flex; align-items: center; gap: 4px;
        height: 30px; padding: 0 10px; border-radius: 15px;
        font-size: 13px; font-variant-numeric: tabular-nums;
        color: var(--secondary-text-color);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
      }
      .pill ha-icon { --mdc-icon-size: 16px; }
      .pill .pcount { color: ${GA_BADGE}; font-weight: 600; }

      .chev {
        flex: none; width: 30px; height: 30px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%; color: var(--secondary-text-color);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
        cursor: default;
      }
      .chev ha-icon { --mdc-icon-size: 18px; display: flex; }
      .chev:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

      .empty {
        display: flex; align-items: center; gap: 8px; padding: 18px 4px;
        color: var(--secondary-text-color); font-size: 14px;
      }
      .empty ha-icon { --mdc-icon-size: 20px; opacity: .7; }
      .warn {
        margin-top: 10px; font-size: 12px; color: var(--warning-color, #f59e0b); opacity: .9;
      }

      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      @media (max-width: 420px) {
        .tile { padding: 14px; }
        .name { font-size: 20px; }
        .aicon { --mdc-icon-size: 30px; }
      }
    `;
  }
}

function gaConfigDefaults() {
  return {
    name: null,
    icon: null,
    accent: null,
    temperature: null,
    humidity: null,
    power: null,
    energy: null,
    climate: null,
    controls: [],
    circles: gaCircles(null),
    openings: { doors: [], windows: [] },
    bubbles: [],
  };
}

if (!customElements.get("glance-areas")) {
  customElements.define("glance-areas", GlanceAreasCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "glance-areas",
  name: "Glance Areas",
  description: "One floor as a grid of portrait area tiles: readout, power, domain circles and openings.",
  preview: false,
  documentationURL: "https://github.com/RenanAz/glance-plus",
});

console.info("%c GLANCE-AREAS %c " + VERSION + " ", "background:#4338ca;color:#fff", "");

/* ------------------------------------------------------------------ *
 * Editor — card + area list only (Phase 1). Vanilla elements, HA
 * pickers when they exist. Derived values are never written to YAML.
 * ------------------------------------------------------------------ */

const GAE_CSS = `
  :host { display: block; }
  * { box-sizing: border-box; }
  .ed { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 8px; }
  .sec { border: 1px solid var(--divider-color, rgba(255,255,255,.14)); border-radius: 10px; padding: 10px; }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .hd > span { font-size: 13px; font-weight: 600; color: var(--primary-text-color); text-transform: uppercase; letter-spacing: .06em; }
  .row { display: grid; grid-template-columns: 132px minmax(0, 1fr); align-items: center; gap: 10px; padding: 5px 0; }
  .row > label { font-size: 13px; color: var(--secondary-text-color); }
  input[type="text"], input[type="number"], select {
    width: 100%; padding: 8px 10px; font: inherit; font-size: 14px;
    color: var(--primary-text-color); background: var(--card-background-color, #1b1f27);
    border: 1px solid var(--divider-color, rgba(255,255,255,.18)); border-radius: 8px;
  }
  .inline { display: flex; gap: 6px; align-items: center; }
  .inline input[type="color"] { width: 34px; height: 34px; padding: 0; border: none; background: none; }
  .hint { font-size: 12px; line-height: 1.4; color: var(--secondary-text-color); opacity: .85; }
  .btnrow { display: flex; gap: 6px; }
  button {
    font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; cursor: pointer;
    color: var(--primary-text-color); background: var(--secondary-background-color, rgba(255,255,255,.06));
    border: 1px solid var(--divider-color, rgba(255,255,255,.18));
  }
  button:hover { background: rgba(255,255,255,.12); }
  button.del { color: #f87171; border-color: rgba(248,113,113,.5); }
  button.reset { color: var(--secondary-text-color); }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .ctlrow { border: 1px solid var(--divider-color, rgba(255,255,255,.14)); border-radius: 9px; overflow: hidden; }
  .ctlrow > summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; font-size: 13px; color: var(--primary-text-color);
  }
  .ctlrow > summary::-webkit-details-marker { display: none; }
  .cname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csub { margin-left: auto; font-size: 11px; color: var(--secondary-text-color); opacity: .8; }
  .fields { padding: 4px 10px 10px; border-top: 1px solid var(--divider-color, rgba(255,255,255,.1)); }
  .subhead {
    margin: 10px 0 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--secondary-text-color);
  }
  .ctl {
    margin: 6px 0; padding: 4px 8px; border-radius: 8px;
    background: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
    border: 1px solid var(--divider-color, rgba(255,255,255,.1));
  }
  .ctlhd { display: flex; align-items: center; gap: 8px; }
  .ctlhd .cname { flex: 1; min-width: 0; font-size: 12px; }
  .ver { font-size: 11px; color: var(--secondary-text-color); opacity: .7; }
`;

class GlanceAreasEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._pickers = [];
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
  }

  set hass(hass) {
    this._hass = hass;
    for (const p of this._pickers) p.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    if (!Array.isArray(this._config.areas)) this._config.areas = [];
    this._build();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: JSON.parse(JSON.stringify(this._config)) },
        bubbles: true,
        composed: true,
      })
    );
  }

  _set(key, value) {
    if (value === "" || value == null) delete this._config[key];
    else this._config[key] = value;
    this._emit();
  }

  _area(i) {
    return this._config.areas[i] || null;
  }

  _setArea(i, key, value) {
    const a = this._area(i);
    if (!a) return;
    if (value === "" || value == null) delete a[key];
    else a[key] = value;
    this._emit();
  }

  _resetArea(i) {
    const a = this._area(i);
    if (!a) return;
    for (const k of ["name", "icon", "accent", "temperature", "humidity", "power", "energy", "climate"]) delete a[k];
    this._emit();
    this._build();
  }

  _move(i, dir) {
    const arr = this._config.areas;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    this._emit();
    this._build();
  }

  _onClick(ev) {
    const b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    if (act === "add") {
      this._config.areas.push({ area: "", circles: [] });
      if (!this._config.areas_mode) this._config.areas_mode = "explicit";
      this._emit();
      this._build();
      return;
    }
    if (!Number.isInteger(i)) return;
    const area = this._area(i);
    const ci = Number(b.dataset.c);
    const di = Number(b.dataset.d);
    if (act === "addctl" && area) {
      if (!Array.isArray(area.controls)) area.controls = [];
      area.controls.push({ entity: "", hold: true, downstream: [] });
      this._emit();
      this._build();
      return;
    }
    if (act === "delctl" && area && Array.isArray(area.controls)) {
      area.controls.splice(ci, 1);
      if (!area.controls.length) delete area.controls;
      this._emit();
      this._build();
      return;
    }
    if (act === "adddown" && area && area.controls && area.controls[ci]) {
      const c = area.controls[ci];
      if (!Array.isArray(c.downstream)) c.downstream = [];
      c.downstream.push("");
      this._emit();
      this._build();
      return;
    }
    if (act === "deldown" && area && area.controls && area.controls[ci]) {
      const c = area.controls[ci];
      if (Array.isArray(c.downstream)) c.downstream.splice(di, 1);
      this._emit();
      this._build();
      return;
    }
    if (act === "del") {
      this._config.areas.splice(i, 1);
      this._emit();
      this._build();
    } else if (act === "up") this._move(i, -1);
    else if (act === "down") this._move(i, 1);
    else if (act === "reset") this._resetArea(i);
  }

  // ---- controls -----------------------------------------------------------

  _text(value, onDone, placeholder) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value ?? "";
    if (placeholder) el.placeholder = placeholder;
    el.addEventListener("change", () => onDone(el.value.trim()));
    return el;
  }

  _num(value, onDone, min, max) {
    const el = document.createElement("input");
    el.type = "number";
    el.min = String(min ?? 1);
    el.max = String(max ?? 99);
    el.value = value ?? "";
    el.addEventListener("change", () => {
      const v = el.value.trim();
      onDone(v === "" ? "" : Number(v));
    });
    return el;
  }

  _select(value, options, onDone) {
    const el = document.createElement("select");
    for (const [v, label] of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      el.append(o);
    }
    el.value = value ?? options[0][0];
    el.addEventListener("change", () => onDone(el.value));
    return el;
  }

  _bool(value, onDone) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = !!value;
    el.addEventListener("change", () => onDone(el.checked));
    return el;
  }

  _color(value, onDone) {
    const box = document.createElement("div");
    box.className = "inline";
    const txt = this._text(value, onDone, "auto");
    const sw = document.createElement("input");
    sw.type = "color";
    sw.value = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#818cf8";
    sw.addEventListener("change", () => {
      txt.value = sw.value;
      onDone(sw.value);
    });
    box.append(txt, sw);
    return box;
  }

  _picker(tag, value, onDone, props) {
    if (!customElements.get(tag)) return this._text(value, onDone, "auto");
    const el = document.createElement(tag);
    el.value = value ?? "";
    Object.assign(el, props || {});
    if (this._hass) el.hass = this._hass;
    el.addEventListener("value-changed", (ev) => onDone(ev.detail.value));
    this._pickers.push(el);
    return el;
  }

  _row(label, control) {
    const row = document.createElement("div");
    row.className = "row";
    const lab = document.createElement("label");
    lab.textContent = label;
    row.append(lab, control);
    return row;
  }

  _section(title, actions) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const hd = document.createElement("div");
    hd.className = "hd";
    const t = document.createElement("span");
    t.textContent = title;
    hd.append(t);
    if (actions && actions.length) {
      const row = document.createElement("div");
      row.className = "btnrow";
      row.append(...actions);
      hd.append(row);
    }
    sec.append(hd);
    return sec;
  }

  _button(label, act, i, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (act) b.dataset.act = act;
    if (i != null) b.dataset.i = String(i);
    if (cls) b.className = cls;
    return b;
  }

  // ---- layout -------------------------------------------------------------

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    this._pickers = [];
    const style = document.createElement("style");
    style.textContent = GAE_CSS;
    const ed = document.createElement("div");
    ed.className = "ed";

    const floors = this._hass && this._hass.floors ? Object.values(this._hass.floors) : [];
    const floorOpts = [["", "— none —"]].concat(
      floors.map((f) => [f.floor_id, f.name || f.floor_id])
    );

    const card = this._section("Card");
    card.append(
      this._row("Title", this._text(this._config.title, (v) => this._set("title", v), "hidden")),
      this._row("Icon", this._picker("ha-icon-picker", this._config.icon, (v) => this._set("icon", v))),
      this._row("Floor", this._select(this._config.floor || "", floorOpts, (v) => this._set("floor", v))),
      this._row("Columns", this._num(this._config.columns, (v) => this._set("columns", v), 1, 6)),
      this._row("Tile height", this._num(this._config.tile_height, (v) => this._set("tile_height", v), 160, 420)),
      this._row(
        "Areas mode",
        this._select(this._config.areas_mode || "auto", [
          ["auto", "Auto (floor registry)"],
          ["explicit", "Explicit list"],
        ], (v) => this._set("areas_mode", v))
      )
    );
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Auto lists every area of the chosen floor. Explicit uses the list below, in order, and wins.";
    card.append(hint);

    const add = this._button("+ Area", "add");
    const sec = this._section("Areas", [add]);
    const list = document.createElement("div");
    list.className = "list";
    sec.append(list);

    if (!this._config.areas.length) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = "No areas yet. Add one, or switch Areas mode to Auto.";
      list.append(h);
    } else {
      this._config.areas.forEach((a, i) => list.append(this._areaRow(a, i)));
    }

    const ver = document.createElement("div");
    ver.className = "ver";
    ver.textContent = "glance-areas " + VERSION;

    ed.append(card, sec, ver);
    root.append(style, ed);
  }

  _areaRow(a, i) {
    const row = document.createElement("details");
    row.className = "ctlrow";
    const sum = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "cname";
    const sub = document.createElement("span");
    sub.className = "csub";
    const sync = () => {
      const cur = this._area(i) || a;
      name.textContent = cur.name || cur.area || "new area";
      sub.textContent = cur.area || "";
    };
    sync();
    sum.append(name, sub, this._button("↑", "up", i), this._button("↓", "down", i), this._button("✕", "del", i, "del"));
    row.append(sum);

    const fields = document.createElement("div");
    fields.className = "fields";
    fields.append(
      this._row("Area", this._picker("ha-area-picker", a.area, (v) => {
        this._setArea(i, "area", v);
        sync();
      })),
      this._row("Name", this._text(a.name, (v) => {
        this._setArea(i, "name", v);
        sync();
      }, "registry name")),
      this._row("Icon", this._picker("ha-icon-picker", a.icon, (v) => this._setArea(i, "icon", v))),
      this._row("Accent", this._color(a.accent, (v) => this._setArea(i, "accent", v))),
      this._row("Temperature", this._picker("ha-entity-picker", a.temperature, (v) => {
        this._setArea(i, "temperature", v);
      }, { includeDomains: ["sensor"], allowCustomEntity: true })),
      this._row("Humidity", this._picker("ha-entity-picker", a.humidity, (v) => {
        this._setArea(i, "humidity", v);
      }, { includeDomains: ["sensor"], allowCustomEntity: true })),
      this._row("Power", this._picker("ha-entity-picker", a.power && a.power.entity, (v) => {
        this._setArea(i, "power", v ? { entity: v } : "");
      }, { includeDomains: ["sensor"], allowCustomEntity: true }))
    );

    // Lights-circle holders: the hierarchy-area control list, with the same
    // per-device "holds card" checkbox and downstream ownership.
    const subHead = document.createElement("div");
    subHead.className = "subhead";
    subHead.textContent = "Switches & devices — the lights circle counts holders";
    fields.append(subHead);
    const ctls = Array.isArray(a.controls) ? a.controls : [];
    if (!ctls.length) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent =
        "Auto: every switch in the area holds; lamps hold only when the area has no switch.";
      fields.append(h);
    }
    ctls.forEach((c, ci) => fields.append(this._controlRow(i, ci, c)));
    fields.append(this._button("+ Device", "addctl", i));

    const reset = this._button("Reset overrides to auto", "reset", i, "reset");
    fields.append(reset);
    row.append(fields);
    return row;
  }

  _controlRow(i, ci, c) {
    const box = document.createElement("div");
    box.className = "ctl";
    const at = () => ((this._config.areas[i] || {}).controls || [])[ci];

    const hd = document.createElement("div");
    hd.className = "ctlhd";
    const label = document.createElement("span");
    label.className = "cname";
    label.textContent = c.entity || "new device";
    const del = this._button("✕", "delctl", i, "del");
    del.dataset.c = String(ci);
    hd.append(label, del);
    box.append(hd);

    box.append(
      this._row("Entity", this._picker("ha-entity-picker", c.entity, (v) => {
        const cur = at();
        if (!cur) return;
        cur.entity = v;
        label.textContent = v || "new device";
        this._emit();
      }, { allowCustomEntity: true })),
      this._row("Holds card", this._bool(c.hold !== false, (v) => {
        const cur = at();
        if (!cur) return;
        cur.hold = v;
        this._emit();
      }))
    );

    const downs = Array.isArray(c.downstream) ? c.downstream : [];
    downs.forEach((d, di) => {
      const wrap = document.createElement("div");
      wrap.className = "inline";
      const pick = this._picker("ha-entity-picker", d, (v) => {
        const cur = at();
        if (!cur) return;
        if (!Array.isArray(cur.downstream)) cur.downstream = [];
        if (v) cur.downstream[di] = v;
        else cur.downstream.splice(di, 1);
        this._emit();
        this._build();
      }, { allowCustomEntity: true });
      const rm = this._button("✕", "deldown", i, "del");
      rm.dataset.c = String(ci);
      rm.dataset.d = String(di);
      wrap.append(pick, rm);
      box.append(this._row(di === 0 ? "Downstream" : "", wrap));
    });
    const addDown = this._button("+ Downstream", "adddown", i);
    addDown.dataset.c = String(ci);
    const downWrap = document.createElement("div");
    downWrap.className = "btnrow";
    downWrap.append(addDown);
    box.append(this._row("", downWrap));
    return box;
  }
}

if (!customElements.get("glance-areas-editor")) {
  customElements.define("glance-areas-editor", GlanceAreasEditor);
}
