/*
 * Hierarchy Area — one area per card, stacked like cards.
 *
 * Compact by default: the card is a single header row until something is on.
 * Only entities that are ON are listed; tapping the area block (left) or the
 * chevron expands the card to every declared entity, on or off.
 *
 * Controls are a flat list. `group` buckets consecutive controls into a wall
 * plate ("Triplo · Janela"). A control with `downstream` renders as a bundle:
 * the rocker on top, its devices underneath, encapsulated.
 *
 * The area header (icon + name + power) is a title above the card by default;
 * `header_style: inside` puts it inside the card instead.
 *
 * https://github.com/RenanzAz/glance-plus
 */

const HA_ON_COLOR = {
  light: "#fbbf24",
  switch: "#60a5fa",
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

// Native card visibility, derived from the controls that exist right now.
// A switch holds by default; a control can opt out with hold: false.
const HA_VIS = (cfg) => {
  if (!cfg) return undefined;
  const list = HA_NORM(cfg.controls);
  const hasSwitch = list.some((c) => c.entity.startsWith("switch."));
  const conds = [];
  if (cfg.show_helper) conds.push({ condition: "state", entity: cfg.show_helper, state: "on" });
  for (const c of list) {
    const hold = c.hold !== undefined ? c.hold !== false : c.entity.startsWith("switch.") || !hasSwitch;
    if (hold) conds.push({ condition: "state", entity: c.entity, state: "on" });
  }
  return conds.length ? [{ condition: "or", conditions: conds }] : undefined;
};

const HA_NORM = (list) =>
  (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? { entity: x } : x || {}))
    .filter((x) => x.entity);

class HierarchyAreaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._controls = [];
    this._sig = "";
    this._open = false;
    this._held = false;
    this._holdT = null;
    this.shadowRoot.addEventListener("click", (ev) => this._click(ev));
    this.shadowRoot.addEventListener("input", (ev) => {
      if (ev.target.classList && ev.target.classList.contains("slide")) this._brightness(ev.target);
    });
    this.shadowRoot.addEventListener("change", (ev) => {
      if (!ev.target.classList || !ev.target.classList.contains("slide")) return;
      const pct = Math.round(Number(ev.target.value));
      if (!Number.isFinite(pct)) return;
      ev.target._pct = Math.max(1, Math.min(100, pct));
      this._sendBrightness(ev.target);
      const box = ev.target.closest && ev.target.closest(".kidbox");
      if (box && box.classList) {
        clearTimeout(box._busyT);
        box._busyT = setTimeout(() => box.classList.remove("busy"), 1800);
      }
    });
    this.shadowRoot.addEventListener("pointerdown", (ev) => this._down(ev));
    this.shadowRoot.addEventListener("pointermove", () => clearTimeout(this._holdT), true);
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) {
      this.shadowRoot.addEventListener(t, () => this._up());
    }
  }

  static getConfigElement() {
    return document.createElement("hierarchy-area-editor");
  }

  static getStubConfig() {
    return {
      name: "Sala",
      icon: "mdi:sofa-outline",
      accent: "#fb7185",
      columns: 4,
      controls: [
        { entity: "switch.example_left", name: "Esq", group: "Triplo" },
      ],
    };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("hierarchy-area: invalid config");
    const prevOpen = this._open;
    this._config = config;
    this._showHelper = config.show_helper || null;
    this._headerStyle = config.header_style === "title" ? "title" : "inside";
    this._hideNameOn = config.hide_name_on !== false;
    this._size = ["small", "medium", "large"].includes(config.size) ? config.size : "medium";
    this._secondaryInfo = ["none", "last-changed", "last-updated"].includes(config.secondary_info)
      ? config.secondary_info
      : "last-changed";
    // A helper shared by many cards (e.g. one per floor) must not be turned
    // off by tapping one card, and must not scroll every card into view.
    this._releaseHelper = config.release_helper !== false;
    this._override = false;
    const list = HA_NORM(config.controls);
    const hasSwitch = list.some((c) => c.entity.startsWith("switch."));
    this._controls = list.map((c) => ({
      entity: c.entity,
      name: c.name || null,
      icon: c.icon || null,
      group: c.group || null,
      downstream: HA_NORM(c.downstream),
      follow: c.follow === true,
      hold: c.hold !== undefined ? c.hold !== false : c.entity.startsWith("switch.") || !hasSwitch,
    }));
    this._open = prevOpen;
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._helperOn()) this._override = false;
    this._render();
  }

  connectedCallback() {
    // Relative last-changed labels ("1 min") need a re-render even when no
    // state changes.
    clearInterval(this._tick);
    this._tick = setInterval(() => {
      if (!this._config) return;
      this._sig = "";
      this._render();
    }, 60000);
    // Summoned from a chip: the element is re-created, bring it into view.
    if (this._helperOn() && this._releaseHelper && !this._active()) {
      setTimeout(() => {
        try {
          this.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (e) {
          /* older webview */
        }
      }, 80);
    }
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }
  get hass() {
    return this._hass;
  }

  getCardSize() {
    return this._visible().length ? 2 : 1;
  }

  // ---- model --------------------------------------------------------------

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
      color: !st || st.state !== "on" ? "var(--secondary-text-color)" : HA_ON_COLOR[dom] || "#34d399",
      dom,
    };
  }

  // A bundle counts as on when its rocker or any downstream device is on.
  _ctrlOn(c) {
    return this._isOn(c.entity) || c.downstream.some((d) => this._isOn(d.entity));
  }

  // An area is "active" while a control marked as holding it is on. Switches
  // hold by default; lamps/LEDs only in an area with no switch at all. Mark a
  // control hold: false in the editor to stop it keeping the card visible.
  _active() {
    return this._controls.some((c) => c.hold && this._isOn(c.entity));
  }

  _helperOn() {
    return !!this._showHelper && this._isOn(this._showHelper);
  }

  // Shared floor helper: every card opens. A tap collapses this card only.
  _isOpen() {
    return this._override ? this._open : this._open || this._helperOn();
  }

  // Collapsed: only controls whose own switch is on. Expanded: everything.
  // A downstream never pulls its bundle into the collapsed view.
  _visible() {
    const open = this._isOpen();
    return this._controls.filter((c) => open || this._isOn(c.entity));
  }

  _groups(list) {
    const out = [];
    let cur = null;
    for (const c of list) {
      const g = c.group || "";
      if (!cur || cur.name !== g) {
        cur = { name: g, items: [] };
        out.push(cur);
      }
      cur.items.push(c);
    }
    return out;
  }

  // ---- render -------------------------------------------------------------

  _render() {
    if (!this._hass || !this._config) return;
    const sig = this._signature();
    if (sig === this._sig) return;
    this._sig = sig;

    const vis = this._visible();
    const open = this._isOpen();
    const active = this._active();
    const accent = this._accent(this._config.accent || "var(--accent-color, #818cf8)");
    const name = this._config.name || "Area";
    const icon = this._config.icon || "mdi:home-outline";
    const cols = Math.max(1, Math.min(Number(this._config.columns) || 4, 99));
    const inside = this._headerStyle === "inside";

    let body = '<div class="body">';
    if (vis.length) {
      const groups = open ? this._groups(vis) : [{ name: "", items: vis }];
      for (const g of groups) {
        if (open && g.name) body += '<div class="glabel">' + this._esc(g.name) + "</div>";
        body +=
          '<div class="grid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' +
          g.items.map((c) => this._tile(c, cols)).join("") +
          "</div>";
      }
    }
    body += "</div>";

    const head =
      '<div class="head' + (inside ? " in" : "") + '">' +
        '<button class="aopen" data-open aria-expanded="' + (open ? "true" : "false") +
          '" aria-label="' + (open ? "Collapse " : "Expand ") + this._esc(name) + '">' +
          '<ha-icon class="aicon" icon="' + this._esc(icon) + '"></ha-icon>' +
          '<span class="aname">' + this._esc(name) + "</span>" +
          '<ha-icon class="chev" icon="' + (open ? "mdi:chevron-up" : "mdi:chevron-down") + '"></ha-icon>' +
        "</button>" +
        (active
          ? '<button class="master on" data-master aria-label="All off for ' + this._esc(name) + '">' +
            '<ha-icon icon="mdi:power"></ha-icon></button>'
          : "") +
      "</div>";

    this.shadowRoot.innerHTML =
      "<style>" + this._css() + "</style>" +
      '<div class="area ' + this._size + (inside ? " inside" : " title") +
        '" style="--ac:' + this._esc(accent) + ";--glow:" + (active ? "1" : "0") + ";--k:" +
        ({ small: 0.86, medium: 1, large: 1.16 })[this._size] + '">' +
      (inside ? "<ha-card>" + head + body + "</ha-card>"
        : head + (vis.length ? "<ha-card>" + body + "</ha-card>" : "")) +
      "</div>";
  }

  _signature() {
    const parts = [
      this._open ? "1" : "0",
      this._headerStyle,
      this._size,
      this._secondaryInfo,
      this._showHelper ? (this._st(this._showHelper)?.state ?? "-") : "-",
    ];
    for (const c of this._controls) {
      parts.push(c.entity + "=" + (this._st(c.entity)?.state ?? "-"));
      for (const d of c.downstream) parts.push(d.entity + "=" + (this._st(d.entity)?.state ?? "-"));
    }
    return parts.join("|");
  }

  _tile(c, cols) {
    if (c.downstream.length) return this._bundle(c, cols);
    const i = this._info(c);
    if (this._dimmable(c.entity)) return this._emb(c.entity, i, true);
    const sec = this._secondary(c.entity);
    return (
      '<button class="tile' + (i.on ? " on" : "") + (i.dead ? " dead" : "") + '" data-e="' +
        this._esc(c.entity) + '" style="--c:' + i.color + '">' +
      '<ha-icon icon="' + this._esc(i.icon) + '"></ha-icon>' +
      '<span class="tname">' + this._esc(i.name) + "</span>" +
      (sec ? '<span class="tsub">' + this._esc(sec) + "</span>" : "") +
      "</button>"
    );
  }

  // Embedded tile: the whole box is the brightness slider. A standalone light
  // shows its timestamp next to the name; a downstream leaves secondary info
  // to the parent switch rail.
  _emb(entity, i, withTime) {
    const pct = Math.round(((this._st(entity)?.attributes?.brightness) || 0) / 2.55);
    const time = withTime ? this._secondary(entity) : "";
    return (
      '<div class="kidbox emb' + (time ? " has-time" : "") +
        '" style="--c:' + i.color + ";--pct:" + pct + '%">' +
      '<button class="kicon" data-e="' + this._esc(entity) + '" aria-label="Toggle ' +
        this._esc(i.name) + '"><ha-icon icon="' + this._esc(i.icon) + '"></ha-icon></button>' +
      '<span class="kname">' + this._esc(i.name) + "</span>" +
      (time ? '<span class="ktime">' + this._esc(time) + "</span>" : "") +
      '<span class="kpct">' + pct + "%</span>" +
      '<input class="slide cover" type="range" min="0" max="100" value="' + pct +
        '" data-b="' + this._esc(entity) + '" data-more="' + this._esc(entity) +
        '" aria-label="Brightness ' + this._esc(i.name) + '">' +
      "</div>"
    );
  }

  // One bundle per switch with downstream: the switch (green) caps the box and
  // encapsulates its devices. Its icon, name and relative last change sit on
  // the left rail, outside the devices. One kid -> half width; two -> full.
  _bundle(c, cols) {
    const i = this._info(c);
    const kids = c.downstream;
    const wide = kids.length > 1;
    return (
      '<div class="bundle' + (i.on ? " on" : "") + (wide ? " wide" : "") +
        '" style="--c:' + i.color + ';--kw:' + Math.min(kids.length, 2) +
        ";--bw:" + Math.min(2, cols) + '">' +
      '<button class="brail' + (i.on ? " on" : "") + (i.dead ? " dead" : "") + '" data-e="' +
        this._esc(c.entity) + '" style="--c:' + i.color + '">' +
        '<ha-icon icon="' + this._esc(i.icon) + '"></ha-icon>' +
        (this._hideNameOn && i.on ? "" : '<span class="bname">' + this._esc(i.name) + "</span>") +
        this._timeSpan(this._secondary(c.entity), "btime") + "</button>" +
      '<div class="kids">' + kids.map((d) => this._kid(d)).join("") + "</div>" +
      "</div>"
    );
  }

  _kid(d) {
    const i = this._info(d);
    if (i.on && this._dimmable(d.entity)) return this._emb(d.entity, i, false);
    return (
      '<button class="tile kid' + (i.on ? " on" : "") + (i.dead ? " dead" : "") + '" data-e="' +
        this._esc(d.entity) + '" style="--c:' + i.color + '">' +
      "<span>" + this._esc(i.name) + "</span></button>"
    );
  }

  _relTime(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return "";
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return "now";
    if (m < 60) return m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h";
    return Math.round(h / 24) + " d";
  }

  // Editor "Secondary info": pick which HA timestamp rides with the name.
  _secondary(entity) {
    if (this._secondaryInfo === "none") return "";
    const st = this._st(entity);
    if (!st) return "";
    return this._relTime(this._secondaryInfo === "last-updated" ? st.last_updated : st.last_changed);
  }

  _timeSpan(text, cls) {
    if (!text) return "";
    return '<span class="' + cls + '">' + this._esc(text) + "</span>";
  }

  // Brightness-capable light: colour modes beyond plain on/off.
  _dimmable(entity) {
    const st = this._st(entity);
    if (!st || st.state !== "on") return false;
    const modes = st.attributes && st.attributes.supported_color_modes;
    if (Array.isArray(modes) && modes.length) return modes.some((m) => m !== "onoff");
    return st.attributes && st.attributes.brightness != null;
  }

  _brightness(el) {
    const pct = Math.round(Number(el.value));
    if (!Number.isFinite(pct)) return;
    el._pct = Math.max(1, Math.min(100, pct));
    const box = el.closest && el.closest(".kidbox");
    if (box && box.style) {
      box.style.setProperty("--pct", el._pct + "%");
      if (box.classList) box.classList.add("busy");
      const lab = box.querySelector && box.querySelector(".kpct");
      if (lab) lab.textContent = el._pct + "%";
    }
    const since = Date.now() - (el._last || 0);
    if (since >= 120) {
      this._sendBrightness(el);
      return;
    }
    // Trailing send: the final value always lands, even if the drag ends
    // (or is pushed past 100%) inside the throttle window.
    clearTimeout(el._timer);
    el._timer = setTimeout(() => this._sendBrightness(el), 120 - since);
  }

  _sendBrightness(el) {
    if (el._timer) {
      clearTimeout(el._timer);
      el._timer = null;
    }
    if (!Number.isFinite(el._pct)) return;
    el._last = Date.now();
    this._hass.callService("light", "turn_on", {
      entity_id: el.dataset.b,
      brightness_pct: el._pct,
    });
  }

  // ---- interaction --------------------------------------------------------

  _down(ev) {
    const t = ev.target.closest("[data-e],[data-more]");
    if (!t) return;
    clearTimeout(this._holdT);
    this._holdT = setTimeout(() => {
      this._held = true;
      this._more(t.dataset.e || t.dataset.more);
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
    if (master) return this._master();
    const ent = ev.target.closest("[data-e]");
    if (ent) return this._toggle(ent.dataset.e);
    if (ev.target.closest("[data-open]")) {
      const open = this._isOpen();
      // A per-card helper is released on tap (chip row flow). A shared floor
      // helper stays on; the tap only collapses/expands this card.
      if (this._helperOn() && this._releaseHelper) {
        this._hass.callService("input_boolean", "turn_off", { entity_id: this._showHelper });
      }
      this._open = !open;
      this._override = open && this._helperOn();
      this._sig = "";
      this._render();
    }
  }

  _toggle(entity) {
    const c = this._controls.find((x) => x.entity === entity);
    if (c && c.downstream.length) {
      const ids = [c.entity];
      if (c.follow) for (const d of c.downstream) ids.push(d.entity);
      this._set(ids, !this._isOn(c.entity));
      return;
    }
    this._set([entity], !this._isOn(entity));
  }

  _master() {
    // Only wall switches (or the plain controls when the area has none).
    // Downstream devices are never touched by the master.
    const sw = this._controls.filter((c) => c.entity.startsWith("switch."));
    const pool = sw.length ? sw : this._controls;
    this._set([...new Set(pool.map((c) => c.entity))], !pool.some((c) => this._isOn(c.entity)));
    this._open = true;
    this._override = false;
    this._sig = "";
    this._render();
  }

  _set(ids, on) {
    if (!ids.length) return;
    this._hass.callService("homeassistant", on ? "turn_on" : "turn_off", { entity_id: ids });
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
        display: block;
        padding: 6px 8px;
        border-radius: 14px;
        overflow: hidden;
      }
      * { box-sizing: border-box; }
      .area {
        position: relative;
        display: flex; flex-direction: column; gap: calc(4px * var(--k, 1));
        --k: 1;
      }
      .area::before {
        content: "";
        position: absolute; left: -8px; top: 3px; bottom: 3px; width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, var(--ac), color-mix(in srgb, var(--ac) 15%, transparent));
        opacity: calc(.3 + var(--glow) * .7);
      }
      .head { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .head.in { padding: calc(1px * var(--k, 1)) calc(2px * var(--k, 1)) calc(5px * var(--k, 1)); }
      .head:not(.in) {
        padding: 0 calc(2px * var(--k, 1)) calc(1px * var(--k, 1)) calc(5px * var(--k, 1));
      }
      .aopen {
        display: flex; align-items: center; gap: calc(6px * var(--k, 1)); flex: 1;
        min-width: 0; padding: 0;
        font: inherit; color: inherit; text-align: left;
        background: none; border: 0; cursor: pointer;
      }
      .aopen:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 7px; }
      .aicon {
        --mdc-icon-size: calc(17px * var(--k, 1));
        flex: none; color: var(--ac); opacity: calc(.5 + var(--glow) * .5);
      }
      .aname {
        font-size: calc(13px * var(--k, 1)); font-weight: 650; letter-spacing: .1px; line-height: 1.15;
        color: var(--primary-text-color); opacity: calc(.62 + var(--glow) * .38);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .head.in .aname { font-size: calc(11.5px * var(--k, 1)); }
      .chev { --mdc-icon-size: calc(13px * var(--k, 1)); opacity: .55; flex: none; }

      .body { display: flex; flex-direction: column; gap: calc(4px * var(--k, 1)); min-width: 0; }
      .glabel {
        grid-column: 1 / -1;
        font-size: 8.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
        color: var(--secondary-text-color); opacity: .65; margin: 0 0 -1px 2px;
      }
      .grid { display: grid; gap: calc(5px * var(--k, 1)); min-width: 0; }

      .tile {
        display: flex; align-items: center; gap: 4px;
        min-width: 0; min-height: calc(26px * var(--k, 1));
        padding: calc(2px * var(--k, 1)) calc(6px * var(--k, 1));
        font: inherit; font-size: calc(11.5px * var(--k, 1)); font-weight: 500;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        border-radius: 8px;
        cursor: pointer;
        transition: background .12s ease, border-color .12s ease, color .12s ease;
      }
      .tile span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tile .tname { flex: 1; min-width: 0; text-align: center; }
      .tile .tsub {
        flex: none; margin-left: 2px;
        font-size: calc(10px * var(--k, 1)); font-weight: 500;
        color: var(--secondary-text-color); opacity: .8;
      }
      .tile ha-icon { --mdc-icon-size: calc(14px * var(--k, 1)); color: var(--c); flex: none; }
      .tile.on {
        color: var(--primary-text-color);
        background: color-mix(in srgb, var(--c) 20%, transparent);
        border-color: color-mix(in srgb, var(--c) 42%, transparent);
      }
      .tile.dead { opacity: .4; }
      .tile:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }

      .bundle {
        grid-column: span var(--bw, 2);
        display: grid;
        grid-template-columns: calc(46px * var(--k, 1)) minmax(0, 1fr);
        gap: calc(4px * var(--k, 1));
        align-items: center;
        padding: calc(3px * var(--k, 1));
        border-radius: 11px;
        background: color-mix(in srgb, var(--c) 8%, transparent);
        border: 1.5px solid color-mix(in srgb, var(--c) 45%, transparent);
        min-width: 0;
      }
      .bundle.wide { grid-column: 1 / -1; }
      .bundle.on {
        background: color-mix(in srgb, var(--c) 18%, transparent);
        border-color: var(--c);
      }
      .brail {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: calc(1px * var(--k, 1));
        min-width: 0; padding: 0;
        font: inherit; line-height: 1.1; color: var(--secondary-text-color);
        background: none; border: 0; cursor: pointer;
      }
      .brail ha-icon { --mdc-icon-size: calc(14px * var(--k, 1)); color: var(--c); flex: none; }
      .brail.on { color: var(--primary-text-color); }
      .brail.dead { opacity: .45; }
      .brail:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; border-radius: 6px; }
      .bname {
        font-size: calc(10px * var(--k, 1)); font-weight: 600; line-height: 1.05; text-align: center;
        overflow: hidden; overflow-wrap: anywhere;
      }
      .btime { font-size: calc(10px * var(--k, 1)); line-height: 1.1; opacity: .8; white-space: nowrap; text-align: center; }
      .kids {
        display: grid; grid-template-columns: repeat(var(--kw, 1), minmax(0, 1fr));
        gap: calc(4px * var(--k, 1));
      }
      .kidbox {
        display: flex; align-items: center; gap: 5px; min-width: 0; position: relative;
        line-height: 1.1;
      }
      .kidbox.emb {
        min-height: calc(28px * var(--k, 1));
        padding: calc(3px * var(--k, 1)) calc(7px * var(--k, 1));
        border-radius: 8px; overflow: hidden;
        border: 1.25px solid color-mix(in srgb, var(--c) 55%, var(--primary-text-color));
        background: linear-gradient(90deg,
          color-mix(in srgb, var(--c) 15%, transparent) var(--pct, 0%),
          color-mix(in srgb, var(--primary-text-color) 4%, transparent) 0);
      }
      .ktime { font-size: calc(10px * var(--k, 1)); color: var(--secondary-text-color); white-space: nowrap; z-index: 2; pointer-events: none; }
      .kname {
        flex: 1; min-width: 0;
        font-size: calc(11.5px * var(--k, 1)); font-weight: 600; color: var(--primary-text-color);
        text-align: center;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        z-index: 2; pointer-events: none;
      }
      .kpct {
        flex: none; font-size: calc(10px * var(--k, 1));
        color: var(--secondary-text-color); z-index: 2; pointer-events: none;
      }
      .kidbox.emb.has-time .kpct { display: none; }
      .kidbox.emb.has-time.busy .kpct { display: inline; }
      .kidbox.emb.has-time.busy .ktime { display: none; }
      .kicon {
        position: relative; z-index: 2;
        display: flex; align-items: center; justify-content: center;
        padding: 0; border: 0; background: none; cursor: pointer;
        color: var(--c); pointer-events: auto;
      }
      .kicon ha-icon { --mdc-icon-size: calc(14px * var(--k, 1)); }
      .kicon:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
      .slide.cover {
        position: absolute; inset: 0; z-index: 1;
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 100%; margin: 0; padding: 0;
        opacity: 0; cursor: ew-resize;
      }
      .kid {
        min-height: calc(24px * var(--k, 1));
        padding: calc(1px * var(--k, 1)) calc(5px * var(--k, 1));
        font-size: calc(10.5px * var(--k, 1));
      }
      .kid ha-icon { --mdc-icon-size: calc(13px * var(--k, 1)); }

      .master {
        width: calc(20px * var(--k, 1)); height: calc(20px * var(--k, 1)); flex: none;
        margin-top: 1px; padding: 0;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%; cursor: pointer;
        color: #93c5fd; opacity: .85;
        background: transparent;
        border: 1px solid color-mix(in srgb, #60a5fa 55%, transparent);
        box-shadow: 0 0 10px rgba(59, 130, 246, .28);
        transition: opacity .12s ease, box-shadow .12s ease;
      }
      .master ha-icon { --mdc-icon-size: calc(11px * var(--k, 1)); display: block; }
      .master:hover { opacity: 1; box-shadow: 0 0 14px rgba(59, 130, 246, .45); }
      .master:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      @media (max-width: 420px) {
        .aname { font-size: calc(12px * var(--k, 1)); }
      }
    `;
  }

  // HA colour names ("red", "accent") -> theme variables; CSS values pass through.
  _accent(v) {
    v = String(v).trim();
    if (/^[a-z]+$/.test(v) && !/^(transparent|inherit|currentcolor|none)$/.test(v)) {
      return "var(--" + v + "-color, " + v + ")";
    }
    return v;
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

if (!customElements.get("hierarchy-area")) {
  customElements.define("hierarchy-area", HierarchyAreaCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hierarchy-area",
  name: "Hierarchy Area",
  description: "One area per card: compact header, ON entities by default, tap to show everything.",
  preview: false,
  documentationURL: "https://github.com/RenanzAz/glance-plus",
});

console.info("%c HIERARCHY-AREA %c 1.15.0 ", "background:#0f766e;color:#fff", "");

/* ------------------------------------------------------------------ *
 * Editor: area fields + a flat control list (entity, name, group,
 * downstream). Vanilla elements; HA pickers when present.
 * ------------------------------------------------------------------ */
const HAE_EDITOR_CSS = `
  .ed { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
  .sec { border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-weight: 600; }
  .row { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: center; margin: 3px 0; }
  .row > label { font-size: 12px; color: var(--secondary-text-color); }
  input, select {
    font: inherit; font-size: 13px; width: 100%; box-sizing: border-box;
    padding: 4px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
  }
  input[type="checkbox"] { width: auto; }
  .inline { display: flex; gap: 6px; align-items: center; }
  .inline input[type="color"] { width: 34px; height: 30px; padding: 0; flex: none; }
  details { border: 1px solid var(--divider-color); border-radius: 8px; padding: 4px 8px; margin: 5px 0; }
  summary { cursor: pointer; font-size: 13px; font-weight: 500; }
  .btnrow { display: flex; gap: 6px; flex-wrap: wrap; }
  button {
    font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
  }
  .hint { font-size: 11px; color: var(--secondary-text-color); margin: 2px 0 5px; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .ctlrow { display: flex; align-items: flex-start; gap: 2px; }
  .ctlrow details { flex: 1; min-width: 0; }
  .ctlrow.dragging { opacity: .6; box-shadow: 0 8px 20px rgba(0,0,0,.35); border-radius: 8px; }
  .ctlrow summary { display: flex; align-items: center; gap: 8px; list-style: none; user-select: none; -webkit-user-drag: none; }
  .ctlrow summary::-webkit-details-marker { display: none; }
  .drag {
    flex: none; width: 22px; display: flex; align-items: center; justify-content: center;
    color: var(--secondary-text-color);
    cursor: grab; touch-action: none; user-select: none;
  }
  .drag ha-icon { --mdc-icon-size: 16px; }
  .drag:active { cursor: grabbing; }
  .drag:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
  .ctext { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .cname { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csub { font-size: 11px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fields { padding-top: 4px; }
  .del {
    flex: none; margin-top: 7px; width: 26px; height: 26px; padding: 0;
    border: 1px solid transparent; background: transparent;
    color: var(--secondary-text-color); border-radius: 50%;
    cursor: pointer; font-size: 13px; line-height: 1;
  }
  .del ha-icon { --mdc-icon-size: 16px; }
  .del:hover { color: var(--error-color, #db4437); border-color: var(--divider-color); }
  .dsblock { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .dslist { display: flex; flex-direction: column; gap: 4px; }
  .dsrow { display: grid; grid-template-columns: minmax(0, 1fr) 90px auto; gap: 4px; align-items: center; }
  .dsrow > button { padding: 3px 6px; }
  .dsblock { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .dslist { display: flex; flex-direction: column; gap: 4px; }
  .dsrow { display: grid; grid-template-columns: minmax(0, 1fr) 90px auto; gap: 4px; align-items: center; }
  .dsrow > button { padding: 3px 6px; }
`;

class HierarchyAreaEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._pickers = [];
    this._built = false;
    this._lastEmit = null;
    this._list = null;
    // ONE listener on the shadow root. Rows can be re-rendered, replaced or
    // moved freely and the arrows/delete keep working: the handler reads the
    // index from the DOM and resolves it against the live config at click time.
    this._rowCtl = new Map(); // row element -> control object (drag order)
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener("pointerdown", (ev) => this._onPointerDown(ev));
    this.shadowRoot.addEventListener("keydown", (ev) => this._onKeyDown(ev));
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
    if (this._built && incoming === this._lastEmit) return;
    this._config = JSON.parse(JSON.stringify(config || {}));
    const list = Array.isArray(this._config.controls) ? this._config.controls : [];
    this._config.controls = list.map((x) => (typeof x === "string" ? { entity: x } : Object.assign({}, x)));
    this._build();
  }

  // ---- config plumbing ----------------------------------------------------

  _set(key, value) {
    if (value === "" || value == null) delete this._config[key];
    else this._config[key] = value;
    this._changed();
  }

  _changed() {
    // Native visibility only exists in the dashboard config; regenerate it
    // from the current controls so removing an entity cannot leave it stale.
    const vis = HA_VIS(this._config);
    if (vis) this._config.visibility = vis;
    else delete this._config.visibility;
    this._lastEmit = JSON.stringify(this._config);
    // HA deep-freezes the object carried by config-changed, so hand it a copy:
    // this._config must stay mutable for the next edit.
    const config = JSON.parse(JSON.stringify(this._config));
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }

  // ---- delegated actions --------------------------------------------------

  _move(i, dir) {
    const arr = this._config.controls;
    const j = i + dir;
    if (!Number.isInteger(i) || j < 0 || j >= arr.length) return;
    const c = arr[i];
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    this._renderList(c);
    this._changed();
  }

  _onKeyDown(ev) {
    const h = ev.target.closest && ev.target.closest("[data-drag]");
    if (!h) return;
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    ev.preventDefault();
    const row = h.closest(".ctlrow");
    if (!row) return;
    this._move(Number(row.dataset.i), ev.key === "ArrowUp" ? -1 : 1);
  }

  // Drag: grab a handle, move the row element under the pointer, commit the
  // DOM order on release. No index bookkeeping while dragging.
  _onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    const row = ev.target.closest && ev.target.closest(".ctlrow");
    if (!row || !this._list) return;
    // Row chrome drags; form controls keep their own gestures.
    if (ev.target.closest(".del, .fields, input, textarea, select, button, ha-entity-picker, ha-icon-picker")) {
      return;
    }

    const startX = ev.clientX;
    const startY = ev.clientY;
    let dragging = false;

    const rows = () => [...this._list.querySelectorAll(".ctlrow")];

    const onMove = (e) => {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
        dragging = true;
        row.classList.add("dragging");
      }
      // Reorder by row geometry: document.elementFromPoint stops at the shadow
      // boundary, so it can never see a row.
      let target = null;
      for (const el of rows()) {
        if (el === row) continue;
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          target = el;
          break;
        }
      }
      if (target) target.parentNode.insertBefore(row, target);
      else this._list.append(row);
    };

    const onUp = () => {
      // Window listeners (capture phase): no reliance on pointer capture, which
      // silently fails in some modal / touch stacks.
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      row.classList.remove("dragging");
      if (!dragging) return; // plain click: the summary toggles as usual
      this._suppressClick = true; // and do not toggle after a drag
      const order = rows().map((el) => this._rowCtl.get(el)).filter(Boolean);
      if (!order.length || order.length !== this._config.controls.length) return;
      this._config.controls = order;
      this._renderList(this._rowCtl.get(row));
      this._changed();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  _onClick(ev) {
    if (this._suppressClick) {
      this._suppressClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.target.closest("[data-drag]")) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const arr = this._config.controls;

    if (act === "add") {
      const c = { entity: "" };
      arr.push(c);
      this._renderList(c);
      this._changed();
      return;
    }

    const i = Number(btn.dataset.i);
    if (!Number.isInteger(i) || !arr[i]) return;
    const c = arr[i];

    if (act === "del") {
      arr.splice(i, 1);
      this._renderList(null);
    } else if (act === "up" && i > 0) {
      arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
      this._renderList(c);
    } else if (act === "down" && i < arr.length - 1) {
      arr.splice(i + 1, 0, arr.splice(i, 1)[0]);
      this._renderList(c);
    } else {
      return;
    }
    this._changed();
  }

  // ---- controls -----------------------------------------------------------

  _text(value, onDone) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value ?? "";
    el.addEventListener("change", () => onDone(el.value.trim()));
    return el;
  }

  _num(value, onDone) {
    const el = document.createElement("input");
    el.type = "number";
    el.min = "1";
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
    sw.value = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#818cf8";
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

  _button(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- layout -------------------------------------------------------------

  _build() {
    this._pickers = [];
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = HAE_EDITOR_CSS;
    const ed = document.createElement("div");
    ed.className = "ed";

    const card = this._section("Area");
    const hideName = this._row("Hide Name when On", this._bool(this._config.hide_name_on !== false, (v) => {
      this._set("hide_name_on", v);
    }));
    const hideHint = document.createElement("div");
    hideHint.className = "hint";
    hideHint.textContent =
      "Hide upstream switch name when turned on and downstream devices are present.";
    card.append(
      this._row("Name", this._text(this._config.name, (v) => this._set("name", v))),
      this._row("Icon", this._picker("ha-icon-picker", this._config.icon, (v) => this._set("icon", v))),
      this._row("Accent", this._color(this._config.accent, (v) => this._set("accent", v))),
      this._row("Columns", this._num(this._config.columns, (v) => this._set("columns", v))),
      this._row("Size", this._select(this._config.size || "medium", [
        ["small", "Small"],
        ["medium", "Medium"],
        ["large", "Large"],
      ], (v) => this._set("size", v === "medium" ? "" : v))),
      this._row("Secondary info", this._select(this._config.secondary_info || "last-changed", [
        ["last-changed", "Last changed"],
        ["last-updated", "Last updated"],
        ["none", "None"],
      ], (v) => this._set("secondary_info", v === "last-changed" ? "" : v))),
      this._row("Header", this._select(this._config.header_style || "inside", [
        ["inside", "Inside the card"],
        ["title", "Title, outside the card"],
      ], (v) => this._set("header_style", v === "inside" ? "" : v))),
      hideName,
      hideHint,
      this._row("Show helper", this._picker("ha-entity-picker", this._config.show_helper, (v) => {
        this._set("show_helper", v);
      }, { allowCustomEntity: true }))
    );
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Columns = tiles per row (default 4). Secondary info = the timestamp shown with names.";
    card.append(hint);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "+ Control";
    add.dataset.act = "add";
    this._sec = this._section("Switches & devices", [add]);
    this._list = document.createElement("div");
    this._list.className = "list";
    this._sec.append(this._list);
    this._renderList(null);

    const ver = document.createElement("div");
    ver.className = "hint";
    ver.textContent = "hierarchy-area 1.12.0";

    ed.append(card, this._sec, ver);
    root.append(style, ed);
    this._built = true;
  }

  // Re-render the whole list from the model. `open` is the control object whose
  // panel should stay open (survives reorder because the objects are stable).
  _renderList(open) {
    if (!this._list) return;
    this._pickers = this._pickers.filter((p) => p.isConnected);
    this._rowCtl = new Map();
    this._list.textContent = "";
    const list = this._config.controls;
    if (!list.length) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "No controls yet. Add one, then pick its entity.";
      this._list.append(hint);
      return;
    }
    list.forEach((c, i) => {
      const row = this._controlRow(c, i, c === open);
      this._rowCtl.set(row, c);
      this._list.append(row);
    });
  }

  _controlRow(c, i, open) {
    const body = document.createDocumentFragment();
    const at = () => this._config.controls[i];
    const cname = document.createElement("span");
    cname.className = "cname";
    const csub = document.createElement("span");
    csub.className = "csub";
    const sync = () => {
      const cur = at() || c;
      cname.textContent = cur.name || cur.entity || "new control";
      csub.textContent = [cur.group, cur.entity].filter(Boolean).join(" · ");
    };
    sync();

    body.append(
      this._row("Entity", this._picker("ha-entity-picker", c.entity, (v) => {
        const cur = at();
        if (!cur) return;
        if (v) cur.entity = v;
        else delete cur.entity;
        sync();
        this._changed();
      }, { allowCustomEntity: true })),
      this._row("Name", this._text(c.name, (v) => {
        const cur = at();
        if (!cur) return;
        if (v) cur.name = v;
        else delete cur.name;
        sync();
        this._changed();
      })),
      this._row("Plate", this._text(c.group, (v) => {
        const cur = at();
        if (!cur) return;
        if (v) cur.group = v;
        else delete cur.group;
        sync();
        this._changed();
      })),
      this._row("Icon", this._picker("ha-icon-picker", c.icon, (v) => {
        const cur = at();
        if (!cur) return;
        if (v) cur.icon = v;
        else delete cur.icon;
        this._changed();
      }))
    );

    body.append(this._row("Downstream", this._downstreamBlock(c, i)));

    const hasSwitch = this._config.controls.some((x) => String(x.entity || "").startsWith("switch."));
    const holdDefault = String(c.entity || "").startsWith("switch.") || !hasSwitch;
    const holdValue = c.hold !== undefined ? c.hold !== false : holdDefault;
    body.append(
      this._row("Holds card", this._bool(holdValue, (v) => {
        const cur = at();
        if (!cur) return;
        cur.hold = v;
        this._changed();
      })),
      this._row("With switch", this._bool(c.follow === true, (v) => {
        const cur = at();
        if (!cur) return;
        if (v) cur.follow = true;
        else delete cur.follow;
        this._changed();
      }))
    );
    const fhint = document.createElement("div");
    fhint.className = "hint";
    fhint.textContent = "Holds card = while on, keeps the area visible. Default: switches only. With switch = toggling this also switches its downstream devices.";
    body.append(fhint);

    const drag = document.createElement("span");
    drag.className = "drag";
    drag.dataset.drag = "";
    drag.setAttribute("role", "button");
    drag.setAttribute("tabindex", "0");
    drag.setAttribute("aria-label", "Drag to reorder, or use Arrow Up / Arrow Down");
    const dragIcon = document.createElement("ha-icon");
    dragIcon.setAttribute("icon", "mdi:drag-vertical");
    drag.append(dragIcon);

    const text = document.createElement("span");
    text.className = "ctext";
    text.append(cname, csub);

    const summary = document.createElement("summary");
    summary.append(drag, text);

    const d = document.createElement("details");
    d.className = "ctl";
    d.open = !!open;
    const fields = document.createElement("div");
    fields.className = "fields";
    fields.append(body);
    d.append(summary, fields);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    const delIcon = document.createElement("ha-icon");
    delIcon.setAttribute("icon", "mdi:close");
    del.append(delIcon);
    del.title = "Delete control";
    del.setAttribute("aria-label", "Delete " + (c.name || c.entity || "control"));
    del.dataset.act = "del";
    del.dataset.i = String(i);

    const row = document.createElement("div");
    row.className = "ctlrow";
    row.dataset.i = String(i);
    row.append(d, del);
    return row;
  }

  // Downstream is a list of entity pickers, not free text.
  _downstreamBlock(c, ci) {
    const wrap = document.createElement("div");
    wrap.className = "dsblock";
    const list = document.createElement("div");
    list.className = "dslist";
    const cur = () => this._config.controls[ci] || c;

    const render = () => {
      list.textContent = "";
      const cfg = cur();
      (cfg.downstream || []).forEach((d, i) => {
        const row = document.createElement("div");
        row.className = "dsrow";
        const pick = this._picker("ha-entity-picker", d.entity, (v) => {
          d.entity = v || "";
          this._changed();
        }, { allowCustomEntity: true });
        const name = this._text(d.name, (v) => {
          if (v) d.name = v;
          else delete d.name;
          this._changed();
        });
        name.placeholder = "Name";
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "✕";
        del.title = "Remove downstream";
        del.addEventListener("click", () => {
          const target = cur();
          target.downstream.splice(i, 1);
          if (!target.downstream.length) delete target.downstream;
          render();
          this._changed();
        });
        row.append(pick, name, del);
        list.append(row);
      });
      if (!(cfg.downstream || []).length) {
        const none = document.createElement("div");
        none.className = "hint";
        none.textContent = "No downstream devices.";
        list.append(none);
      }
    };

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "+ Downstream";
    add.addEventListener("click", () => {
      const target = cur();
      target.downstream = target.downstream || [];
      target.downstream.push({ entity: "" });
      render();
      this._changed();
    });

    render();
    wrap.append(list, add);
    return wrap;
  }
}


if (!customElements.get("hierarchy-area-editor")) {
  customElements.define("hierarchy-area-editor", HierarchyAreaEditor);
}
