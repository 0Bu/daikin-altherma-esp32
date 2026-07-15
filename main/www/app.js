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
  renderCrashBanner();
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

// ── Crash banner ─────────────────────────────────────────────────────────
// Shown when /status.last_crash is set — a fault reset (panic / watchdog / brown-out) or a core dump
// still waiting in flash. Offers the raw dump download (symbolized offline against the matching .elf
// — scripts/decode-coredump.sh) and a copy-paste diagnostics bundle for a bug report. Lives outside
// #valueGroups (rebuilt every poll), so its dismissed state survives re-renders; dismissal is keyed
// to the crash signature, so a NEW crash re-shows the banner.
function renderCrashBanner() {
  const el = $("crashBanner"), c = S.status?.last_crash;
  if (!c) { el.hidden = true; return; }
  const sig = `${c.reason}:${c.pc || ""}:${c.task || ""}`;
  if (S.crashDismissed === sig) { el.hidden = true; return; }
  if (el.dataset.sig === sig && !el.hidden) return;   // already rendered this crash — don't thrash the DOM
  el.dataset.sig = sig;

  const s = S.status || {}, bt = Array.isArray(c.backtrace) ? c.backtrace : [];
  const bits = [`Reset: <b>${esc(c.reason)}</b>`];
  if (c.task) bits.push(`task <span class="mono">${esc(c.task)}</span>`);
  if (s.version) bits.push(`fw v${esc(s.version)}`);
  if (s.app_elf_sha256) bits.push(`elf <span class="mono">${esc(s.app_elf_sha256.slice(0, 12))}…</span>`);
  const btHtml = bt.length
    ? `<div class="crash-bt mono">${esc(bt.join(" "))}${c.corrupted ? " (corrupted)" : ""}</div>` : "";
  const dl = c.coredump
    ? `<a class="btn secondary sm" href="/coredump" download="coredump.bin">Download crash report</a>` : "";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">Device restarted after a crash</div>` +
    `<div class="crash-meta">${bits.join(" · ")}</div>${btHtml}</div></div>` +
    `<div class="crash-actions">${dl}` +
    `<button class="btn secondary sm" type="button" data-cact="copy">Copy diagnostics</button>` +
    `<button class="btn ghost sm" type="button" data-cact="dismiss">Dismiss</button></div>`;
  el.hidden = false;
}

