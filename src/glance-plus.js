/*
 * Glance Plus — a glance-like card with a fixed grid, Jinja text, per-cell
 * colours, optional blocks and a compact header that can toggle a `show_*`
 * helper.
 *
 * All Jinja is rendered in ONE `render_template` subscription per refresh
 * cycle. The header always renders, so the expand arrow is always reachable;
 * only the grid is conditional.
 * https://github.com/RenanAz/glance-plus
 */

const DEFAULTS = {
  title: null,
  icon: null,
  show_if: null,
  columns: 4,
  gap: "6px",
  cell_height: "32px",
  cell_background: "transparent",
  title_size: "14px",
  font_size: "12px",
  icon_size: "16px",
  align_title: "start",
  background: null,
  state_color: false,
  toggle_entity: null,
  update_interval: 0.5,
  cells: [],
  blocks: null,
};

const TIME_RE = /now\(\)|utcnow\(\)|today_at\(|as_timestamp\(now/;

class GlancePlusCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._cells = null; // last good render: [{i, b?, name, icon, color, bg}]
    this._blocks = null; // rendered block labels
    this._title = null;
    this._hicon = null;
    this._show = true;
    this._error = null;
    this._sig = "";
    this._timer = null;
    this._inflight = false;
    this._pending = false;
    this._last = 0;
    this._tick = null;
    this._painted = false;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") this._onClick(ev);
    });
  }

  static getConfigElement() {
    return document.createElement("glance-plus-editor");
  }

  static getStubConfig() {
    return {
      title: "Glance Plus",
      columns: 4,
      cells: [{ entity: "sensor.power_meter_active_power" }],
    };
  }

  setConfig(config) {
    if (!config) throw new Error("glance-plus: invalid configuration");
    const blocks = Array.isArray(config.blocks) && config.blocks.length ? config.blocks : null;
    this._config = Object.assign({}, DEFAULTS, config);
    this._config.blocks = blocks;
    // A card with neither key (fresh from the editor, blocks all deleted) is
    // simply empty, not an error.
    this._config.cells = Array.isArray(config.cells) ? config.cells : [];
    // One flat list, so the batched template and the DOM keep a stable index.
    this._flat = [];
    if (blocks) {
      blocks.forEach((b, bi) => (b.cells || []).forEach((cell) => this._flat.push({ bi, cell, block: b })));
    } else {
      (this._config.cells || []).forEach((cell) => this._flat.push({ bi: -1, cell, block: null }));
    }
    this._sig = "";
    this._painted = false;
    this._maybeFetch(true);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    this._chev();
    this._maybeFetch(first);
  }
  get hass() {
    return this._hass;
  }

  getCardSize() {
    const n = this._cells ? this._cells.length : 0;
    return Math.max(1, Math.ceil(n / Math.max(1, this._config?.columns || 4)) + 1);
  }

  connectedCallback() {
    // Time-based templates (now(), as_timestamp(now)) change without a state
    // change, so they need a slow periodic refresh.
    this._tick = setInterval(() => {
      const c = this._config;
      if (!c) return;
      const parts = [c.title, c.show_if];
      for (const { cell, block } of this._flat || []) {
        parts.push(cell.name, cell.icon, cell.color, cell.background, cell.show_if);
        if (block) parts.push(block.name, block.show_if);
      }
      if (TIME_RE.test(parts.join("\n"))) this._maybeFetch(true);
    }, 60000);
  }

  disconnectedCallback() {
    if (this._timer) clearTimeout(this._timer);
    if (this._tick) clearInterval(this._tick);
    this._timer = this._tick = null;
  }

  // ---- config → Jinja -----------------------------------------------------

  // A config string becomes a Jinja expression producing a string. Literal
  // text around {{ }} is concatenated with `~`, which matches how HA renders
  // text templates. `{% %}` blocks in cell fields are not supported.
  _val(s) {
    if (s == null) return "none";
    s = String(s);
    if (!s.includes("{{")) return JSON.stringify(s);
    const out = [];
    const re = /\{\{([\s\S]*?)\}\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(JSON.stringify(s.slice(last, m.index)));
      out.push("(" + m[1].trim() + ")|string");
      last = re.lastIndex;
    }
    if (last < s.length) out.push(JSON.stringify(s.slice(last)));
    return out.length === 1 ? out[0] : "(" + out.join(" ~ ") + ")";
  }

  // show_if: the inner expression of "{{ ... }}", or the raw string.
  _expr(s) {
    s = String(s);
    const m = s.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
    return (m ? m[1] : s).trim();
  }

  _template() {
    const c = this._config;
    const p = ["{% set ns = namespace(c=[]) %}"];
    this._flat.forEach(({ cell, block }, i) => {
      const conds = [];
      if (block && block.show_if != null) conds.push("(" + this._expr(block.show_if) + ")");
      if (cell.show_if != null) conds.push("(" + this._expr(cell.show_if) + ")");
      const cond = conds.length ? "(" + conds.join(") and (") + ")|bool" : "true";
      const f = ['"i":' + i];
      if (block) f.push('"b":' + this._flat[i].bi);
      for (const [key, out] of [
        ["name", "name"],
        ["icon", "icon"],
        ["color", "color"],
        ["background", "bg"],
      ]) {
        // Block values act as defaults for their cells.
        const v = cell[key] != null ? cell[key] : block ? block[key] : null;
        if (v != null) f.push(JSON.stringify(out) + ":" + this._val(v));
      }
      p.push("{% if " + cond + " %}{% set ns.c = ns.c + [{" + f.join(",") + "}] %}{% endif %}");
    });
    const blockLabels = (c.blocks || [])
      .map((b, i) => '{"i":' + i + ',"name":' + this._val(b.name) + ',"icon":' + this._val(b.icon) + "}");
    const show = c.show_if == null ? "true" : "(" + this._expr(c.show_if) + ")|bool";
    p.push(
      '{{ {"show":' + show + ',"title":' + this._val(c.title) + ',"icon":' + this._val(c.icon) +
        ',"blocks":[' + blockLabels.join(",") + '],"cells":ns.c}|tojson }}'
    );
    return p.join("\n");
  }

  // ---- refresh ------------------------------------------------------------

  _refs() {
    const ids = new Set();
    const add = (s) => {
      const found = String(s).match(/[a-z_]+\.[a-z0-9_]+/g);
      if (found) found.forEach((x) => ids.add(x));
    };
    for (const { cell, block } of this._flat || []) {
      if (cell.entity) ids.add(cell.entity);
      for (const k of ["name", "icon", "color", "background", "show_if"]) add(cell[k] ?? "");
      if (block) for (const k of ["name", "icon", "color", "background", "show_if"]) add(block[k] ?? "");
    }
    add(this._config.title ?? "");
    add(this._config.show_if ?? "");
    if (this._config.toggle_entity) ids.add(this._config.toggle_entity);
    return ids;
  }

  _signature() {
    const parts = [];
    for (const id of this._refs()) {
      const st = this._hass.states[id];
      parts.push(id + ":" + (st ? st.state : "-"));
    }
    return parts.sort().join("|");
  }

  _maybeFetch(force) {
    if (!this._hass || !this._config) return;
    const sig = this._signature();
    if (!force && sig === this._sig) return;
    this._sig = sig;
    const iv = Math.max(0, Number(this._config.update_interval) * 1000 || 0);
    const since = Date.now() - this._last;
    if (iv === 0 || since >= iv) {
      this._last = Date.now();
      this._fetch();
    } else if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._last = Date.now();
        this._fetch();
      }, iv - since);
    }
  }

  // HA 2026 renders templates as a subscription: the command acks with
  // result:null and the render arrives as an "event" message, either
  // {result, listeners} or {error}. Take the first event, then unsubscribe.
  // Older cores answered the command itself, hence the plain-object fallback.
  _renderOnce(template) {
    const conn = this._hass.connection;
    if (!conn || !conn.subscribeMessage) {
      return this._hass
        .callWS({ type: "render_template", template, variables: {}, timeout: 15, report_errors: true })
        .then((r) => (r && typeof r === "object" && "result" in r ? r.result : r));
    }
    return new Promise((resolve, reject) => {
      let done = false;
      let unsub = null;
      const stop = () => {
        const u = unsub;
        unsub = null;
        if (u) {
          try {
            u();
          } catch (e) {
            /* already gone */
          }
        }
      };
      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        if (err) reject(err);
        else resolve(val);
      };
      const timer = setTimeout(() => finish(new Error("template render timed out")), 15000);
      conn
        .subscribeMessage(
          (msg) => {
            if (msg && msg.error) return finish(new Error(String(msg.error)));
            finish(null, msg && typeof msg === "object" && "result" in msg ? msg.result : msg);
          },
          { type: "render_template", template, variables: {}, timeout: 15, report_errors: true }
        )
        .then(
          (u) => (done ? (() => { try { u(); } catch (e) {} })() : (unsub = u)),
          (e) => finish(e)
        );
    });
  }

  async _fetch() {
    if (this._inflight) {
      this._pending = true;
      return;
    }
    this._inflight = true;
    try {
      const raw = await this._renderOnce(this._template());
      if (raw === null || raw === undefined) throw new Error("empty render result");
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!data || typeof data !== "object" || !Array.isArray(data.cells)) {
        throw new Error("unexpected render result: " + JSON.stringify(raw).slice(0, 200));
      }
      this._cells = data.cells;
      this._blocks = Array.isArray(data.blocks) ? data.blocks : [];
      this._show = data.show !== false;
      this._title = data.title ?? null;
      this._hicon = data.icon ?? null;
      this._error = null;
    } catch (e) {
      this._error = (e && e.message ? e.message : String(e)).slice(0, 400);
    }
    this._inflight = false;
    this._paint();
    if (this._pending) {
      this._pending = false;
      this._fetch();
    }
  }

  // ---- render -------------------------------------------------------------

  _css() {
    const c = this._config;
    return `
      :host { display: block; }
      ha-card {
        padding: 8px 10px 10px;
        ${c.background ? "background: " + this._color(c.background) + ";" : ""}
      }
      .hdr {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        margin: 0 2px 6px;
      }
      .hdr.click { cursor: pointer; }
      .hmid { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
      .htitle {
        font-size: ${c.title_size};
        font-weight: 600;
        letter-spacing: .2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--primary-text-color);
      }
      .hicon { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
      .chev { display: flex; flex: none; }
      .chev ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
      .grid {
        display: grid;
        gap: ${c.gap};
      }
      .grid + .blabel { margin-top: 8px; }
      .blabel {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 0 2px 4px;
        font-size: 11px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      .blabel ha-icon { --mdc-icon-size: 13px; }
      .cell {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        min-height: ${c.cell_height};
        padding: 4px 9px;
        box-sizing: border-box;
        border: 1px solid var(--divider-color);
        border-radius: calc(${c.cell_height} / 2);
        cursor: pointer;
        overflow: hidden;
      }
      .cell:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
      .cell ha-icon { --mdc-icon-size: ${c.icon_size}; flex: none; }
      .txt {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
        min-width: 0;
        color: var(--primary-text-color);
      }
      .line {
        font-size: ${c.font_size};
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .txt.none { color: var(--disabled-text-color, #9e9e9e); }
      .badge {
        float: right;
        font-size: 10px;
        color: var(--error-color, #db4437);
        cursor: help;
      }
    `;
  }

  // HA named colours ("red", "accent") → theme variables; CSS values pass through.
  _color(v) {
    v = String(v).trim();
    if (/^[a-z]+$/.test(v) && !/^(transparent|inherit|currentcolor|none)$/.test(v)) {
      return "var(--" + v + "-color, " + v + ")";
    }
    return v;
  }

  _stateText(st) {
    if (!st) return "\u2014";
    if (this._hass.formatEntityState) {
      try {
        return this._hass.formatEntityState(st);
      } catch (e) {
        /* fall through */
      }
    }
    const u = st.attributes && st.attributes.unit_of_measurement;
    return st.state + (u ? " " + u : "");
  }

  _iconColor(cfg, block, st, rendered) {
    const v = rendered != null ? rendered : null;
    if (v != null) return this._color(v);
    if (this._config.state_color && st && st.state === "on") {
      return "var(--state-active-color, var(--accent-color, #fdd835))";
    }
    return "var(--state-icon-color, var(--secondary-text-color))";
  }

  _cellHtml({ cfg, block, x, st }) {
    const c = this._config;
    const txt = x.name != null ? x.name : this._stateText(st);
    const icon = x.icon != null ? x.icon : (st && st.attributes.icon) || cfg.icon || "mdi:circle-small";
    const bgv = x.bg != null ? x.bg : c.cell_background || "transparent";
    const span = Number(cfg.span) > 1 ? "grid-column:span " + Number(cfg.span) + ";" : "";
    return (
      '<div class="cell" tabindex="0" role="button" data-i="' + x.i + '" style="' + span +
        "background:" + this._color(bgv) + '">' +
      '<ha-icon icon="' + this._esc(icon) + '" style="color:' + this._esc(this._iconColor(cfg, block, st, x.color)) + '"></ha-icon>' +
      '<span class="txt' + (x.name == null && !st ? " none" : "") + '">' +
        this._lines(txt).map((l) => '<span class="line">' + this._esc(l) + "</span>").join("") +
        "</span>" +
      "</div>"
    );
  }

  _paint() {
    const c = this._config;
    if (!c) return;
    if (this._cells === null && this._error) {
      this.style.display = "";
      this.shadowRoot.innerHTML =
        "<ha-card style='padding:10px'><div class='badge'>glance-plus: " + this._esc(this._error) + "</div></ha-card>";
      return;
    }

    const title = this._title;
    const hicon = this._hicon;
    const hasToggle = !!c.toggle_entity;
    let hdr = "";
    if (title || hicon || hasToggle) {
      const justify = c.align_title === "start" ? "flex-start" : "center";
      hdr =
        '<div class="hdr' + (hasToggle ? " click" : "") + '"' + (hasToggle ? " data-toggle" : "") + ">" +
        '<div class="hmid" style="justify-content:' + justify + '">' +
        (hicon ? '<ha-icon class="hicon" icon="' + this._esc(hicon) + '"></ha-icon>' : "") +
        (title ? '<span class="htitle">' + this._esc(title) + "</span>" : "") +
        "</div>" +
        (hasToggle ? '<span class="chev"><ha-icon icon="mdi:chevron-down"></ha-icon></span>' : "") +
        "</div>";
    }

    // Grid is the only conditional part; the header always stays so the
    // expand arrow is always reachable.
    let body = "";
    if (this._show !== false) {
      const groups = new Map();
      for (const x of this._cells || []) {
        const item = this._flat[x.i];
        if (!item) continue;
        const st = this._hass.states[item.cell.entity];
        if (!groups.has(item.bi)) groups.set(item.bi, []);
        groups.get(item.bi).push(this._cellHtml({ cfg: item.cell, block: item.block, x, st }));
      }
      for (const [bi, list] of groups) {
        const block = bi >= 0 ? c.blocks[bi] : null;
        const label = bi >= 0 ? (this._blocks || []).find((b) => b.i === bi) : null;
        if (label && (label.name || label.icon)) {
          body +=
            '<div class="blabel">' +
            (label.icon ? '<ha-icon icon="' + this._esc(label.icon) + '"></ha-icon>' : "") +
            (label.name ? "<span>" + this._esc(label.name) + "</span>" : "") +
            "</div>";
        }
        const cols = Math.max(1, Number((block && block.columns) || c.columns) || 1);
        body +=
          '<div class="grid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' +
          list.join("") + "</div>";
      }
    }

    this.style.display = "";
    this.shadowRoot.innerHTML =
      "<style>" + this._css() + "</style><ha-card>" +
      (this._error ? '<div class="badge" title="' + this._esc(this._error) + '">!</div>' : "") +
      hdr + body + "</ha-card>";
    this._painted = true;
    this._chev();
  }

  // Only the chevron direction changes with the helper state, so it is patched
  // without re-rendering the grid.
  _chev() {
    if (!this._painted || !this._config || !this._config.toggle_entity) return;
    const icon = this.shadowRoot.querySelector(".chev ha-icon");
    if (!icon) return;
    const st = this._hass && this._hass.states[this._config.toggle_entity];
    const on = st && st.state === "on";
    icon.setAttribute("icon", on ? "mdi:chevron-up" : "mdi:chevron-down");
    const hdr = icon.closest(".hdr");
    if (hdr) hdr.title = on ? "Show less" : "Show all";
  }

  _onClick(ev) {
    const tgl = ev.target.closest("[data-toggle]");
    if (tgl) {
      const ent = this._config.toggle_entity;
      if (ent) this._hass.callService("homeassistant", "toggle", { entity_id: ent });
      return;
    }
    const cell = ev.target.closest(".cell");
    if (!cell) return;
    const item = this._flat[Number(cell.dataset.i)];
    if (item) this._action(item.cell.tap_action, item.cell.entity);
  }

  _action(action, entityId) {
    if (!action) action = { action: "more-info" };
    const type = action.action || "more-info";
    if (type === "none") return;
    if (type === "more-info") {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
      );
      return;
    }
    if (type === "toggle") {
      this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
      return;
    }
    if (type === "navigate") {
      if (action.navigation_path) history.pushState(null, "", action.navigation_path);
      this.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
      return;
    }
    if (type === "url") {
      if (action.url_path) window.open(action.url_path, "_blank");
      return;
    }
    const svc = action.perform_action || action.service;
    if (svc) {
      const [domain, name] = svc.split(".");
      const target = action.target || (entityId ? { entity_id: entityId } : undefined);
      this._hass.callService(domain, name, action.data || {}, target);
    }
  }

  // Newlines in the rendered text become separate, individually ellipsised lines.
  _lines(s) {
    return String(s ?? "").split(/\r?\n/);
  }

  _esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[ch]);
  }
}

