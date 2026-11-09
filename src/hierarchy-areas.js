/*
 * Hierarchy Areas — a floor/area switch board in the Hierarchy Power/Energy
 * visual language.
 *
 * Areas with nothing on collapse into pills at the top; areas with something
 * on expand below. Tapping an area expands it in place, tapping the card
 * header expands every area ("show more"). A wall plate of several rockers is
 * declared as one `plates[]` entry, and a rocker can own `downstream` devices
 * (LED strips fed by that switch).
 *
 * https://github.com/RenanzAz/hierarchy-cards
 */

const HA_ACCENT = [
  "#818cf8", // indigo
  "#a78bfa", // violet
  "#e879f9", // fuchsia
  "#fb7185", // rose
  "#fbbf24", // amber
  "#34d399", // emerald
  "#2dd4bf", // teal
  "#38bdf8", // sky
  "#a3e635", // lime
  "#fb923c", // orange
];

// State colour per domain: one colour per kind of load, muted when off.
const HA_ON_COLOR = {
  light: "#fbbf24",
  switch: "#34d399",
  fan: "#38bdf8",
  input_boolean: "#a78bfa",
  media_player: "#f472b6",
  cover: "#2dd4bf",
};

const HA_ICON = {
  light: "mdi:lightbulb",
  switch: "mdi:light-switch",
  fan: "mdi:fan",
  input_boolean: "mdi:toggle-switch",
  media_player: "mdi:speaker",
  cover: "mdi:window-shutter",
};

const HA_NORM = (list) =>
  (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? { entity: x } : x || {}))
    .filter((x) => x.entity);

class HierarchyAreasCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._areas = [];
    this._map = new Map(); // rocker entity -> downstream config
    this._pins = new Map(); // area index -> explicit open/closed
    this._expandAll = false;
    this._sig = "";
    this._raf = null;
    this._held = false;
    this._holdT = null;
    this.shadowRoot.addEventListener("click", (ev) => this._click(ev));
    this.shadowRoot.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const t = ev.target.closest("[data-head],[data-open]");
      if (!t) return;
      ev.preventDefault();
      t.click();
    });
    this.shadowRoot.addEventListener("pointerdown", (ev) => this._down(ev));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) {
      this.shadowRoot.addEventListener(t, () => this._up());
    }
  }

  static getConfigElement() {
    return document.createElement("hierarchy-areas-editor");
  }

  static getStubConfig() {
    return {
      title: "1st Floor",
      icon: "mdi:home-floor-1",
      areas: [
        {
          name: "Sala",
          icon: "mdi:sofa-outline",
          plates: [
            {
              name: "Triplo 1",
              rockers: [
                {
                  entity: "switch.example_left",
                  name: "Lavabo",
                  downstream: [{ entity: "light.example_led", name: "LED Strip" }],
                },
              ],
            },
          ],
          devices: ["light.example_floor"],
        },
      ],
    };
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.areas)) {
      throw new Error("hierarchy-areas: 'areas' must be a list");
    }
    const prevPins = this._pins;
    this._config = config;
    this._map = new Map();
    this._areas = config.areas
      .map((a, i) => {
        const plates = (Array.isArray(a.plates) ? a.plates : [])
          .map((p) => ({
            name: p.name || null,
            rockers: HA_NORM(p.rockers).map((r) => ({
              entity: r.entity,
              name: r.name || null,
              icon: r.icon || null,
              downstream: HA_NORM(r.downstream),
            })),
          }))
          .filter((p) => p.rockers.length);
        const area = {
          idx: i,
          name: a.name || "Area " + (i + 1),
          icon: a.icon || "mdi:home-outline",
          accent: a.accent || HA_ACCENT[i % HA_ACCENT.length],
          master: a.toggle !== false,
          toggle_entity: a.toggle_entity || null,
          plates,
          devices: HA_NORM(a.devices),
        };
        for (const p of plates) {
          for (const r of p.rockers) this._map.set(r.entity, r);
        }
        return area;
      })
      .filter((a) => a.plates.length || a.devices.length);
    // Keep pins across an editor round-trip.
    this._pins = new Map();
    for (const [k, v] of prevPins) if (k < this._areas.length) this._pins.set(k, v);
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }
  get hass() {
    return this._hass;
  }

  getCardSize() {
    return Math.max(1, this._areas.length * 2 + 1);
  }

  // ---- model --------------------------------------------------------------

  _entsOf(area) {
    if (!area._ents) {
      const ids = [];
      for (const p of area.plates) {
        for (const r of p.rockers) {
          ids.push(r.entity);
          for (const d of r.downstream) ids.push(d.entity);
        }
      }
      for (const d of area.devices) ids.push(d.entity);
      area._ents = [...new Set(ids)];
    }
    return area._ents;
  }

  _st(entity) {
    return this._hass && this._hass.states[entity];
  }

  _isOn(entity) {
    const st = this._st(entity);
    return !!st && st.state === "on";
  }

  _dead(st) {
    return !st || st.state === "unavailable" || st.state === "unknown";
  }

  _onCount(area) {
    return this._entsOf(area).filter((e) => this._isOn(e)).length;
  }

  _info(entry) {
    const st = this._st(entry.entity);
    const dom = entry.entity.split(".")[0];
    const attrs = (st && st.attributes) || {};
    return {
      st,
      dead: this._dead(st),
      on: !!st && st.state === "on",
      name: entry.name || attrs.friendly_name || entry.entity.split(".")[1],
      icon: entry.icon || attrs.icon || HA_ICON[dom] || "mdi:circle-small",
      color:
        !st || st.state !== "on"
          ? "var(--secondary-text-color)"
          : HA_ON_COLOR[dom] || "#34d399",
      dom,
    };
  }

  _isOpen(area, n) {
    const pin = this._pins.get(area.idx);
    if (pin !== undefined) return pin;
    return this._expandAll || n > 0;
  }

  // ---- render -------------------------------------------------------------

  _render() {
    if (!this._hass || !this._areas.length) return;
    const sig = this._signature();
    if (sig === this._sig) return;
    this._sig = sig;

    const rows = this._areas.map((a) => ({ a, n: this._onCount(a) }));
    const off = rows.filter((r) => !r.n);
    const on = rows.filter((r) => r.n);
    const openCount = rows.filter((r) => this._isOpen(r.a, r.n)).length;
    const totalOn = rows.reduce((n, r) => n + r.n, 0);

    let body = "";
    if (off.length) {
      const closed = off.filter((r) => !this._isOpen(r.a, r.n));
      const opened = off.filter((r) => this._isOpen(r.a, r.n));
      if (closed.length) {
        body += '<div class="pills">' + closed.map((r) => this._pill(r.a)).join("") + "</div>";
      }
      body += opened.map((r) => this._row(r.a, 0, true)).join("");
    }
    body += on.map((r) => this._row(r.a, r.n, this._isOpen(r.a, r.n))).join("");

    const title = this._config.title;
    const head =
      '<div class="hdr" data-head role="button" tabindex="0" aria-expanded="' +
      (this._expandAll ? "true" : "false") +
      '" title="' + (this._expandAll ? "Show less" : "Show all") + '">' +
      (this._config.icon ? '<ha-icon class="hicon" icon="' + this._esc(this._config.icon) + '"></ha-icon>' : "") +
      '<span class="htitle">' + this._esc(title || "Areas") + "</span>" +
      '<span class="hsum">' + (totalOn ? totalOn + " on" : "all off") + "</span>" +
      '<ha-icon class="chev" icon="' + (this._expandAll ? "mdi:chevron-up" : "mdi:chevron-down") + '"></ha-icon>' +
      "</div>";

    this.shadowRoot.innerHTML =
      "<style>" + this._css() + "</style><ha-card>" + head +
      (body || '<div class="empty">No areas configured yet.</div>') +
      "</ha-card>";
  }

  _signature() {
    if (!this._areas.length) return "";
    const parts = [this._expandAll ? "1" : "0", String(this._openKey())];
    for (const a of this._areas) {
      for (const e of this._entsOf(a)) {
        const st = this._st(e);
        parts.push(e + "=" + (st ? st.state : "-"));
      }
    }
    return parts.join("|");
  }

  _openKey() {
    return [...this._pins.entries()].sort((x, y) => x[0] - y[0]).join(",");
  }

  _pill(area) {
    return (
      '<div class="pill" data-open="' + area.idx + '" tabindex="0" role="button" ' +
      'aria-label="Expand ' + this._esc(area.name) + '" style="--ac:' + this._esc(area.accent) + '">' +
      '<span class="trace"></span>' +
      '<ha-icon icon="' + this._esc(area.icon) + '"></ha-icon>' +
      '<span class="pname">' + this._esc(area.name) + "</span>" +
      "</div>"
    );
  }

  _row(area, n, open) {
    const body = open
      ? '<div class="abody">' + this._body(area) + "</div>"
      : '<div class="compact">' + (n ? n + " on" : "off") + "</div>";
    const chev = open ? "mdi:chevron-up" : "mdi:chevron-down";
    return (
      '<div class="arow' + (open ? " open" : "") + '" style="--ac:' +
        this._esc(area.accent) + ";--glow:" + (n ? "1" : "0") + '">' +
      '<div class="aside" data-open="' + area.idx + '" tabindex="0" role="button" ' +
        'aria-label="' + (open ? "Collapse " : "Expand ") + this._esc(area.name) + '">' +
        '<ha-icon class="aicon" icon="' + this._esc(area.icon) + '"></ha-icon>' +
        '<span class="aname">' + this._esc(area.name) + "</span>" +
        '<ha-icon class="achev" icon="' + chev + '"></ha-icon>' +
      "</div>" +
      body +
      (area.master
        ? '<button class="amaster' + (n ? " on" : "") + '" data-master="' + area.idx + '" ' +
          'aria-label="All off / all on for ' + this._esc(area.name) + '">' +
          '<ha-icon icon="mdi:power"></ha-icon></button>'
        : "") +
      "</div>"
    );
  }

  _body(area) {
    let out = "";
    for (const plate of area.plates) {
      if (plate.name) out += '<div class="plabel">' + this._esc(plate.name) + "</div>";
      let run = [];
      const flush = () => {
        if (!run.length) return;
        out += '<div class="rrow">' + run.map((r) => this._rocker(r)).join("") + "</div>";
        run = [];
      };
      for (const r of plate.rockers) {
        if (!r.downstream.length) {
          run.push(r);
          continue;
        }
        flush();
        out +=
          '<div class="gang">' +
          '<div class="rrow">' + this._rocker(r) + "</div>" +
          '<div class="dsc">' + r.downstream.map((d) => this._chip(d)).join("") + "</div>" +
          "</div>";
      }
      flush();
    }
    if (area.devices.length) {
      out += '<div class="dsc devs">' + area.devices.map((d) => this._chip(d)).join("") + "</div>";
    }
    return out;
  }

  _rocker(r) {
    const i = this._info(r);
    return (
      '<button class="rk' + (i.on ? " on" : "") + (i.dead ? " dead" : "") + '" ' +
      'data-e="' + this._esc(r.entity) + '" style="--c:' + i.color + '">' +
      '<ha-icon icon="' + this._esc(i.icon) + '"></ha-icon>' +
      "<span>" + this._esc(i.name) + "</span>" +
      "</button>"
    );
  }

  _chip(d) {
    const i = this._info(d);
    return (
      '<button class="chip' + (i.on ? " on" : "") + (i.dead ? " dead" : "") + '" ' +
      'data-e="' + this._esc(d.entity) + '" style="--c:' + i.color + '">' +
      '<ha-icon icon="' + this._esc(i.icon) + '"></ha-icon>' +
      "<span>" + this._esc(i.name) + "</span>" +
      '<span class="dot" aria-hidden="true"><ha-icon icon="mdi:power"></ha-icon></span>' +
      "</button>"
    );
  }

  // ---- interaction --------------------------------------------------------

  _down(ev) {
    const t = ev.target.closest("[data-e]");
    if (!t) return;
    clearTimeout(this._holdT);
    this._holdT = setTimeout(() => {
      this._held = true;
      this._more(t.dataset.e);
    }, 550);
  }

  _up() {
    clearTimeout(this._holdT);
    this._holdT = null;
  }

  _click(ev) {
    if (this._held) {
      this._held = false;
      return;
    }
    const master = ev.target.closest("[data-master]");
    if (master) return this._master(Number(master.dataset.master));
    const ent = ev.target.closest("[data-e]");
    if (ent) return this._toggle(ent.dataset.e);
    const open = ev.target.closest("[data-open]");
    if (open) return this._toggleOpen(Number(open.dataset.open));
    if (ev.target.closest("[data-head]")) {
      this._expandAll = !this._expandAll;
      this._pins.clear();
      this._sig = "";
      this._render();
    }
  }

  _toggleOpen(idx) {
    const area = this._areas[idx];
    if (!area) return;
    const open = this._isOpen(area, this._onCount(area));
    this._pins.set(idx, !open);
    this._sig = "";
    this._render();
  }

  // Upstream rockers drive the downstream devices declared on them unless the
  // downstream entry opts out with follow: false.
  _toggle(entity) {
    const ids = [entity];
    const rocker = this._map.get(entity);
    if (rocker) for (const d of rocker.downstream) if (d.follow !== false) ids.push(d.entity);
    this._set(ids, !this._isOn(entity));
  }

  _master(idx) {
    const area = this._areas[idx];
    if (!area) return;
    if (area.toggle_entity) {
      this._hass.callService("homeassistant", "toggle", { entity_id: area.toggle_entity });
      return;
    }
    const ids = this._entsOf(area);
    this._set(ids, !ids.some((e) => this._isOn(e)));
    this._pins.set(idx, true);
  }

  _set(ids, on) {
    if (!ids.length) return;
    const svc = on ? "turn_on" : "turn_off";
    this._hass.callService("homeassistant", svc, { entity_id: ids });
  }

  _more(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  // ---- style --------------------------------------------------------------

  _css() {
    return `
      :host { display: block; }
      ha-card {
        padding: 12px 12px 14px;
        border-radius: 20px;
        overflow: hidden;
      }
      * { box-sizing: border-box; }
      .hdr {
        display: flex; align-items: center; gap: 8px;
        padding: 2px 2px 12px;
        cursor: pointer; user-select: none;
      }
      .hdr:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 3px; }
      .hicon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
      .htitle {
        font-size: 15px; font-weight: 650; letter-spacing: .2px;
        color: var(--primary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hsum {
        margin-left: auto; font-size: 11px; font-weight: 500;
        color: var(--secondary-text-color);
        padding: 3px 8px; border-radius: 999px;
        background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
      }
      .chev { --mdc-icon-size: 18px; color: var(--secondary-text-color); }

      /* idle areas: pills on top */
      .pills { display: flex; flex-wrap: wrap; gap: 6px; }
      .pill {
        position: relative;
        display: flex; align-items: center; gap: 7px;
        padding: 9px 14px 9px 12px;
        border-radius: 13px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent);
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--ac) 10%, transparent), transparent 70%),
          color-mix(in srgb, var(--primary-text-color) 4%, transparent);
        color: var(--secondary-text-color);
        font: inherit; font-size: 12px; font-weight: 500;
        cursor: pointer;
        transition: border-color .15s ease, background .15s ease;
      }
      .pill:hover { border-color: color-mix(in srgb, var(--ac) 50%, transparent); }
      .pill:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .pill ha-icon { --mdc-icon-size: 17px; color: var(--ac); opacity: .75; }
      .pill .pname { color: var(--primary-text-color); opacity: .82; }
      .trace {
        position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, var(--ac), color-mix(in srgb, var(--ac) 25%, transparent));
        opacity: .75;
      }

      /* active / opened areas */
      .arow {
        position: relative;
        display: grid;
        grid-template-columns: 84px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        margin-top: 6px;
        padding: 8px 9px 8px 12px;
        border-radius: 15px;
        border: 1px solid color-mix(in srgb, var(--ac) 18%, transparent);
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--ac) calc(6% + var(--glow) * 6%), transparent), transparent 100%),
          color-mix(in srgb, var(--primary-text-color) 3.5%, transparent);
        transition: background .2s ease, border-color .2s ease;
      }
      .arow::before {
        content: "";
        position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, var(--ac), color-mix(in srgb, var(--ac) 20%, transparent));
        opacity: calc(.28 + var(--glow) * .72);
      }
      .arow.open { border-color: color-mix(in srgb, var(--ac) 26%, transparent); }
      .aside {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        cursor: pointer; user-select: none; min-width: 0;
        padding: 2px 0;
      }
      .aside:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 8px; }
      .aicon {
        --mdc-icon-size: 20px;
        color: var(--ac);
        opacity: calc(.45 + var(--glow) * .55);
      }
      .aname {
        font-size: 10.5px; font-weight: 550; letter-spacing: .1px;
        color: var(--primary-text-color); opacity: calc(.6 + var(--glow) * .4);
        max-width: 84px; text-align: center; line-height: 1.2;
        overflow: hidden; overflow-wrap: anywhere;
      }
      .achev { --mdc-icon-size: 14px; color: var(--secondary-text-color); opacity: .6; }
      .compact {
        font-size: 11px; color: var(--secondary-text-color);
        padding-left: 2px;
      }

      .abody { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .plabel {
        font-size: 9.5px; font-weight: 600; letter-spacing: .6px; text-transform: uppercase;
        color: var(--secondary-text-color); opacity: .75;
        margin: 1px 0 0 2px;
      }
      .rrow { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
      .rrow > .rk { flex: 1 1 140px; max-width: 340px; justify-content: center; }

      .rk, .chip {
        display: flex; align-items: center; gap: 6px;
        font: inherit; font-size: 12px; font-weight: 500;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
        border-radius: 11px;
        padding: 8px 13px;
        min-height: 34px;
        cursor: pointer;
        min-width: 0;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      .rk span, .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rk ha-icon { --mdc-icon-size: 16px; color: var(--c); flex: none; }
      .rk.on, .chip.on {
        color: var(--primary-text-color);
        background: color-mix(in srgb, var(--c) 20%, transparent);
        border-color: color-mix(in srgb, var(--c) 45%, transparent);
        box-shadow: inset 0 0 16px color-mix(in srgb, var(--c) 12%, transparent);
      }
      .rk.dead, .chip.dead { opacity: .45; }
      .rk:focus-visible, .chip:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

      .gang {
        display: flex; flex-direction: column; gap: 5px;
        align-self: flex-start; max-width: 100%;
        padding: 5px;
        border-radius: 13px;
        background: color-mix(in srgb, var(--primary-text-color) 3%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 7%, transparent);
      }
      .gang .rk { background: transparent; border-color: transparent; min-height: 30px; flex: 0 0 auto; max-width: none; justify-content: flex-start; }
      .gang .rk.on { background: color-mix(in srgb, var(--c) 16%, transparent); border-color: color-mix(in srgb, var(--c) 35%, transparent); }
      .dsc { display: flex; flex-wrap: wrap; gap: 5px; }
      .dsc .chip { padding: 6px 8px 6px 11px; min-height: 30px; font-size: 11.5px; }
      .chip ha-icon { --mdc-icon-size: 15px; color: var(--c); flex: none; }
      .chip .dot {
        display: grid; place-items: center;
        width: 18px; height: 18px; border-radius: 50%;
        margin-left: 2px; flex: none;
        border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
        color: var(--c); opacity: .55;
      }
      .chip .dot ha-icon { --mdc-icon-size: 11px; }
      .chip.on .dot { opacity: 1; background: color-mix(in srgb, var(--c) 22%, transparent); }
      .devs { margin-top: 1px; }

      .amaster {
        width: 32px; height: 32px; flex: none;
        display: grid; place-items: center;
        border-radius: 50%;
        cursor: pointer;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent);
        transition: background .15s ease, color .15s ease, box-shadow .15s ease;
      }
      .amaster ha-icon { --mdc-icon-size: 17px; }
      .amaster.on {
        color: #0b1f17;
        background: #34d399;
        border-color: #6ee7b7;
        box-shadow: 0 0 14px rgba(52, 211, 153, .35);
      }
      .amaster:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .empty { font-size: 12px; color: var(--secondary-text-color); padding: 4px 2px 2px; }

      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; }
      }
      @media (max-width: 420px) {
        .arow { grid-template-columns: 70px minmax(0, 1fr) auto; padding-left: 10px; gap: 6px; }
        .aname { max-width: 70px; }
        .rk { padding: 8px 10px; }
      }
    `;
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

if (!customElements.get("hierarchy-areas")) {
  customElements.define("hierarchy-areas", HierarchyAreasCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hierarchy-areas",
  name: "Hierarchy Areas",
  description: "Area switch board: idle areas as pills, active areas expand, wall plates and downstream devices.",
  preview: false,
  documentationURL: "https://github.com/RenanzAz/hierarchy-cards",
});

console.info("%c HIERARCHY-AREAS %c 1.0.0 ", "background:#0f766e;color:#fff", "");

/* ------------------------------------------------------------------ *
 * Minimal editor: the card is config-heavy, so this only covers the
 * top-level fields and points at the YAML editor for areas/plates.
 * ------------------------------------------------------------------ */
const HAE_CSS = `
  .ed { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
  .row { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; }
  label { font-size: 12px; color: var(--secondary-text-color); }
  input {
    font: inherit; font-size: 13px; width: 100%; box-sizing: border-box;
    padding: 5px 7px; border-radius: 6px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
  }
  .hint { font-size: 11px; color: var(--secondary-text-color); }
`;

class HierarchyAreasEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = config || {};
    this._build();
  }

  set hass(h) {
    this._hass = h;
    for (const p of this.shadowRoot.querySelectorAll("ha-icon-picker")) p.hass = h;
  }

  _change(key, value) {
    this._config = { ...this._config };
    if (value === "" || value == null) delete this._config[key];
    else this._config[key] = value;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })
    );
  }

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = "<style>" + HAE_CSS + "</style>";
    const wrap = document.createElement("div");
    wrap.className = "ed";

    for (const [key, label] of [["title", "Title"], ["icon", "Icon"]]) {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("label");
      lab.textContent = label;
      const input = document.createElement("input");
      input.value = this._config[key] ?? "";
      input.addEventListener("change", () => this._change(key, input.value.trim()));
      row.append(lab, input);
      wrap.append(row);
    }

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Areas, wall plates and downstream devices are edited in the YAML editor (areas: → plates: → rockers:).";
    wrap.append(hint);
    root.append(wrap);
  }
}

if (!customElements.get("hierarchy-areas-editor")) {
  customElements.define("hierarchy-areas-editor", HierarchyAreasEditor);
}
