// Web UI for daikin-altherma-esp32 — a client-side, single-screen dashboard over the firmware HTTP
// API. Everything lives on one page (no settings/sub-screens); MQTT is edited in a modal.
// Design contract: docs/DESIGN.md. Split from index.html for edit locality; spliced back in at
// build time (inline_assets.cmake). No framework, no external assets.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ── App state ────────────────────────────────────────────────────────────
const S = {
  status: null,
  busy: false,
};

// ── Toasts ───────────────────────────────────────────────────────────────
let _tid = 0;
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "ok" ? " ok" : type === "err" ? " err" : "");
  el.innerHTML = `<span class="disc">${type === "ok" ? "✓" : type === "err" ? "!" : "i"}</span><span></span>`;
  el.lastChild.textContent = msg;
  $("toasts").appendChild(el);
  const id = ++_tid; el.dataset.id = id;
  setTimeout(() => el.remove(), type === "err" ? 4200 : 2600);
}

// ── Status (drives the whole dashboard) ──────────────────────────────────
async function refreshStatus() {
  let s;
  try { s = await j("/status"); } catch { markUnreachable(); return; }
  S.status = s;
  renderDashboard();
}
function markUnreachable() {
  $("heroKicker").textContent = "No data";
  $("heroMode").textContent = "Unreachable";
  $("heroSub").textContent = "Can't reach the device — retrying…";
  $("heroDot").style.background = "var(--err)";
}

function renderDashboard() {
  const s = S.status || {}, hp = s.hp || {};
  // Header is a fixed product title ("Daikin Altherma ESP32", set in index.html) — the detected
  // model name lives in the Model card (statusCardsHtml), not the header.

  // hero: operation mode + fault state
  const mode = pickValue(/operation mode|^mode$/i);
  const fault = faultValue();
  const faulted = fault && !FAULT_OK.test(String(fault).trim());
  if (!hp.connected) {
    heroSet("No data", "No data", "Waiting for the heat pump…", "var(--muted)");
  } else if (faulted) {
    heroSet("Fault · " + fault, mode || "Fault", "Unit reported " + fault + " — check the outdoor unit.", "var(--err)");
  } else {
    const lw = pickValue(/leaving water/i), oat = pickValue(/outdoor air|outdoor$/i);
    const sub = lw ? `Leaving water ${lw} °C${oat ? " · outdoor " + oat + " °C" : ""}`
                   : (hp.last_ok_s != null ? `Polled ${hp.last_ok_s}s ago` : "Running");
    heroSet("Operating", mode || "Online", sub, "var(--ok)");
  }
  renderCards();
}
function heroSet(kicker, mode, sub, dot) {
  $("heroKicker").textContent = kicker; $("heroMode").textContent = mode;
  $("heroSub").textContent = sub; $("heroDot").style.background = dot;
}
function pickValue(re) {
  const v = (S._values || []).find((x) => re.test(x.label || ""));
  return v ? (v.value == null ? null : String(v.value)) : null;
}
// A "no fault" reading (also the empty/absent case). Shared by the hero + faultValue so they agree.
const FAULT_OK = /^(none|no fault|normal|ok|0|—|-)?$/i;
// The unit fault to surface in the hero. Prefer the specific *code* (conv 204, labelled "… Code" →
// e.g. "U4") a technician needs over the generic *class* (conv 203, "Error type" → "Error"/"Caution").
// Both an indoor (0x60) and an outdoor (0x10) pair exist and their offset order differs per model, so
// a plain first-match on /fault|error/ can land on the class (the outdoor "Error type" sorts first).
// Return a faulted code from EITHER unit; else the first code (a healthy "0") or the class label — both
// read as not-faulted via FAULT_OK, so a healthy unit is never shown as faulted.
function faultValue() {
  const codes = (S._values || []).filter((x) => /(error|fault) code/i.test(x.label || "") && x.value != null);
  const bad = codes.find((x) => !FAULT_OK.test(String(x.value).trim()));
  if (bad) return String(bad.value);
  if (codes.length) return String(codes[0].value);
  return pickValue(/fault|error/i);
}