if (!customElements.get("glance-plus")) customElements.define("glance-plus", GlancePlusCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "glance-plus",
  name: "Glance Plus",
  description: "Fixed-grid glance card with Jinja text, blocks, per-cell colours and a collapsible header.",
  preview: false,
  documentationURL: "https://github.com/RenanAz/glance-plus",
});

console.info("%c GLANCE-PLUS %c 1.1.0 ", "background:#6a1b9a;color:#fff", "");

/* ------------------------------------------------------------------ *
 * Visual editor: card options, cells, and blocks. Vanilla elements,
 * no framework. Entities/icons use HA's pickers when present.
 * ------------------------------------------------------------------ */

const GP_CARD_FIELDS = [
  { key: "title", label: "Title", type: "text" },
  { key: "icon", label: "Header icon", type: "icon" },
  { key: "toggle_entity", label: "Expand helper", type: "entity" },
  { key: "align_title", label: "Title align", type: "select", options: [["start", "Left"], ["center", "Center"]] },
  { key: "columns", label: "Columns", type: "number" },
  { key: "gap", label: "Gap", type: "text" },
  { key: "cell_height", label: "Cell height", type: "text" },
  { key: "background", label: "Card background", type: "color" },
  { key: "cell_background", label: "Cell background", type: "color" },
  { key: "state_color", label: "Colour icon when on", type: "bool" },
];