// Copy text to the clipboard. The async Clipboard API needs a SECURE context (https/localhost), but
// the device is served over plain http on the LAN (no TLS by design) — there navigator.clipboard is
// undefined, so fall back to the legacy execCommand path, which still works in an http page.
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "0"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// Assemble a paste-ready diagnostics bundle (identity + crash summary + the /diag ring) and copy it
// to the clipboard, so a user can drop it straight into a bug report without pulling the binary dump.
async function copyDiagnostics() {
  let diag = "";
  try { diag = await (await fetch("/diag")).text(); } catch { /* keep the rest of the bundle */ }
  const s = S.status || {}, c = s.last_crash || {}, bt = Array.isArray(c.backtrace) ? c.backtrace : [];
  const lines = [
    "daikin-altherma-esp32 crash report",
    `firmware: v${s.version || "?"} (${s.platform || "?"})`,
    `app_elf_sha256: ${s.app_elf_sha256 || "?"}`,
    `reset: ${c.reason || "?"}  fault=${!!c.fault}  coredump=${!!c.coredump}`,
  ];
  if (c.task) lines.push(`task: ${c.task}  pc: ${c.pc || "?"}`);
  if (bt.length) lines.push(`backtrace: ${bt.join(" ")}${c.corrupted ? "  (corrupted)" : ""}`);
  if (c.elf_sha256 && c.elf_sha256 !== s.app_elf_sha256) lines.push(`crashed build elf_sha256: ${c.elf_sha256}`);
  lines.push("", "--- /diag ---", diag.trim());
  if (await copyText(lines.join("\n"))) toast("Diagnostics copied — paste into a bug report", "ok");
  else toast("Copy failed — open /coredump and /diag manually", "err");
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
// Gray padlock shown next to the broker URL when the MQTT link is TLS (mqtts://) — a quiet
// "this connection is encrypted" marker, not a status row.
const lockIcon = `<svg class="vrow-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="TLS encrypted"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
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
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, sy = S.status?.syslog || {}, hp = S.status?.hp || {}, d = S.status?.detect || {};
  const wifi = (w.connected && (w.rssi != null || w.ssid))
    ? vrow((w.std || "Wi-Fi").toUpperCase(),
           (w.rssi != null ? signalBars(w.rssi) : "") +
           (w.rssi != null ? ` <span style="margin-left: 4px; margin-right: 4px; font-weight: 500; font-size: 14.5px; color: var(--muted);">${w.rssi} dBm</span>` : "") +
           (w.ssid ? ` <span style="color: var(--ok); font-weight: 600;">${esc(w.ssid)}</span>` : ""),
           { html: true }) +
      vrow("IP address", w.ip || location.hostname, { cls: "num" }) +
      (w.mac ? vrow("MAC", w.mac, { cls: "mono num" }) : "") +
      (w.bssid ? vrow("BSSID", w.bssid, { cls: "mono num" }) : "")
    : vrow("Status", "Offline", { cls: "warn" });

  let mqtt;
  if (!m.configured) {
    mqtt = vrow("Status", "Disabled");
  } else {
    const st = m.connected ? ["Connected", "ok"] : m.error ? ["Error", "err"] : ["Connecting…", "warn"];
    // A gray padlock trails the broker URL when the link is TLS (mqtts://) — the encryption state
    // is shown inline as a marker, not as its own row.
    const broker = esc(m.broker || "—") + (m.tls ? lockIcon : "");
    mqtt = vrow("Status", st[0], { cls: st[1] }) +
      vrow("Broker", broker, { html: true });
  }

  let syslog;
  if (!sy.configured) {
    syslog = vrow("Status", "Disabled");
  } else {
    // Delivery is gated on DNS only (resolved); reachability is an advisory ping hint — "Enabled" once
    // resolving, warn-flagged (still forwarding) when the host doesn't answer the probe.
    let st;
    if (sy.error) st = [sy.error, "err"];
    else if (sy.resolved) st = sy.reachable ? ["Enabled", "ok"] : ["Enabled · host not answering ping", "warn"];
    else st = ["Resolving…", "warn"];
    syslog = vrow("Status", st[0], { cls: st[1] }) +
      vrow("Server", sy.host ? `${sy.host}:${sy.port || 514}` : "—");
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
  return esp32CardHtml() + vcardEdit("WiFi", wifi, "wifi") + vcardEdit("MQTT", mqtt, "mqtt") + vcardEdit("Syslog", syslog, "syslog") + (hp.connected ? vcard("Model", model) : "");
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

// ── WiFi (dashboard edit modal) ───────────────────────────────────────────
function fillWifi() {
  const w = S.status?.wifi || {};
  $("wfSSID").value = w.ssid || "";
  $("wfPass").value = "";
}
function openWifi() {
  fillWifi();
  $("wfSSID").classList.remove("invalid");
  $("wfPass").classList.remove("invalid");
  $("wfSSIDError").hidden = true;
  $("wfPassError").hidden = true;
  $("wifiModal").hidden = false;
  $("wfSSID").focus();
}
function closeWifi() { $("wifiModal").hidden = true; }

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

// ── Syslog (dashboard edit modal) ───────────────────────────────────────────
function fillSyslog() {
  const sy = S.status?.syslog || {};
  $("slHost").value = sy.host ? `${sy.host}:${sy.port || 514}` : "";
}
function openSyslog() {
  fillSyslog();
  $("slHost").classList.remove("invalid");
  $("slError").hidden = true;
  $("syslogModal").hidden = false;
  $("slHost").focus();
}
function closeSyslog() { $("syslogModal").hidden = true; }
function signalBars(rssi) {
  const lit = rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
  const tone = rssi >= -70 ? "var(--ok)" : "var(--warn)";
  let bars = ""; for (let i = 1; i <= 4; i++) bars += `<i class="${i <= lit ? "on" : ""}"></i>`;
  return `<span class="signal lit" style="color:${tone}">${bars}</span>`;
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
    if (edit && edit.dataset.edit === "wifi") { openWifi(); return; }
    if (edit && edit.dataset.edit === "mqtt") { openMqtt(); return; }
    if (edit && edit.dataset.edit === "syslog") { openSyslog(); return; }
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "ota") checkFirmwareUpdate();
  });
  $("valueGroups").addEventListener("change", (e) => {
    if (e.target.id === "e32Rx" || e.target.id === "e32Tx") onPinPick();
  });
  // Crash banner: Copy diagnostics / Dismiss. The download link is a plain <a download> (no handler).
  $("crashBanner").addEventListener("click", (e) => {
    const act = e.target.closest("[data-cact]");
    if (!act) return;
    if (act.dataset.cact === "dismiss") { S.crashDismissed = $("crashBanner").dataset.sig; $("crashBanner").hidden = true; }
    else if (act.dataset.cact === "copy") copyDiagnostics();
  });
  $("wfCancel").onclick = closeWifi;
  $("wifiBackdrop").onclick = closeWifi;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("wifiModal").hidden) closeWifi(); });
  $("wifiForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const ssid = $("wfSSID").value.trim();
    const pass = $("wfPass").value;
    let valid = true;
    if (!ssid || ssid.length > 32) {
      $("wfSSID").classList.add("invalid");
      $("wfSSIDError").hidden = false;
      valid = false;
    } else {
      $("wfSSID").classList.remove("invalid");
      $("wfSSIDError").hidden = true;
    }
    if (pass.length > 0 && (pass.length < 8 || pass.length > 63)) {
      $("wfPass").classList.add("invalid");
      $("wfPassError").hidden = false;
      valid = false;
    } else {
      $("wfPass").classList.remove("invalid");
      $("wfPassError").hidden = true;
    }
    if (!valid) { toast("Check WiFi settings", "err"); return; }
    saveReboot("/set_wifi", { ssid, pass }, () => { closeWifi(); renderDashboard(); });
  });
  $("wfSSID").addEventListener("input", () => { $("wfSSID").classList.remove("invalid"); $("wfSSIDError").hidden = true; });
  $("wfPass").addEventListener("input", () => { $("wfPass").classList.remove("invalid"); $("wfPassError").hidden = true; });

  $("mqCancel").onclick = closeMqtt;
  $("mqttBackdrop").onclick = closeMqtt;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("mqttModal").hidden) closeMqtt(); });
  $("mqttForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const broker = $("mqBroker").value.trim();
    if (!validMqtt(broker)) {
      $("mqBroker").classList.add("invalid");
      $("mqError").textContent = "Enter host:port — e.g. 192.168.1.10:1883 — or mqtts://host:8883 for TLS";
      $("mqError").hidden = false;
      toast("Check the broker address", "err");
      return;
    }
    if (S.busy) return;
    S.busy = true;
    toast("Verifying MQTT connection…", "info");
    try {
      const r = await post("/set_mqtt", { broker, user: $("mqUser").value.trim(), pass: $("mqPass").value });
      if (!r.ok) {
        const errObj = await r.json().catch(() => ({}));
        $("mqBroker").classList.add("invalid");
        $("mqError").textContent = errObj.error || "Connection failed";
        $("mqError").hidden = false;
        S.busy = false;
        return;
      }
      const resObj = await r.json().catch(() => ({}));
      if (resObj.reboot === false) {
        closeMqtt();
        toast("No changes", "info");
        S.busy = false;
        return;
      }
    } catch {
      $("mqBroker").classList.add("invalid");
      $("mqError").textContent = "Device connection lost";
      $("mqError").hidden = false;
      S.busy = false;
      return;
    }

    closeMqtt();
    toast("Rebooting — reconnecting…", "info");
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        S.status = await j("/status");
        clearInterval(poll);
        S.busy = false;
        toast("Saved", "ok");
        renderDashboard();
      } catch {
        if (tries > 14) {
          clearInterval(poll);
          S.busy = false;
          toast("Rebooted — reconnect to the device", "info");
        }
      }
    }, 1500);
  });
  $("mqBroker").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; });
  // Typing credentials upgrades the broker scheme to TLS (the bridge refuses plaintext + creds);
  // clearing them again strips the scheme back to bare. Only mutates the broker while editing the
  // credential fields — typing in the broker field itself is left untouched.
  const handleCredsInput = () => {
    const hasCreds = $("mqUser").value.trim().length > 0 || $("mqPass").value.length > 0;
    const broker = $("mqBroker").value.trim();
    if (hasCreds) {
      if (broker) {
        if (!broker.includes("://")) {
          $("mqBroker").value = "mqtts://" + broker;
        } else if (broker.startsWith("mqtt://")) {
          $("mqBroker").value = "mqtts://" + broker.substring(7);
        } else if (broker.startsWith("ws://")) {
          $("mqBroker").value = "wss://" + broker.substring(5);
        }
      }
    } else {
      if (broker.startsWith("mqtts://")) {
        $("mqBroker").value = broker.substring(8);
      } else if (broker.startsWith("wss://")) {
        $("mqBroker").value = broker.substring(6);
      }
    }
  };
  $("mqUser").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; handleCredsInput(); });
  $("mqPass").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; handleCredsInput(); });

  $("slHost").addEventListener("input", () => { $("slHost").classList.remove("invalid"); $("slError").hidden = true; });

  $("slCancel").onclick = closeSyslog;
  $("syslogBackdrop").onclick = closeSyslog;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("syslogModal").hidden) closeSyslog(); });
  $("syslogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = $("slHost").value.trim();
    let host = "";
    let port = 514;
    if (raw) {
      const idx = raw.lastIndexOf(":");
      if (idx !== -1) {
        host = raw.substring(0, idx);
        port = parseInt(raw.substring(idx + 1), 10) || 514;
      } else {
        host = raw;
      }
    }
    if (S.busy) return;
    S.busy = true;
    toast("Saving Syslog settings…", "info");
    try {
      const r = await post("/set_syslog", { host, port });
      if (!r.ok) {
        const errObj = await r.json().catch(() => ({}));
        $("slHost").classList.add("invalid");
        $("slError").textContent = errObj.error || "Invalid host or port";
        $("slError").hidden = false;
        S.busy = false;
        return;
      }
    } catch {
      $("slHost").classList.add("invalid");
      $("slError").textContent = "Device connection lost";
      $("slError").hidden = false;
      S.busy = false;
      return;
    }
    closeSyslog();
    toast("Rebooting — reconnecting…", "info");
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        S.status = await j("/status");
        clearInterval(poll);
        S.busy = false;
        toast("Saved", "ok");
        renderDashboard();
      } catch {
        if (tries > 14) {
          clearInterval(poll);
          S.busy = false;
          toast("Rebooted — reconnect to the device", "info");
        }
      }
    }, 1500);
  });
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