// ── Values (dashboard) ───────────────────────────────────────────────────
const GROUPS = [
  ["Operation", ["operation mode", "thermostat", "space heat", "domestic hot water", "fault", "defrost"]],
  ["Domestic hot water", ["tank", "dhw", "hot water"]],
  ["Water circuit", ["leaving water", "return water", "flow", "water pressure", "heating-flow", "heating flow", "target", "delta", "pump", "valve", "3-way"]],
  ["Refrigerant / outdoor", ["outdoor", "heat-exchanger", "heat exchanger", "high pressure", "low pressure", "refrigerant", "compressor", "fan"]],
  ["Electrical", ["current", "ct l", "inv ", "backup-heater", "backup heater", "stage", "capacity"]],
  ["Device", ["wi-fi", "wifi", "mqtt", "hp link", "link", "poll", "uptime", "firmware", "rssi"]],
];
function groupOf(v) {
  if (v.group) return v.group;
  const l = (v.label || "").toLowerCase();
  for (const [name, keys] of GROUPS) if (keys.some((k) => l.includes(k))) return name;
  return "Other values";
}
async function refreshValues() {
  let r;
  try { r = await j("/values"); } catch { return; }
  S._values = r.values || r || [];
  renderDashboard();
}
// Dashboard cards: connectivity/identity (WiFi · MQTT · Model) first, then the heat-pump value
// groups — all one continuous card grid, each block styled like OPERATION.
function renderCards() {
  // The card grid is rebuilt on every poll (4/8 s). The ESP32 card's RX/TX pin dropdown is
  // interactive, so skip the rebuild while it's focused/open — otherwise the poll would collapse it
  // mid-pick. It resumes once focus leaves (onPinPick blurs it after applying).
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("pin-sel")) return;
  $("valueGroups").innerHTML = statusCardsHtml() + valueGroupsHtml(S._values || [], S.status?.hp?.connected);
}
// One label→value row; `v` is escaped unless opt.html (e.g. signal-bar markup).
function vrow(k, v, opt = {}) {
  const val = (opt.html ? v : esc(v)) + (opt.unit ? `<span class="vrow-unit">${esc(opt.unit)}</span>` : "");
  return `<div class="vrow"><span class="vrow-label">${esc(k)}</span>` +
    `<span class="vrow-val ${opt.cls || ""}">${val}</span></div>`;
}
const vcard = (label, rows) => `<div class="vgroup"><div class="card">` +
  `<div class="section-label">${esc(label)}</div>${rows}</div></div>`;