const GP_MORE_FIELDS = [
  { key: "title_size", label: "Title size", type: "text" },
  { key: "font_size", label: "Text size", type: "text" },
  { key: "icon_size", label: "Icon size", type: "text" },
  { key: "update_interval", label: "Refresh (s)", type: "number" },
  { key: "show_if", label: "Card show_if", type: "textarea", rows: 2, hint: "Jinja. Hides the grid, never the header." },
];

const GP_CELL_FIELDS = [
  { key: "entity", label: "Entity", type: "entity" },
  { key: "name", label: "Text", type: "textarea", rows: 2, hint: "Jinja allowed. Newlines give separate lines." },
  { key: "icon", label: "Icon", type: "icon" },
  { key: "color", label: "Icon colour", type: "color" },
  { key: "background", label: "Cell background", type: "color" },
  { key: "show_if", label: "Show if", type: "textarea", rows: 2, hint: "Jinja expression, e.g. is_state('x','on')" },
  { key: "span", label: "Span", type: "number" },
];

const GP_BLOCK_FIELDS = [
  { key: "name", label: "Block name", type: "text" },
  { key: "icon", label: "Block icon", type: "icon" },
  { key: "columns", label: "Columns", type: "number" },
  { key: "color", label: "Default icon colour", type: "color" },
  { key: "background", label: "Default background", type: "color" },
  { key: "show_if", label: "Show if", type: "textarea", rows: 2 },
];

const GP_EDITOR_CSS = `
  .ed { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
  .sec { border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-weight: 600; }
  .row { display: grid; grid-template-columns: 130px 1fr; gap: 8px; align-items: center; margin: 3px 0; }
  .row > label { font-size: 12px; color: var(--secondary-text-color); }
  input, select, textarea {
    font: inherit; font-size: 13px; width: 100%; box-sizing: border-box;
    padding: 4px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
  }
  textarea { resize: vertical; }
  input[type="checkbox"] { width: auto; }
  .inline { display: flex; gap: 6px; align-items: center; }
  .inline input[type="color"] { width: 36px; height: 30px; padding: 0; flex: none; }
  details { border: 1px solid var(--divider-color); border-radius: 8px; padding: 4px 8px; margin: 5px 0; }
  summary { cursor: pointer; font-size: 13px; font-weight: 500; }
  .btnrow { display: flex; gap: 6px; flex-wrap: wrap; }
  button {
    font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
  }
  .hint { font-size: 11px; color: var(--secondary-text-color); margin: 2px 0 5px; }
  .body { padding-top: 4px; }
`;

class GlancePlusEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._pickers = [];
    this._built = false;
    this._lastEmit = null;
  }

  set hass(hass) {
    this._hass = hass;
    for (const p of this._pickers) p.hass = hass;
  }
  get hass() {
    return this._hass;
  }

  setConfig(config) {
    const incoming = JSON.stringify(config || {});
    // Echo of our own edit: return BEFORE replacing this._config, else the
    // buttons built by the last _build() keep mutating the discarded object
    // and adding cells/blocks silently does nothing.
    if (this._built && incoming === this._lastEmit) return;
    this._config = JSON.parse(JSON.stringify(config || {}));
    this._build();
  }

  // ---- config plumbing ----------------------------------------------------

  _get(path) {
    let o = this._config;
    for (const k of path) {
      if (o == null) return undefined;
      o = o[k];
    }
    return o;
  }

  _put(path, value) {
    let o = this._config;
    for (let i = 0; i < path.length - 1; i++) {
      if (o[path[i]] == null) o[path[i]] = {};
      o = o[path[i]];
    }
    o[path[path.length - 1]] = value;
  }

  _set(path, value) {
    if (value === "" || value == null) {
      const parent = path.length > 1 ? this._get(path.slice(0, -1)) : this._config;
      if (parent && typeof parent === "object") delete parent[path[path.length - 1]];
    } else {
      this._put(path, value);
    }
    this._changed();
  }

  _changed() {
    this._lastEmit = JSON.stringify(this._config);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  // Structural edits need a rebuild; the emit keeps HA's copy in sync.
  _rebuilt() {
    this._lastEmit = JSON.stringify(this._config);
    this._build();
    this._changed();
  }

  // ---- controls -----------------------------------------------------------

  _text(value, onDone, rows) {
    const el = document.createElement(rows ? "textarea" : "input");
    if (rows) el.rows = rows;
    else el.type = "text";
    el.value = value ?? "";
    el.addEventListener("change", () => onDone(el.value.trim()));
    return el;
  }

  _num(value, onDone) {
    const el = document.createElement("input");
    el.type = "number";
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
    const txt = this._text(value, onDone);
    const sw = document.createElement("input");
    sw.type = "color";
    sw.value = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff";
    sw.addEventListener("change", () => {
      txt.value = sw.value;
      onDone(sw.value);
    });
    box.append(txt, sw);
    return box;
  }

  _picker(tag, value, onDone, props) {
    if (!customElements.get(tag)) return this._text(value, onDone);
    const el = document.createElement(tag);
    el.value = value ?? "";
    Object.assign(el, props || {});
    if (this._hass) el.hass = this._hass;
    el.addEventListener("value-changed", (ev) => onDone(ev.detail.value));
    this._pickers.push(el);
    return el;
  }

  _control(field, path) {
    const cur = this._get(path);
    const done = (v) => this._set(path, v);
    switch (field.type) {
      case "bool":
        return this._bool(cur, done);
      case "number":
        return this._num(cur, done);
      case "select":
        return this._select(cur, field.options, done);
      case "textarea":
        return this._text(cur, done, field.rows || 2);
      case "entity":
        return this._picker("ha-entity-picker", cur, done, { allowCustomEntity: true });
      case "icon":
        return this._picker("ha-icon-picker", cur, done);
      case "color":
        return this._color(cur, done);
      default:
        return this._text(cur, done);
    }
  }

  _rows(fields, base) {
    const frag = document.createDocumentFragment();
    for (const f of fields) {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("label");
      lab.textContent = f.label;
      row.append(lab, this._control(f, [...base, f.key]));
      frag.append(row);
      if (f.hint) {
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = f.hint;
        frag.append(hint);
      }
    }
    return frag;
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

  _button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  _details(summary, body) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = summary;
    const wrap = document.createElement("div");
    wrap.className = "body";
    wrap.append(body);
    d.append(s, wrap);
    return d;
  }

  // ---- layout -------------------------------------------------------------

  _build() {
    this._pickers = [];
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = GP_EDITOR_CSS;
    const ed = document.createElement("div");
    ed.className = "ed";

    const card = this._section("Card");
    card.append(this._rows(GP_CARD_FIELDS, []));
    ed.append(card);

    const more = this._section("Sizes & advanced");
    more.append(this._rows(GP_MORE_FIELDS, []));
    ed.append(more);

    ed.append(this._content());
    root.append(style, ed);
    this._built = true;
  }

  _content() {
    const c = this._config;
    const hasBlocks = Array.isArray(c.blocks);
    const items = hasBlocks ? c.blocks : c.cells || [];

    const addLabel = hasBlocks ? "+ Block" : "+ Cell";
    const actions = [
      this._button(addLabel, () => {
        if (hasBlocks) {
          c.blocks.push({ name: "", cells: [] });
        } else {
          c.cells = c.cells || [];
          c.cells.push({ entity: "" });
        }
        this._rebuilt();
      }),
    ];
    if (!hasBlocks && items.length) {
      actions.push(
        this._button("Group into blocks", () => {
          c.blocks = [{ name: "", cells: c.cells || [] }];
          delete c.cells;
          this._rebuilt();
        })
      );
    }
    if (hasBlocks) {
      actions.push(
        this._button("Flatten to cells", () => {
          c.cells = c.blocks.flatMap((b) => b.cells || []);
          delete c.blocks;
          this._rebuilt();
        })
      );
    }

    const sec = this._section(hasBlocks ? "Blocks" : "Cells", actions);

    if (hasBlocks) {
      c.blocks.forEach((block, bi) => {
        const body = document.createDocumentFragment();
        body.append(this._rows(GP_BLOCK_FIELDS, ["blocks", bi]));
        const btns = [];
        if (bi > 0) {
          btns.push(
            this._button("↑", () => {
              const b = c.blocks[bi];
              c.blocks[bi] = c.blocks[bi - 1];
              c.blocks[bi - 1] = b;
              this._rebuilt();
            })
          );
        }
        if (bi < c.blocks.length - 1) {
          btns.push(
            this._button("↓", () => {
              const b = c.blocks[bi];
              c.blocks[bi] = c.blocks[bi + 1];
              c.blocks[bi + 1] = b;
              this._rebuilt();
            })
          );
        }
        btns.push(
          this._button("+ Cell", () => {
            block.cells = block.cells || [];
            block.cells.push({ entity: "" });
            this._rebuilt();
          })
        );
        btns.push(
          this._button("Delete block", () => {
            c.blocks.splice(bi, 1);
            if (!c.blocks.length) delete c.blocks;
            this._rebuilt();
          })
        );
        const btnrow = document.createElement("div");
        btnrow.className = "btnrow";
        btnrow.append(...btns);
        body.append(btnrow);
        (block.cells || []).forEach((cell, ci) => {
          body.append(this._cellBox(cell, ["blocks", bi, "cells", ci], () => {
            block.cells.splice(ci, 1);
            this._rebuilt();
          }));
        });
        sec.append(this._details(`${block.name || "Block " + (bi + 1)} (${(block.cells || []).length})`, body));
      });
    } else {
      items.forEach((cell, ci) => {
        sec.append(
          this._cellBox(cell, ["cells", ci], () => {
            c.cells.splice(ci, 1);
            this._rebuilt();
          })
        );
      });
    }
    return sec;
  }

  _cellBox(cell, path, onDelete) {
    const body = document.createDocumentFragment();
    body.append(this._rows(GP_CELL_FIELDS, path));
    const del = this._button("Delete cell", onDelete);
    const btnrow = document.createElement("div");
    btnrow.className = "btnrow";
    btnrow.append(del);
    body.append(btnrow);
    const label = (cell.entity || "new cell") + (cell.name ? " · " + cell.name.split("\n")[0] : "");
    return this._details(label, body);
  }
}

if (!customElements.get("glance-plus-editor")) customElements.define("glance-plus-editor", GlancePlusEditor);