const editIcon = `<svg class="vcard-edit-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const vcardEdit = (label, rows, edit) => `<div class="vgroup"><div class="card">` +
  `<button class="vgroup-head vgroup-btn" type="button" data-edit="${esc(edit)}" aria-label="Edit ${esc(label)}">` +
  `<span class="section-label">${esc(label)}</span>${editIcon}</button>` +
  `${rows}</div></div>`;

// Human-readable uptime from a seconds count (/status.uptime_s).
function fmtUptime(s) {
  if (s == null) return "—";
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
// RX/TX pin dropdown row — shown only when auto-detection hasn't locked a working pin pair, so the
// user picks from the board's actually-usable GPIOs (logic/board_pins.hpp → /status.pins_avail).
// The current pin is always an option even if it's off-list (e.g. a stale/custom value).
function pinSelRow(label, id, val, pins) {
  const list = (val != null && !pins.includes(val)) ? [val, ...pins].sort((a, b) => a - b) : pins;
  const opts = list.map((p) => `<option value="${p}"${p === val ? " selected" : ""}>${p}</option>`).join("");
  return `<div class="vrow"><span class="vrow-label">${esc(label)}</span>` +
    `<select class="input mono num pin-sel" id="${id}" aria-label="${esc(label)}">${opts}</select></div>`;
}

const fwRow = (version) =>
  `<button class="vrow vrow-btn" type="button" data-act="ota" aria-label="Check for firmware updates">` +
  `<span class="vrow-label">Firmware</span>` +
  `<span class="vrow-val mono">v${esc(version)}</span></button>`;

// ESP32 board status card: chip / firmware (tap = check for OTA update) / uptime, the X10A link +
// protocol, and the RX/TX pins. Pins are auto-detected: once the bus answers on a pair they show
// read-only; until then a dropdown of the board's wire-able GPIOs lets the user point the firmware at
// their wiring. A brief timeout doesn't flip back to the dropdown (last_ok_s grace window).
function esp32CardHtml() {
  const s = S.status || {}, hp = s.hp || {};
  const proto = hp.proto === "I" ? "X10A-I" : hp.proto === "S" ? "X10A-S" : "—";
  const pinsLocked = hp.connected || (typeof hp.last_ok_s === "number" && hp.last_ok_s >= 0 && hp.last_ok_s <= 30);
  const avail = Array.isArray(s.pins_avail) ? s.pins_avail : [];
  const pinRow = (label, id, val, other) => pinsLocked
    ? vrow(label, val != null ? String(val) : "—", { cls: "mono num" })
    : pinSelRow(label, id, val, avail.filter((p) => p !== other));
  const rows =
    vrow("Chip", s.platform || "—", { cls: "mono" }) +
    fwRow(s.version || "?") +
    vrow("Uptime", fmtUptime(s.uptime_s)) +
    vrow("Heat-pump link", hp.connected ? "Online" : "Offline", { cls: hp.connected ? "ok" : "err" }) +
    vrow("Protocol", hp.connected ? proto : "—") +
    pinRow("RX pin", "e32Rx", hp.rx, hp.tx) +
    pinRow("TX pin", "e32Tx", hp.tx, hp.rx);
  return vcard("ESP32", rows);
}

// WiFi · MQTT · Model status cards, from /status (live link, broker/HA-discovery, detected unit).
function statusCardsHtml() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, hp = S.status?.hp || {}, d = S.status?.detect || {};
  const wifi = (w.connected && (w.rssi != null || w.ssid))
    ? vrow("Signal", w.rssi != null ? signalBars(w.rssi) : "—", { html: true }) +
      vrow("Network", w.ssid || "—") +
      vrow("IP address", w.ip || location.hostname, { cls: "num" })
    : vrow("Status", "Offline", { cls: "warn" });

  let mqtt;
  if (!m.configured) {
    mqtt = vrow("Status", "Disabled");
  } else {
    const st = m.connected ? ["Connected", "ok"] : m.error ? ["Error", "err"] : ["Connecting…", "warn"];
    mqtt = vrow("Status", st[0], { cls: st[1] }) +
      vrow("Broker", m.broker || "—") +
      vrow("Encryption", m.tls ? "TLS" : "Off") +
      vrow("Home Assistant", m.connected ? "Discovery active" : "—", { cls: m.connected ? "ok" : "" });
  }

  // Outdoor unit as a full-width heading — model names are long and don't fit a label→value row.
  // The X10A link + protocol live on the ESP32 card (they're about the board's bus), not here.
  // Identity is bus-derived: the model name degrades to the brand offline (hpModelName), and capacity
  // (from the cached fingerprint) is shown ONLY while connected — never a stale value read as live.
  // No "Detection: auto/manual" row: detection is fully automatic, an internal detail.
  let model = `<div class="vname">${esc(hpModelName())}</div>`;
  if (hp.connected && d.capacity_kw != null) model += vrow("Capacity", String(d.capacity_kw), { unit: "kW" });

  // Model identity is only meaningful while the bus answers — hide the card entirely when the
  // heat-pump link is down instead of naming a unit (or showing a stale capacity) that isn't live.
  return esp32CardHtml() + vcard("WiFi", wifi) + vcardEdit("MQTT", mqtt, "mqtt") + (hp.connected ? vcard("Model", model) : "");
}
// Heat-pump value groups (grouped by domain, §6) as card markup. Hidden entirely while the
// heat-pump link is down — there's nothing to poll, so "Waiting for the first poll…" would be
// misleading (implies data is imminent) rather than "not connected".
function valueGroupsHtml(vals, connected) {
  if (!connected) return "";
  if (!vals.length) return `<div class="vgroup"><div class="card"><span class="empty">Waiting for the first poll…</span></div></div>`;
  const order = [...GROUPS.map((g) => g[0]), "Other values"];
  const buckets = new Map();
  for (const v of vals) { const g = groupOf(v); (buckets.get(g) || buckets.set(g, []).get(g)).push(v); }
  const grouped = buckets.size > 1;
  const rowsOf = (rows) => rows.map((v) =>
    vrow(v.label, v.value == null ? "—" : String(v.value), { cls: v.state || v.class || "", unit: v.unit })).join("");
  let html = ""; const done = new Set();
  const emit = (name, rows) => { html += vcard(grouped ? name : "Values", rowsOf(rows)); };
  for (const name of order) if (buckets.has(name)) { emit(name, buckets.get(name)); done.add(name); }
  for (const [name, rows] of buckets) if (!done.has(name)) emit(name, rows); // firmware-supplied custom groups
  return html;
}

// ── MQTT (dashboard edit modal) ───────────────────────────────────────────
// The MQTT broker is edited in a modal opened from the dashboard card's pencil — there is no
// settings sub-screen. Only the broker prefills (user/pass aren't exposed by /status); a Save
// reboots to apply (saveReboot), Cancel/backdrop/Esc dismiss without a write.
function fillMqtt() {
  const m = S.status?.mqtt || {};
  $("mqBroker").value = m.broker || "";
}
function openMqtt() {
  fillMqtt();
  $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
  $("mqttModal").hidden = false;
  $("mqBroker").focus();
}
function closeMqtt() { $("mqttModal").hidden = true; }
// Accept a bare host:port (defaults to plaintext mqtt://) OR an explicit scheme. Credentials require
// mqtts:// (the bridge refuses plaintext + creds), so the field MUST allow a scheme — otherwise the
// only secure path is un-enterable. mqtt(s)://host[:port] and ws(s):// forms pass; empty disables.
const validMqtt = (h) => {
  h = h.trim();
  return !h || /^[\w.\-]+:\d{2,5}$/.test(h) || /^(mqtts?|wss?):\/\/[\w.\-]+(:\d{2,5})?$/.test(h);
};
function signalBars(rssi) {
  const lit = rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
  const tone = rssi >= -70 ? "var(--ok)" : "var(--warn)";
  let bars = ""; for (let i = 1; i <= 4; i++) bars += `<i class="${i <= lit ? "on" : ""}"></i>`;
  return `<span class="signal lit" style="color:${tone}">${bars}</span> <span class="num" style="color:${tone};font-weight:600">${rssi} dBm</span>`;
}

// ── Heat pump (model identity + wiring) ──────────────────────────────────
// Dashboard header / Model-card name: the auto-detected model, asserted ONLY when detection is
// unambiguous. Several register-identical families (ambiguous) or a generic fallback read as the
// brand — matching the honest Model card, never claiming e.g. an EBLA monobloc for a register-
// identical ERGA split. Driven purely by /status.detect; there is no manual selection.
function hpModelName() {
  // Assert a concrete model ONLY while the bus is live AND detection is unambiguous — never name a
  // specific unit from a cached fingerprint while the link is silent (offline → the brand only).
  const s = S.status || {}, hp = s.hp || {}, d = s.detect, m = d?.model;
  if (hp.connected && d?.valid && (d.families || []).length === 1 && m && (m.marketing || m.name)) return m.marketing || m.name;
  return "Daikin Altherma";
}

// Partial live write to /set_hp. Omitted keys keep their stored value; a rejection/error surfaces.
async function applyLive(patch, okMsg) {
  try {
    const r = await post("/set_hp", patch);
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || "Rejected", "err"); return false; }
    if (okMsg) toast(okMsg, "ok");
    return true;
  } catch { toast("Couldn't reach the device", "err"); return false; }
}

// Picking RX/TX from the dropdown points auto-detection at those pins: reset to "auto" so the next
// poll cycle re-sweeps the chosen pair (+ its swap), then refresh a few times to catch the connect —
// on success the card flips the pins to read-only.
async function onPinPick() {
  const rx = +$("e32Rx").value, tx = +$("e32Tx").value;
  $("e32Rx").blur(); $("e32Tx").blur();
  if (!(await applyLive({ profile: "auto", rx, tx }, "Trying pins…"))) return;
  let n = 0;
  const t = setInterval(async () => { await refreshStatus(); if (++n >= 5 || S.status?.hp?.connected) clearInterval(t); }, 1500);
}

// ── Firmware / OTA ───────────────────────────────────────────────────────
// Tapping the Firmware version checks for an OTA update. TODO: wire to /ota/check + /ota/status +
// /ota/update once a published GitHub release feed exists (ota_update.cpp check is also a stub). For
// now there is no release source, so this is an honest placeholder instead of a misleading result.
function checkFirmwareUpdate() {
  toast("Update checking isn’t available yet", "info");
}

// ── Reboot-and-reconnect writes (MQTT) ────────────────────────────────────
async function saveReboot(url, body, then) {
  if (S.busy) return; S.busy = true;
  toast("Rebooting — reconnecting…", "info");
  try { await post(url, body); } catch { /* device may drop the socket as it reboots */ }
  let tries = 0;
  const poll = setInterval(async () => {
    tries++;
    try { S.status = await j("/status"); clearInterval(poll); S.busy = false; toast("Saved", "ok"); then(); }
    catch { if (tries > 14) { clearInterval(poll); S.busy = false; toast("Rebooted — reconnect to the device", "info"); } }
  }, 1500);
}

// ── Boot ─────────────────────────────────────────────────────────────────
function wire() {
  // The dashboard card grid (#valueGroups) is rebuilt on every poll, so its interactive controls are
  // wired by delegation: the MQTT card's pencil opens the edit modal, the ESP32 card's Firmware row
  // checks for an OTA update, and its RX/TX dropdowns re-run pin auto-detection on change.
  $("valueGroups").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit && edit.dataset.edit === "mqtt") { openMqtt(); return; }
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "ota") checkFirmwareUpdate();
  });
  $("valueGroups").addEventListener("change", (e) => {
    if (e.target.id === "e32Rx" || e.target.id === "e32Tx") onPinPick();
  });
  $("mqCancel").onclick = closeMqtt;
  $("mqttBackdrop").onclick = closeMqtt;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("mqttModal").hidden) closeMqtt(); });
  $("mqttForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const broker = $("mqBroker").value;
    if (!validMqtt(broker)) { $("mqBroker").classList.add("invalid"); $("mqError").hidden = false; toast("Check the broker address", "err"); return; }
    $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
    saveReboot("/set_mqtt", { broker, user: $("mqUser").value, pass: $("mqPass").value }, () => { closeMqtt(); renderDashboard(); });
  });
  $("mqBroker").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; });
}

async function boot() {
  wire();

  if (window.WebSocket) {
    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/events`;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        ws.send("sub");
      };
      ws.onmessage = (e) => {
        try {
          const r = JSON.parse(e.data);
          if (r.type === "status") {
            S.status = r.status;
            renderDashboard();
          } else if (r.type === "values") {
            S._values = r.values;
            renderDashboard();
          } else {
            S._values = r.values || r || [];
            renderDashboard();
          }
        } catch (err) {
          console.error("WS parse error", err);
        }
      };
      ws.onclose = () => {
        markUnreachable();            // show "Unreachable — retrying…" until the socket re-opens
        setTimeout(connect, 5000);
      };
    };
    connect();
  } else {
    // No WebSocket in this browser: load a one-time snapshot and stop. There is no polling —
    // the live UI is WebSocket-only, so the user refreshes by reloading the page manually.
    await refreshStatus();
    refreshValues();
  }
}
boot();
