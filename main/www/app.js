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
  // Labels of value rows whose description accordion is currently expanded. Kept in app state (not
  // the DOM) because #valueGroups is rebuilt on every poll (renderCards) — a purely-DOM open state
  // would collapse ~1×/s. valueGroupsHtml re-emits the `open` class from this set, so an expanded
  // row survives the rebuild; the click handler only toggles the live element (so the CSS slide
  // animates) and updates this set for the next rebuild to honour.
  descOpen: new Set(),
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
  renderRecoveryBanner();
  renderRollbackBanner();
  renderCrashBanner();
  const s = S.status || {}, hp = s.hp || {};
  // Header is a fixed product title ("daikin-altherma-esp32", set in index.html) — the detected
  // model name lives in the Model card (statusCardsHtml), not the header.

  // hero: operation mode + fault state. Prefer the hydronic I/U mode (conv 315 — Stop/Heating/
  // Cooling/DHW/…) over the outdoor unit's Operation Mode: during a DHW run the outdoor unit still
  // reports "Heating" (it IS heating — the tank), but the user-relevant answer is what the water
  // side is doing. Plain first-match sorted the outdoor row first.
  const mode = pickValue(/i\/u operation mode/i) || pickValue(/operation mode|^mode$/i);
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
  renderHeaderIp();
  renderConnections();
  renderLive();
  renderCards();
}
// Header identity line: the IP address (or the mDNS hostname while offline/unknown — whatever the
// browser is actually reached at) shown under the fixed product name. Moved out of the WiFi row
// (connectionsHtml) since it is board identity, not a WiFi *link* fact.
function renderHeaderIp() {
  const w = S.status?.wifi || {};
  $("hdrIp").textContent = w.ip || location.hostname;
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

// ── Recovery (safe) mode banner ──────────────────────────────────────────
// Shown when /status.sys.safe_mode is true — the device crash-looped on a bad config and came up
// minimally (network + web UI + OTA only; the X10A poll engine and MQTT bridge are paused). It is not
// dismissible: it reflects a LIVE state and clears itself once a healthy reboot leaves safe mode. The
// recovery controls (RX/TX pins on the ESP32 card, the WiFi/MQTT modals) stay fully usable underneath.
function renderRecoveryBanner() {
  const el = $("recoveryBanner");
  if (!el) return;
  if (!(S.status?.sys?.safe_mode)) { el.hidden = true; return; }
  if (!el.hidden && el.dataset.on === "1") return;   // already shown — don't thrash the DOM
  el.dataset.on = "1";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">Recovery mode</div>` +
    `<div class="crash-meta">The device restarted too many times and came up in recovery mode. ` +
    `Heat-pump polling and MQTT are paused. Correct the configuration (for example the RX/TX pins on ` +
    `the ESP32 card), then reboot to resume normal operation.</div></div></div>`;
  el.hidden = false;
}

// ── WiFi rollback banner ─────────────────────────────────────────────────
// /status.wifi.rolled_back = the last /set_wifi was UNDONE: the new credentials never got a lease, so
// wifi.cpp restored the previous ones and rebooted. Without this the failure is invisible — the device
// simply reappears on the old SSID and the dashboard looks entirely normal, so the user is left
// believing the change took effect.
//
// This CANNOT be reported from the save flow: wifi.cpp spends 60–180 s deciding
// (logic/wifi_rollback.hpp — an AP that keeps refusing the creds is fast, an absent one gets a grace
// period), far past saveReboot's ~21 s poll, so the verdict almost always lands after the user has
// already reloaded the page. Hence a banner off /status rather than a toast.
//
// Not dismissible: the marker is sticky in NVS until the next /set_wifi retires it, which is exactly
// the "until the user acts on it" lifetime a banner wants.
function renderRollbackBanner() {
  const el = $("rollbackBanner");
  if (!el) return;
  const w = S.status?.wifi || {};
  if (!w.rolled_back) { el.hidden = true; el.dataset.on = ""; return; }
  // Key the re-render on what the banner DRAWS (the fallback SSID), not just on "is it shown" — the
  // same rule renderCrashBanner's `rsig` follows. A boolean key would leave a stale SSID on screen if
  // the name ever changed under a held marker.
  const rsig = `1:${w.ssid || ""}`;
  if (el.dataset.on === rsig && !el.hidden) return;   // already rendered this — don't thrash the DOM
  el.dataset.on = rsig;
  // After the rollback the device is back on the OLD network, so /status.wifi.ssid names exactly the
  // network it fell back to.
  const back = w.ssid ? ` (<b>${esc(w.ssid)}</b>)` : "";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">WiFi change failed — rolled back</div>` +
    `<div class="crash-meta">The new WiFi credentials couldn't connect, so the device restored the ` +
    `previous network${back} and restarted. Open the Connections tile's WiFi row to check the name and password, then ` +
    `try again.</div></div></div>`;
  el.hidden = false;
}

// ── Crash banner ─────────────────────────────────────────────────────────
// Shown when /status.last_crash is set — a fault reset (panic / watchdog / brown-out) or a core dump
// still waiting in flash. Offers the raw dump download (symbolized offline against the matching .elf
// — scripts/decode-coredump.sh) and a copy-paste diagnostics bundle for a bug report. Lives outside
// #valueGroups (rebuilt every poll), so its dismissed state survives re-renders; dismissal is keyed
// to the crash signature, so a NEW crash re-shows the banner.
//
// Those two cases need DIFFERENT wording: last_crash is notable when `fault` OR `coredump` is set,
// so an orphan dump left in flash from an earlier crash raises the banner on every later boot — even
// a clean power-on or a USB re-plug (reset=usb, fault=false). Titling that "Device restarted after a
// crash" reports a crash that did not happen on this boot. Key the title on `fault`, which is the
// only field that says THIS boot was a crash.
function renderCrashBanner() {
  const el = $("crashBanner"), c = S.status?.last_crash;
  if (!c) { el.hidden = true; return; }
  // Two different identities. `sig` is WHICH crash this is — the dismissal key, so pulling the dump
  // doesn't resurrect a banner the user dismissed. `rsig` is what the banner currently DRAWS, which
  // also depends on c.coredump (it gates the download button, and /status now reports it live, so it
  // flips to false the moment the dump is cleared). Keying the re-render on `sig` alone would leave a
  // stale "Download crash report" button pointing at a dump that is gone — a 404 — until a reload.
  // They must stay SEPARATE attributes: the dismiss click handler reads dataset.sig, so folding the
  // dump state into it would compare "usb::true" against sig "usb::" here and silently break Dismiss.
  const sig  = `${c.reason}:${c.pc || ""}:${c.task || ""}`;
  const rsig = `${sig}:${!!c.coredump}`;
  if (S.crashDismissed === sig) { el.hidden = true; return; }
  if (el.dataset.rsig === rsig && !el.hidden) return;   // already rendered this — don't thrash the DOM
  el.dataset.sig  = sig;    // dismissal key (read by the Dismiss handler)
  el.dataset.rsig = rsig;   // render key

  const s = S.status || {}, bt = Array.isArray(c.backtrace) ? c.backtrace : [];
  const bits = [`Reset: <b>${esc(c.reason)}</b>`];
  if (c.task) bits.push(`task <span class="mono">${esc(c.task)}</span>`);
  if (s.version) bits.push(`fw v${esc(s.version)}`);
  if (s.app_elf_sha256) bits.push(`elf <span class="mono">${esc(s.app_elf_sha256.slice(0, 12))}…</span>`);
  const btHtml = bt.length
    ? `<div class="crash-bt mono">${esc(bt.join(" "))}${c.corrupted ? " (corrupted)" : ""}</div>` : "";
  const dl = c.coredump
    ? `<a class="btn secondary sm" href="/coredump" download="coredump.bin">Download crash report</a>` : "";
  const title = c.fault
    ? "Device restarted after a crash"
    : "Crash report waiting from an earlier restart";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${title}</div>` +
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
// Dashboard cards: the board (ESP32) + detected unit (Model) first, then the heat-pump value groups —
// all one continuous card grid, each block styled like OPERATION. WiFi/MQTT/Syslog/NTP render
// separately in the full-width Connections tile (#connTile, see connectionsHtml/renderConnections).
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

// Human-readable uptime from a seconds count (/status.uptime_s).
function fmtUptime(s) {
  if (s == null) return "—";
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
// Compact byte figure for the heap row (/status.sys.free_heap), e.g. 148512 -> "145 KB".
function fmtBytes(b) {
  if (b == null) return "—";
  return `${Math.round(b / 1024)} KB`;
}
// Reset reasons (logic/reset_reason.hpp slugs) that mean the device FAULTED rather than rebooted
// cleanly — the "Last reset" row is warn-coloured for these, neutral otherwise. Mirrors the
// crash_reason_is_fault() set in logic/crashinfo.hpp (panic / any watchdog / brown-out / power
// glitch / CPU lockup); a clean poweron / software reboot / deep-sleep wake is neutral.
const FAULT_RESETS = ["panic", "int_wdt", "task_wdt", "wdt", "brownout", "pwr_glitch", "cpu_lockup"];

// RX/TX pin dropdown row — shown only when auto-detection hasn't locked a working pin pair, so the
// user picks from the chip's safe GPIOs (logic/board_pins.hpp → /status.pins_avail).
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
  const s = S.status || {}, hp = s.hp || {}, sys = s.sys || {};
  const proto = hp.proto === "I" ? "X10A-I" : hp.proto === "S" ? "X10A-S" : "—";
  const pinsLocked = hp.connected || (typeof hp.last_ok_s === "number" && hp.last_ok_s >= 0 && hp.last_ok_s <= 30);
  const avail = Array.isArray(s.pins_avail) ? s.pins_avail : [];
  const pinRow = (label, id, val, other) => pinsLocked
    ? vrow(label, val != null ? String(val) : "—", { cls: "mono num" })
    : pinSelRow(label, id, val, avail.filter((p) => p !== other));
  // Last reset is warn-coloured on a fault reason (panic / watchdog / brown-out …) and neutral on a
  // clean boot; Free heap surfaces the current heap so a leak is visible without a serial console.
  const resetRow = sys.reset_reason
    ? vrow("Last reset", sys.reset_reason, { cls: FAULT_RESETS.includes(sys.reset_reason) ? "warn" : "" })
    : "";
  const heapRow = sys.free_heap != null ? vrow("Free heap", fmtBytes(sys.free_heap)) : "";
  const rows =
    vrow("Chip", s.platform || "—", { cls: "mono" }) +
    fwRow(s.version || "?") +
    vrow("Uptime", fmtUptime(s.uptime_s)) +
    resetRow +
    heapRow +
    vrow("Heat-pump link", hp.connected ? "Online" : "Offline", { cls: hp.connected ? "ok" : "err" }) +
    vrow("Protocol", hp.connected ? proto : "—") +
    pinRow("RX pin", "e32Rx", hp.rx, hp.tx) +
    pinRow("TX pin", "e32Tx", hp.tx, hp.rx);
  return vcard("ESP32", rows);
}

// ESP32 · Model status cards, from /status (board facts + detected unit). WiFi/MQTT/Syslog/NTP moved
// out to the full-width Connections tile (connectionsHtml) — see renderConnections().
function statusCardsHtml() {
  const hp = S.status?.hp || {}, d = S.status?.detect || {};
  // Outdoor unit as a full-width heading — model names are long and don't fit a label→value row.
  // The X10A link + protocol live on the ESP32 card (they're about the board's bus), not here.
  // Identity is bus-derived: the model name degrades to the brand offline (hpModelName), and capacity
  // (from the cached fingerprint) is shown ONLY while connected — never a stale value read as live.
  // No "Detection: auto/manual" row: detection is fully automatic, an internal detail.
  let model = `<div class="vname">${esc(hpModelName())}</div>`;
  if (hp.connected && d.capacity_kw != null) model += vrow("Capacity", String(d.capacity_kw), { unit: "kW" });

  // Model identity is only meaningful while the bus answers — hide the card entirely when the
  // heat-pump link is down instead of naming a unit (or showing a stale capacity) that isn't live.
  return esp32CardHtml() + (hp.connected ? vcard("Model", model) : "");
}

// ── Connections tile (WiFi · MQTT · Syslog · NTP, full width under the hero) ──────────────────
// One tappable row per link: label, colour-coded value (green connected/synced, yellow reconnecting/
// syncing, red down — the same ok/warn/err semantics the rest of the dashboard uses), a trailing
// pencil that opens that link's existing edit modal (§5.1 in docs/DESIGN.md). MAC/BSSID are dropped
// entirely (bus-level detail nobody edits from here) and the IP address moved to the header
// (renderHeaderIp) — it is board identity, not a per-row WiFi fact.
//
// The row itself conveys state by colour alone (the value IS the address/name, just tinted) — DESIGN.md
// §9's "status never conveyed by colour alone" would otherwise be broken for colourblind users and
// screen readers, so `state` (a plain-text status word, never shown visually) goes into the row's
// aria-label instead of the generic "Edit X" every other edit affordance in this app uses.
function connRow(label, valueHtml, cls, edit, state) {
  return `<button class="conn-row" type="button" data-edit="${esc(edit)}" aria-label="${esc(label)}: ${esc(state)}. Tap to edit.">` +
    `<span class="conn-label">${esc(label)}</span>` +
    `<span class="conn-val ${cls || ""}">${valueHtml}</span>` +
    `${editIcon}</button>`;
}
function connectionsHtml() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, sy = S.status?.syslog || {}, nt = S.status?.ntp || {};

  // WiFi has no "connecting" state in /status (just connected: true/false), so it is a two-state
  // ok/err row — signal bars keep their own strength-based tone regardless.
  let wifiVal, wifiCls, wifiState;
  if (w.connected && (w.rssi != null || w.ssid)) {
    wifiVal = (w.rssi != null ? signalBars(w.rssi) : "") +
      (w.rssi != null ? ` <span class="conn-dbm">${w.rssi} dBm</span>` : "") +
      (w.ssid ? ` <span class="conn-name">${esc(w.ssid)}</span>` : "");
    wifiCls = "ok"; wifiState = "Connected" + (w.ssid ? ` to ${w.ssid}` : "");
  } else {
    wifiVal = "Offline";
    wifiCls = "err"; wifiState = "Offline";
  }
  const wifiRow = connRow((w.std || "Wi-Fi").toUpperCase(), wifiVal, wifiCls, "wifi", wifiState);

  let mqttVal, mqttCls, mqttState;
  if (!m.configured) {
    mqttVal = "Disabled"; mqttCls = ""; mqttState = "Disabled";
  } else {
    mqttCls = m.connected ? "ok" : m.error ? "err" : "warn";
    mqttState = m.connected ? "Connected" : m.error ? `Error: ${m.error}` : "Connecting…";
    // No TLS padlock marker: an mqtts:// broker already carries its own scheme in the URL, so the
    // icon only restated what the string says. A schemeless/mqtt:// broker is plaintext and shows none.
    mqttVal = esc(m.broker || "—");
  }
  const mqttRow = connRow("MQTT", mqttVal, mqttCls, "mqtt", mqttState);

  let syVal, syCls, syState;
  if (!sy.configured) {
    syVal = "Disabled"; syCls = ""; syState = "Disabled";
  } else {
    // Delivery is gated on DNS only (resolved); reachability is an advisory ping hint — green once
    // resolving, yellow (still forwarding) when the host doesn't answer the probe or resolution is
    // still pending, red on a DNS error.
    syCls = sy.error ? "err" : sy.resolved ? (sy.reachable ? "ok" : "warn") : "warn";
    syState = sy.error ? sy.error : sy.resolved ? (sy.reachable ? "Enabled" : "Enabled, host not answering ping") : "Resolving…";
    syVal = esc(sy.host ? `${sy.host}:${sy.port || 514}` : "—");
  }
  const syslogRow = connRow("Syslog", syVal, syCls, "syslog", syState);

  // NTP has no "disabled" or error state (unlike MQTT/Syslog) — it always has a server, so it is a
  // two-state ok/warn row keyed on whether the first sync of this boot has landed.
  const ntpRow = connRow("NTP", esc(nt.server || "—"), nt.synced ? "ok" : "warn", "ntp", nt.synced ? "Synced" : "Syncing…");

  return `<div class="section-label">Connections</div>` + wifiRow + mqttRow + syslogRow + ntpRow;
}
function renderConnections() {
  $("connTile").innerHTML = connectionsHtml();
}
// ── Value descriptions (tap a value row → a plain-language explainer slides down) ─────────────
// Each heat-pump reading gets a short "what is this / what's normal" note, keyed to the value LABEL
// by a first-match-wins regex — the same pattern-over-label technique pickValue()/groupOf()/vLwt use,
// so one entry covers every profile's spelling of a concept (there are ~200 distinct labels but far
// fewer physical quantities). English only, matching the fixed English labels and the §1 design
// contract (there is no language selector). ORDER MATTERS: put specific/compound labels before the
// general ones they contain (e.g. "after BUH" before plain "leaving water", BUH/capacity before the
// bare "capacity" catch). A row whose label matches nothing here stays a plain, non-expandable row.
// `normal` is optional guidance on typical vs worth-a-look values — deliberately hedged; the exact
// figures are model- and install-specific.
const DESCRIPTIONS = [
  // ── Domestic hot water ──
  { re: /dhw setpoint|dhw set ?point/i,
    what: "Target temperature for the hot-water tank. The unit runs DHW mode until the tank sensor reaches it, then stops.",
    normal: "usually 45–55 °C. Higher leans on the electric backup heater and costs more; a weekly ≥60 °C cycle is the normal anti-legionella boost." },
  { re: /2nd domestic hot water/i,
    what: "A second temperature sensor in the hot-water tank (used on tanks with two sensors, e.g. top and bottom)." },
  { re: /dhw tank temp|dhw tank/i,
    what: "The water temperature actually measured inside the hot-water tank (sensor R5T).",
    normal: "sits below the DHW setpoint and climbs during a DHW cycle. Staying far below setpoint with the tank idle means it's simply been used up, or a sensor/heating fault." },
  { re: /powerful dhw/i,
    what: "A one-off boost that heats the tank to the setpoint as fast as possible, calling in the backup heater if needed.",
    normal: "OFF in day-to-day use; ON only while you've triggered a manual boost." },
  { re: /tank preheat/i,
    what: "The tank is being warmed ahead of an expected draw (from the schedule or weather forecast) so hot water is ready in time.",
    normal: "briefly ON around scheduled/anticipated demand, OFF otherwise." },
  { re: /reheat on/i,
    what: "The tank is being topped back up to its comfort temperature between scheduled heating slots.",
    normal: "ON in short bursts to hold the tank warm; OFF most of the time." },
  { re: /storage (eco|comfort)/i,
    what: "Which stored-hot-water target is active: Comfort keeps the tank fuller/hotter, ECO holds a lower reserve to save energy." },
  { re: /boiler dhw demand/i,
    what: "On a hybrid (heat-pump + gas boiler) system: the boiler has been asked to make the hot water instead of the heat pump.",
    normal: "OFF on a heat-pump-only system; on a hybrid it comes ON when the boiler is cheaper/faster than the heat pump for DHW." },

  // ── Valves ──
  { re: /3.?way valve/i,
    what: "The diverter valve that sends heated water either to the DHW tank (ON = DHW) or to the space-heating circuit (OFF = heating). It can only feed one at a time.",
    normal: "ON only during a hot-water cycle; OFF (feeding heating) the rest of the time." },
  { re: /2.?way valve/i,
    what: "Selects the water path for the current mode — ON in heating, OFF in cooling (per the label)." },
  { re: /mix valve position|bizone kit mix valve/i,
    what: "Opening of the bizone mixing valve, blending hot flow with cooler return to hold a lower temperature for a second (e.g. underfloor) zone.",
    normal: "modulates between fully closed and fully open to hold that zone's target." },

  // ── Leaving / return / mixed water ──
  { re: /(leaving water|lw) set ?point/i,
    what: "The target flow (leaving-water) temperature the controller is aiming for — usually set automatically by weather compensation, warmer when it's colder outside.",
    normal: "tracks the outdoor temperature: higher on cold days, lower on mild ones." },
  { re: /mixed (leaving|water)/i,
    what: "Blended flow temperature of a mixed heating zone (after its mixing valve) — typically a cooler underfloor loop fed off a hotter primary circuit." },
  { re: /after buh|outlet water buh|after buffer|tvbh/i,
    what: "Water temperature after the electric backup heater (sensor R2T) — the temperature that actually reaches your radiators/underfloor.",
    normal: "equal to the before-BUH temperature when the backup heater is off (the usual case); higher only while the BUH is firing." },
  { re: /before buh|after phe|outlet water heat exch|leaving water.*\(?r1t\)?|tv inflow|outlet water heat exchanger/i,
    what: "Water temperature leaving the heat pump's own heat exchanger, before the backup heater (sensor R1T) — the true heat-pump output temperature and the one used for ΔT / heat-output / COP.",
    normal: "space heating ~30–45 °C (underfloor lower, radiators higher); up to ~55 °C on a DHW run. Much higher than the target usually means the backup heater is contributing." },
  { re: /inlet water|return water|tr return/i,
    what: "Water returning from the house back into the unit (sensor R4T). Leaving-water minus this is the ΔT across the system.",
    normal: "a few degrees below the leaving-water temperature; a healthy heating ΔT is around 5 K." },

  // ── Flow / pressure / pump ──
  { re: /flow (sensor|rate)|flow rate/i,
    what: "How fast water is circulating through the heating/DHW circuit.",
    normal: "typically ~10–30 l/min depending on unit size and pump speed. Too low can trip a flow fault and stop the compressor — suspect air, a closed valve or a dirty filter." },
  { re: /water pressure/i,
    what: "Water pressure in the sealed heating circuit.",
    normal: "roughly 1.0–2.0 bar when cold. Below ~0.5 bar needs topping up; a persistent low reading can stop the pump." },
  { re: /water pump signal/i,
    what: "The speed command sent to the circulation pump. Note it is inverted — 0 means full speed, 100 means stopped (per the label).",
    normal: "a low number (fast pump) while heating or making DHW; 100 (stopped) when idle." },
  { re: /water pump operation|circulation pump|solar pump|main pump|add pump|pump speed/i,
    what: "The circulation pump that moves water between the unit and the tank/emitters — whether it's running (or how hard, for a speed reading).",
    normal: "running while heating, cooling or making hot water; may keep going briefly afterwards or periodically to anti-seize." },
  { re: /water flow switch/i,
    what: "A safety switch that confirms water is genuinely flowing before the compressor or backup heater are allowed to run — protecting the heat exchanger from running dry.",
    normal: "ON (flow proven) whenever the pump is running." },

  // ── Operation / mode / fault ──
  { re: /i\/u operation mode/i,
    what: "What the water (indoor) side is doing right now: Stop, Heating, Cooling, Domestic Hot Water, or a heating+DHW combination.",
    normal: "reflects the current job. During a hot-water cycle it reads DHW even though the outdoor unit still shows Heating." },
  { re: /operation mode|operation \/ fault|^operation$/i,
    what: "The outdoor unit's thermodynamic mode (Heating, Cooling, …). While it heats the tank it still reports Heating — it is heating, just the water in the tank rather than the house." },
  { re: /defrost/i,
    what: "The unit is melting frost off the outdoor coil by briefly running its cycle in reverse. Heating output pauses and steam may rise from the outdoor unit.",
    normal: "normal and self-clearing in cold, damp weather; a few minutes every so often. Constant defrosting suggests low refrigerant or poor airflow." },
  { re: /error type/i,
    what: "The severity class of any active fault: Normal, Error, Warning or Caution.",
    normal: "Normal. Anything else points to an active fault or advisory — check the fault code." },
  { re: /error code|fault code/i,
    what: "The Daikin fault code (e.g. U4, H3). Blank or 0 means no fault. If the unit stops, note this code — it identifies the problem for a service tech.",
    normal: "blank / no fault. A code present with the unit stopped means it has shut down on that fault." },
  { re: /emergency/i,
    what: "Emergency operation: the system is running in a fallback mode (often backup-heater only) after a fault, to keep some heat/hot water until it's serviced." },
  { re: /alarm output/i,
    what: "The unit's alarm relay — switched ON to signal a fault to any external alarm/monitoring wired to it." },

  // ── Room / thermostat ──
  { re: /thermostat/i,
    what: "Whether the room or zone is currently calling for heat. ON = there is demand and the unit may run; OFF = the room is up to temperature.",
    normal: "cycles ON and OFF as the room drifts around its target." },
  { re: /space heating operation|space h operation/i,
    what: "Whether space heating (as opposed to hot-water production) is currently active or being called for." },
  { re: /rt set ?point/i,
    what: "The target room temperature you've set for the zone the unit's own room sensor controls." },
  { re: /\brt temp|indoor ambient|ext\. indoor ambient/i,   // \b so "po(rt temp)erature" doesn't hit this
    what: "The room temperature measured by the unit's built-in or wired room sensor.",
    normal: "sits near the room setpoint once the zone is satisfied." },

  // ── Outdoor / refrigerant circuit ──
  { re: /outdoor air|outdoor ambient|r1t-outdoor|^outdoor/i,
    what: "The outside air temperature measured at the unit — the source it draws heat from.",
    normal: "the colder it is outside, the lower the efficiency (COP) and the more the backup heater may help out." },
  { re: /water heat exchanger (inlet|outlet)/i,
    what: "Raw water temperatures at the inlet/outlet of the plate heat exchanger that transfers heat between the refrigerant and the water." },
  { re: /o\/u heat exch|outdoor heat exchanger|heat exchanger mid-?temp|heat exch\. (mid-?)?temp/i,
    what: "Temperature of the outdoor coil, where refrigerant boils off (heating) or condenses (cooling) by exchanging heat with the outside air.",
    normal: "near or below freezing in cold-weather heating — that frost build-up is what triggers the periodic defrost." },
  { re: /discharge pipe|compressor outlet|inv discharge/i,
    what: "Temperature of the hot compressed refrigerant gas leaving the compressor.",
    normal: "the hottest point in the circuit, well above the condensing temperature. A very high value makes the unit throttle back to protect the compressor." },
  { re: /suction (pipe )?temp|suction temp/i,
    what: "Temperature of the cool low-pressure refrigerant gas returning to the compressor." },
  { re: /liquid (pipe )?temp|liquid temperature|refrig\. temp\. liquid/i,
    what: "Refrigerant temperature on the liquid line between the heat exchangers." },
  { re: /refrig\. temp\. evap/i,
    what: "Refrigerant temperature entering/leaving the evaporator (the heat exchanger absorbing heat)." },
  { re: /injection tube|2 phase thermistor|r4t-deicer/i,
    what: "Temperature of a vapour/liquid-injection or de-icer sensor used by the compressor's internal control." },
  { re: /(high|low) pressure ?\(?(sat|t)/i,
    what: "The high/low refrigerant pressure expressed as a saturation temperature — the temperature the refrigerant boils/condenses at for that pressure. Easier to sanity-check than raw bar." },
  { re: /(high|low) pressure/i,
    what: "Refrigerant pressure on the high (compressor discharge) or low (compressor suction) side. The gap between them is what the compressor works against, and it drives efficiency.",
    normal: "varies with outdoor temperature and load; steady during stable running." },
  { re: /compressor speed|inv frequency|frequency \(rps\)/i,
    what: "How fast the inverter-driven compressor is spinning, in revolutions per second. This is the unit's main output control.",
    normal: "modulates from 0 up to ~100+ rps to match demand — higher when there's more to heat, 0 when idle." },
  { re: /expansion valve/i,
    what: "Opening of the electronic expansion valve, in steps/pulses. It meters exactly how much refrigerant flows into the evaporator.",
    normal: "continuously adjusts while running to keep the refrigerant cycle in its sweet spot." },
  { re: /fan\d? fin temp|fan \d fin/i,
    what: "Temperature of the outdoor fan motor's driver electronics." },
  { re: /^fan ?\d|fan \d \(/i,
    what: "Outdoor fan speed, as a step or in rpm. The fan pulls outside air across the coil.",
    normal: "ramps up with compressor load; drops to 0 when idle and during parts of a defrost." },
  { re: /target (evap|cond)/i,
    what: "An internal control target the unit is steering the refrigerant circuit toward (target evaporating/condensing temperature) — not a value you set." },
  { re: /target (discharge|port)/i,
    what: "An internal control target for the compressor discharge/port temperature — used by the unit's own protection logic." },
  { re: /target delta t/i,
    what: "The target temperature difference (ΔT) between leaving and returning water the controller aims to maintain across the circuit.",
    normal: "commonly around 5 K for heating; the pump speed is trimmed to hold it." },
  { re: /refrigerant type/i,
    what: "The refrigerant this unit is charged with (e.g. R32 or R410A). It sets the pressure↔temperature curve used for the saturation-temperature readings." },
  { re: /compressor port/i,
    what: "Temperature measured at a compressor port — part of the unit's internal protection monitoring." },
  { re: /refrigerant pressure|pressure/i,
    what: "A refrigerant-circuit pressure reading from the outdoor unit." },

  // ── Electrical ──
  { re: /ct sensor|current measured by ct/i,
    what: "Mains current on one phase (L1/L2/L3), measured by a clamp (CT) sensor. Combined, these estimate the electrical power the unit is drawing.",
    normal: "rises with compressor and backup-heater load; near zero when idle." },
  { re: /inv (primary|secondary|compressor) current|inv .*current \(a\)/i,
    what: "Current drawn by the compressor inverter — a proxy for how hard the compressor is working." },
  { re: /inv fin temp|fin temp|heat sink temp/i,
    what: "Temperature of the inverter/power-electronics heatsink in the outdoor unit.",
    normal: "warm under load; a very high value makes the unit throttle to protect the electronics." },

  // ── Backup / booster heater ──
  { re: /buh output capacity/i,
    what: "Which stage(s) of the electric backup heater are engaged, as a capacity step.",
    normal: "0 when the heat pump covers the load alone; higher only in very cold weather or a fast DHW boost." },
  { re: /buh step/i,
    what: "An electric backup-heater stage. These use resistive electricity (efficiency ≈ 1, unlike the heat pump), so they add heat when the heat pump can't keep up.",
    normal: "OFF most of the time. Frequent use noticeably raises running cost — expected only in a cold snap or during a boost." },
  { re: /\bbsh\b|thermal protector/i,
    what: "The booster/backup heater for the hot-water tank, or its thermal cut-out protection.",
    normal: "the thermal protector should read normal/closed; it trips only on an over-temperature fault." },
  { re: /freeze protection/i,
    what: "Anti-freeze protection: the unit runs the pump (and if needed the heater) to stop water in the pipes freezing while it's otherwise idle in the cold.",
    normal: "ON only in freezing conditions when the system is idle." },

  // ── Geothermal / brine ──
  { re: /brine (inlet|outlet|temp|pump)|entering brine|leaving brine/i,
    what: "Ground-loop (brine) circuit reading on a geothermal unit — the fluid that carries heat to/from the ground, and its pump.",
    normal: "brine temperatures stay in a narrow band set by the ground; a slow seasonal drift is normal, a sharp drop is not." },

  // ── Hybrid / second source / smart grid ──
  { re: /hybrid (op|heating)/i,
    what: "On a hybrid heat-pump + boiler system: which source the controller has chosen (heat pump only, hybrid, or boiler only) and its target." },
  { re: /bivalent|boiler operation|boiler heating target/i,
    what: "A second heat source (typically a boiler) being called in a bivalent/hybrid setup when the heat pump alone isn't enough or isn't the cheaper option." },
  { re: /be_cop|^cop\b/i,
    what: "The unit's own live estimate of its coefficient of performance — heat delivered ÷ electricity used. Higher is more efficient (3 means 3 kW of heat per 1 kW of power).",
    normal: "typically ~3–5 in mild heating; lower in hard frost or during DHW, and drops toward 1 whenever the backup heater runs." },
  { re: /benefit kwh|smartgrid|smart grid|solar input/i,
    what: "An external utility/smart-grid or solar signal input — e.g. a cheap-tariff or surplus-PV window telling the unit it's a good time to store extra heat.",
    normal: "ON only while that external signal is active." },

  // ── Capacity / identity (put after BUH-capacity above) ──
  { re: /capacity/i,
    what: "The nominal rated capacity/size class of the unit (indoor or outdoor), in kW or as a code. It's a fixed property of the model, not a live measurement." },
  { re: /silent mode|low noise/i,
    what: "Low-noise / quiet mode: caps fan and compressor speed to run more quietly, at the cost of some heating output.",
    normal: "ON during any scheduled quiet hours you've set; OFF otherwise." },
];

// First matching description for a value label, or null (→ a plain, non-expandable row).
function descFor(label) {
  const l = label || "";
  for (const d of DESCRIPTIONS) if (d.re.test(l)) return d;
  return null;
}
// Description body: the plain "what is it" sentence, plus an optional "Normal:" note in stronger ink.
// All text is our own static English (labels come from the firmware's own def/ tables), but escape
// anyway — cheap and keeps the one-encoder rule.
function descBodyHtml(d) {
  let h = esc(d.what);
  if (d.normal) h += ` <span class="vdesc-n">Normal:</span> ${esc(d.normal)}`;
  return h;
}
const chevIcon = `<svg class="vrow-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

// One value row. If a description matches the label, render an expandable accordion (a <button>
// header + a collapsible panel that slides down beneath it); otherwise a plain, unchanged row.
// The open state is read from S.descOpen so it survives the per-poll rebuild of #valueGroups.
function vDescRow(v) {
  const label = v.label || "";
  const cls = v.state || v.class || "";
  const val = esc(v.value == null ? "—" : String(v.value)) +
    (v.unit ? `<span class="vrow-unit">${esc(v.unit)}</span>` : "");
  const d = descFor(label);
  if (!d) {
    return `<div class="vrow"><span class="vrow-label">${esc(label)}</span>` +
      `<span class="vrow-val ${cls}">${val}</span></div>`;
  }
  const open = S.descOpen.has(label);
  return `<div class="vitem${open ? " open" : ""}">` +
    `<button class="vrow vrow-desc" type="button" data-desc="${esc(label)}" aria-expanded="${open ? "true" : "false"}">` +
    `<span class="vrow-label">${esc(label)}</span>` +
    `<span class="vrow-end"><span class="vrow-val ${cls}">${val}</span>${chevIcon}</span>` +
    `</button>` +
    `<div class="vdesc"><div class="vdesc-inner"><div class="vdesc-body">${descBodyHtml(d)}</div></div></div>` +
    `</div>`;
}
// Toggle a value row's description accordion. Only the LIVE element is flipped here (so the CSS
// height transition actually runs); S.descOpen carries the state into the next per-poll rebuild,
// which re-emits the row already-open (no re-animation). A <button> header means Enter/Space work
// for free — no extra key handling needed.
function toggleDesc(btn) {
  const item = btn.closest(".vitem");
  if (!item) return;
  const label = btn.dataset.desc || "";
  const open = !item.classList.contains("open");
  item.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) S.descOpen.add(label); else S.descOpen.delete(label);
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
  const rowsOf = (rows) => rows.map((v) => vDescRow(v)).join("");
  let html = ""; const done = new Set();
  const emit = (name, rows) => { html += vcard(grouped ? name : "Values", rowsOf(rows)); };
  for (const name of order) if (buckets.has(name)) { emit(name, buckets.get(name)); done.add(name); }
  for (const [name, rows] of buckets) if (!done.has(name)) emit(name, rows); // firmware-supplied custom groups
  return html;
}

// ── Live system section (hero chips/figures, schematic, KPI tiles, trend) ────────────────────
// Everything here reads /values through label patterns — the same technique pickValue() already
// uses — so the section degrades per model: a value the profile doesn't carry renders "—", and a
// missing tank/room sensor hides that schematic part entirely (.no-dhw/.no-room). The DOM is
// static (index.html) and updated in place: an innerHTML rebuild like #valueGroups' would restart
// the CSS flow animations on every poll.
const vRow = (re) => (S._values || []).find((x) => re.test(x.label || "") && x.value != null);
const vNum = (re) => { const r = vRow(re); if (!r) return null; const n = parseFloat(r.value); return Number.isFinite(n) ? n : null; };
// Bit-flag values arrive as "ON"/"OFF" text (logic/convert.hpp conv 300-307). null = row absent.
const vOn = (re) => { const r = vRow(re); return r ? /^on$/i.test(String(r.value).trim()) : null; };

// Leaving-water MEASUREMENT for ΔT / heat output / COP — NOT a plain vNum, because a measurement
// regex that can also match a setpoint row poisons all three (issue #121, the #35-#39 failure
// shape). Host-tested twin: main/logic/lwt_select.hpp + test/test_logic.cpp test_lwt_select() —
// keep the token lists below byte-for-byte in sync (lowercase substring, no regex).
//   Tier 1 = the pre-BUH heat-exchanger outlet (R1T) under any label form — "before BUH (R1T)",
//     "after PHE (R1T)", "Outlet Water Heat Exch. Temp. (R1T)", "[HPSU] Tv inflow Temp (R1T)";
//     keying on the (R1T) tag (not a "heat exch" keyword, which also hits outdoor/refrigerant rows)
//     lights up the alias-labelled profiles that "leaving water.*before" alone missed.
//   Tier 2 = any leaving/outlet-water measurement that is NOT a setpoint / mixed-zone / post-BUH.
const lwtWater = (l) => l.includes("leaving water") || l.includes("outlet water") || l.includes("inflow");
const lwtReject = (l) => l.includes("setpoint") || l.includes("mixed") || l.includes("r2t") || l.includes("after buh") || l.includes("after buffer");
const vLwt = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l) && l.includes("r1t"); });
  if (!r) r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l); });
  if (!r) return null;
  const n = parseFloat(r.value);
  return Number.isFinite(n) ? n : null;
};
const fmt1 = (n) => (n == null ? "—" : n.toFixed(1));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const setTxt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };

// Nominal compressor top speed for the modulation bar — a display scale, not a datum (the real
// maximum is model-specific and not on the bus).
const RPS_MAX = 120;

function liveData() {
  // ΔT is measured across the PHE: leaving water BEFORE the backup heater minus inlet water — with
  // the BUH off (the normal case) before/after are equal, and the derived heat output must not
  // credit the resistive heater to the heat pump.
  const lwt = vLwt();   // pre-BUH R1T measurement, never a setpoint (see vLwt / logic/lwt_select.hpp)
  const ret = vNum(/inlet water/i);
  const cts = (S._values || []).filter((x) => /current measured by ct/i.test(x.label || "") && x.value != null);
  const ct = cts.reduce((a, x) => a + (parseFloat(x.value) || 0), 0);
  const inv = vNum(/inv primary current/i);
  const d = {
    lwt, ret,
    dt: lwt != null && ret != null ? lwt - ret : null,
    out: vNum(/outdoor air/i),
    flow: vNum(/flow sensor/i),
    wp: vNum(/^water pressure$/i),
    rps: vNum(/inv frequency/i),
    hp: vNum(/^high pressure$/i),
    lp: vNum(/^low pressure$/i),
    rp: vNum(/^refrigerant pressure sensor$/i),
    disch: vNum(/discharge pipe temp/i),
    eev: vNum(/expansion valve ?1/i),
    tank: vNum(/dhw tank temp/i),
    tankSet: vNum(/dhw setpoint/i),
    room: vNum(/^indoor ambient temp/i),
    roomSet: vNum(/^rt setpoint/i),
    dtSet: vNum(/target delta t heating/i),
    pumpSig: vNum(/water pump signal/i),
    pumpOn: vOn(/water pump operation/i),
    valveDhw: vOn(/3.?way valve/i),          // label documents On:DHW / Off:Space
    buh1: vOn(/buh step ?1/i),
    buh2: vOn(/buh step ?2/i),
    defrost: vOn(/defrost operation/i),
    thermo: vOn(/thermostat on/i),
    quiet: vOn(/low noise control|silent mode/i),
  };
  // Pump % — the wire value is inverted ("Water pump signal (0:max-100:stop)").
  d.pump = d.pumpSig == null ? null : Math.min(100, Math.max(0, 100 - d.pumpSig));
  // Circuit refrigerant pressure for the schematic's high-side badge. The outdoor unit's own High
  // Pressure transducer (reg 0x20) reads 0 bar while the compressor is off — but a sealed R32 circuit
  // is never at 0 bar, so "0.0 bar" paints a live-looking fault on an idle unit. Fall back to the
  // always-live Refrigerant pressure sensor (reg 0x62/15), which reports the real equalised system
  // pressure at rest (~14 bar for R32 near 20 °C). When the compressor runs, High Pressure is the true
  // discharge pressure and wins. Neither present (17 profiles carry no pressure row) → null → "—".
  d.circP = d.hp != null && d.hp > 0 ? d.hp : d.rp;
  // Derived figures, marked "est." in the UI — the bus has no energy registers. Thermal output from
  // flow × ΔT (water ≈ 4.186 kJ/kg·K); electrical from the CT phase currents at an assumed 230 V,
  // falling back to the inverter primary current when the profile has no CT rows.
  // SIGNED on purpose: during a defrost the unit pulls heat back OUT of the heating water, so ΔT is
  // genuinely negative. Clamping that to 0 published a measured-looking "0.0 kW" while ~5 kW flowed
  // the other way — the same shape as the #37 sentinel-as-reading bug. Show what is actually there.
  d.pth = d.flow != null && d.dt != null ? d.flow / 60 * 4.186 * d.dt : null;
  d.pel = cts.length && ct > 0 ? ct * 230 / 1000 : inv != null ? inv * 230 / 1000 : null;
  d.pelSrc = cts.length && ct > 0 ? "CT" : "INV";
  const running = (d.rps ?? 0) > 5 && (d.dt ?? 0) > 0.5;
  d.cop = running && d.pth != null && d.pel != null && d.pel > 0.2 ? d.pth / d.pel : null;
  return d;
}

const chipHtml = (txt, cls) => `<span class="chip${cls ? " " + cls : ""}">${txt}</span>`;

function renderLive() {
  const live = !!(S.status?.hp?.connected) && (S._values || []).length > 0;
  $("hpLive").hidden = !live;
  $("heroChips").hidden = !live;
  $("heroFigs").hidden = !live;
  if (!live) return;
  const d = liveData();

  // Hero figures + chips (chips only for states this profile actually reports; text is static
  // English — no user-controlled strings, so no esc() needed)
  setTxt("hfLwt", fmt1(d.lwt));
  setTxt("hfOut", fmt1(d.out));
  $("hfPthFig").hidden = d.pth == null;
  setTxt("hfPth", fmt1(d.pth));
  const pumping = d.pumpOn ?? (d.flow != null ? d.flow > 1 : null);
  const chips = [];
  if (d.thermo != null) chips.push(chipHtml(d.thermo ? "Thermostat ON" : "Thermostat off", d.thermo ? "on" : ""));
  if (pumping != null) chips.push(chipHtml(pumping ? "Pump ON" : "Pump off", pumping ? "on" : ""));
  if (d.buh1 != null || d.buh2 != null) {
    const on = !!(d.buh1 || d.buh2);
    chips.push(chipHtml(on ? (d.buh2 ? "BUH step 2" : "BUH step 1") : "BUH off", on ? "hot" : ""));
  }
  if (d.defrost) chips.push(chipHtml("Defrost", "ice"));
  if (d.quiet) chips.push(chipHtml("Quiet", ""));
  $("heroChips").innerHTML = chips.join("");

  // Schematic badges
  setTxt("svOut", fmt1(d.out)); setTxt("svRps", fmt0(d.rps));
  // High-side badge shows the circuit pressure (real refrigerant sensor when the compressor's own HP
  // transducer is idle-zero — see d.circP). Low/suction side has no equivalent at-rest gauge, so show
  // "—" rather than a misleading 0.0 bar when the compressor is off.
  setTxt("svHp", fmt1(d.circP)); setTxt("svLp", d.lp != null && d.lp > 0 ? fmt1(d.lp) : "—");
  setTxt("svDisch", fmt0(d.disch)); setTxt("svEev", fmt0(d.eev));
  setTxt("svLwt", fmt1(d.lwt)); setTxt("svRwt", fmt1(d.ret));
  setTxt("svDt", fmt1(d.dt)); setTxt("svFlow", fmt1(d.flow));
  setTxt("svWp", fmt1(d.wp)); setTxt("svPump", fmt0(d.pump));
  setTxt("svTank", fmt1(d.tank)); setTxt("svTankSet", fmt1(d.tankSet));
  setTxt("svRoom", fmt1(d.room)); setTxt("svRoomSet", fmt1(d.roomSet));
  const toDhw = d.valveDhw === true;
  setTxt("svValve", "3WV → " + (toDhw ? "DHW" : "heating"));

  // Schematic state classes drive the CSS animations (flows, fan, pump, BUH glow, defrost)
  const sc = $("schem");
  const rpsOn = (d.rps ?? 0) > 0;
  sc.classList.toggle("fan-on", rpsOn && d.defrost !== true);
  sc.classList.toggle("pump-on", pumping === true);
  sc.classList.toggle("buh-on", !!(d.buh1 || d.buh2));
  sc.classList.toggle("defrost-on", d.defrost === true);
  sc.classList.toggle("no-dhw", d.tank == null);
  sc.classList.toggle("no-room", d.room == null);
  const onCls = (id, on) => $(id).classList.toggle("on", !!on);
  onCls("fSup1", pumping); onCls("fSup2", pumping); onCls("fRet", pumping);
  onCls("fTank", pumping && toDhw); onCls("fCoil", pumping && toDhw); onCls("fTankRet", pumping && toDhw);
  onCls("fHeat", pumping && !toDhw); onCls("fHeatRet", pumping && !toDhw);
  onCls("rfHot", rpsOn); onCls("rfCold", rpsOn);
  $("rfHot").classList.toggle("rev", d.defrost === true);   // defrost reverses the refrigerant loop
  $("rfCold").classList.toggle("rev", d.defrost === true);

  // KPI tiles
  setTxt("kRps", fmt0(d.rps));
  $("kRpsBar").style.width = d.rps != null ? Math.min(100, Math.round(d.rps / RPS_MAX * 100)) + "%" : "0%";
  setTxt("kFlow", fmt1(d.flow)); setTxt("kPump", fmt0(d.pump));
  setTxt("kDt", fmt1(d.dt)); setTxt("kDtSet", fmt1(d.dtSet));
  setTxt("kWp", fmt1(d.wp));
  $("kWpBar").style.width = d.wp != null ? Math.min(100, Math.round(d.wp / 3 * 100)) + "%" : "0%";
  setTxt("kPth", fmt1(d.pth));
  // Bar floors at 0 — it cannot render a negative length. The figure above it carries the sign, so
  // a defrost reads "-5.2 kW" over an empty bar rather than a filled bar over a clamped zero.
  $("kPthBar").style.width = d.pth != null ? Math.min(100, Math.max(0, Math.round(d.pth / 16 * 100))) + "%" : "0%";
  setTxt("kCop", d.cop == null ? "—" : d.cop.toFixed(1));
  setTxt("kPelSub", d.pel != null ? `${fmt1(d.pel)} kW el. (${d.pelSrc})` : "no current sensor");

  trendSample(d);
}

// ── Short-term trend: client-side ring buffer over the /events pushes ────────────────────────
// One sample every 10 s, 180 samples ≈ 30 min — enough to make cycling, DHW runs and defrost dips
// visible. Lost on reload by design; long-term history is Home Assistant/Grafana's job.
const TREND_MS = 10000, TREND_N = 180;
const trend = { t: 0, lwt: [], out: [] };
function trendSample(d) {
  const now = Date.now();
  if (now - trend.t < TREND_MS) return;
  trend.t = now;
  trend.lwt.push(d.lwt);
  trend.out.push(d.out);
  if (trend.lwt.length > TREND_N) { trend.lwt.shift(); trend.out.shift(); }
  drawTrend();
}
function drawTrend() {
  const W = 640, H = 150, PL = 36, PR = 64, PT = 10, PB = 14;
  const fin = (a) => a.filter((x) => x != null && Number.isFinite(x));
  const finL = fin(trend.lwt), finO = fin(trend.out);
  $("tlOut").hidden = finO.length < 2;      // legend names only series that draw
  if (finL.length < 2 && finO.length < 2) {
    $("trend").innerHTML = `<text class="tr-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Collecting data…</text>`;
    return;
  }
  const all = finL.concat(finO);
  const lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1);
  const n = trend.lwt.length;
  const x = (i) => PL + (n < 2 ? 0 : i / (n - 1) * (W - PL - PR));
  const y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const gy1 = y(lo + (hi - lo) * 0.25), gy2 = y(lo + (hi - lo) * 0.75);
  let svg =
    `<line class="tr-grid" x1="${PL}" y1="${gy1.toFixed(1)}" x2="${W - PR}" y2="${gy1.toFixed(1)}"/>` +
    `<line class="tr-grid" x1="${PL}" y1="${gy2.toFixed(1)}" x2="${W - PR}" y2="${gy2.toFixed(1)}"/>` +
    `<text class="tr-axis" x="4" y="${(y(hi) + 10).toFixed(1)}">${hi}°</text>` +
    `<text class="tr-axis" x="4" y="${y(lo).toFixed(1)}">${lo}°</text>`;
  const series = (buf, col) => {
    if (fin(buf).length < 2) return;
    const pts = buf.map((t, i) => (t == null ? null : `${x(i).toFixed(1)},${y(t).toFixed(1)}`)).filter(Boolean).join(" ");
    let li = buf.length - 1;
    while (li >= 0 && buf[li] == null) li--;
    svg += `<polyline class="tr-line" style="stroke:var(${col})" points="${pts}"/>` +
      `<circle class="tr-end" cx="${x(li).toFixed(1)}" cy="${y(buf[li]).toFixed(1)}" r="3.5" fill="var(${col})"/>` +
      `<text class="tr-val" x="${(x(li) + 8).toFixed(1)}" y="${(y(buf[li]) + 4).toFixed(1)}" fill="var(${col})">${buf[li].toFixed(1)}°</text>`;
  };
  series(trend.out, "--flow-cold");
  series(trend.lwt, "--flow-hot");
  $("trend").innerHTML = svg;
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
// Route a /set_wifi rejection to the field it names — wifi_credentials_valid answers "invalid ssid" /
// "invalid password", and the modal's two hints already state exactly those rules, so mark the field
// and unhide its own hint rather than overwriting it with the terser server wording (the toast carries
// that verbatim anyway). A message naming neither field (a malformed body) stays toast-only rather
// than blaming an arbitrary field.
function wifiFieldError(msg) {
  if (/ssid/i.test(msg)) { $("wfSSID").classList.add("invalid"); $("wfSSIDError").hidden = false; }
  else if (/pass/i.test(msg)) { $("wfPass").classList.add("invalid"); $("wfPassError").hidden = false; }
}

// ── MQTT (dashboard edit modal) ───────────────────────────────────────────
// The MQTT broker is edited in a modal opened from the Connections tile's MQTT row pencil — there is
// no settings sub-screen. Only the broker prefills (user/pass aren't exposed by /status); a Save
// reboots to apply (saveReboot), Cancel/backdrop/Esc dismiss without a write.
function fillMqtt() {
  const m = S.status?.mqtt || {};
  $("mqBroker").value = m.broker || "";
  // The credential fields start empty every time (/status never exposes them), which the firmware
  // reads as "keep the stored ones". So empty can't also mean "clear" — the checkbox is the explicit
  // signal, and it only has anything to do when credentials are actually stored (mqtt.has_creds).
  $("mqUser").value = "";
  $("mqPass").value = "";
  setMqttClear(false);
  $("mqClearRow").hidden = !m.has_creds;
}
// Checking "remove stored credentials" means the save must carry NO credentials — the firmware treats
// a non-empty user/pass as an explicit set that overrides the flag, so an editable field here would
// let the user build a request that contradicts itself. Empty + disable them while it's checked.
function setMqttClear(on) {
  $("mqClearCreds").checked = on;
  if (on) { $("mqUser").value = ""; $("mqPass").value = ""; }
  $("mqUser").disabled = on;
  $("mqPass").disabled = on;
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
// A URL path is allowed because a WebSocket broker normally has one (`wss://host:8084/mqtt`) — the
// device takes only host+port for its pre-flight probe and hands esp-mqtt the whole URI. A bare
// host:port is raw TCP, where a path would be meaningless, so it stays path-less.
const validMqtt = (h) => {
  h = h.trim();
  return !h || /^[\w.\-]+:\d{2,5}$/.test(h) || /^(mqtts?|wss?):\/\/[\w.\-]+(:\d{2,5})?(\/\S*)?$/.test(h);
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

// ── NTP (dashboard edit modal) ──────────────────────────────────────────────
function fillNtp() {
  $("ntpServer").value = S.status?.ntp?.server || "";
}
function openNtp() {
  fillNtp();
  $("ntpServer").classList.remove("invalid");
  $("ntpError").hidden = true;
  $("ntpModal").hidden = false;
  $("ntpServer").focus();
}
function closeNtp() { $("ntpModal").hidden = true; }
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
// Poll /ota/status until `state` leaves the set we're waiting on, or we run out of patience.
// Every OTA phase is asynchronous on the device (the download runs on its own task so the single
// httpd worker stays free), so the UI's whole job here is to watch a state machine it does not drive.
async function otaPoll(waitStates, tries, onTick) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let s;
    try { s = await j("/ota/status"); } catch { continue; }   // a dropped poll is not a failure
    if (onTick) onTick(s);
    if (!waitStates.includes(s.state)) return s;
  }
  return null;
}

async function checkFirmwareUpdate() {
  if (S.busy) { toast("Still applying the last change…", "info"); return; }
  S.busy = true;
  // rebootPoll() clears S.busy itself, asynchronously, once the device answers again — so the exit
  // path must hand ownership over rather than clear the flag on the way out. Clearing it here after
  // starting the poll would re-enable the UI while the device is still rebooting.
  let handedOff = false;
  try {
    toast("Checking for updates…", "info");
    try { await j("/ota/check?ms=" + Date.now()); }
    catch { toast("Couldn't reach the device", "err"); return; }

    const s = await otaPoll(["checking"], 30);
    if (!s)                 { toast("Update check timed out", "err"); return; }
    if (s.state === "error"){ toast(s.message || "Update check failed", "err"); return; }
    if (!s.update_available) { toast(`Up to date (v${s.current})`, "ok"); return; }

    // The device re-fetches the manifest and re-runs the downgrade gate before downloading, so this
    // prompt is a courtesy, not the safety check — declining here changes nothing on the device.
    if (!confirm(`Update available: v${s.current} → v${s.available}\n\n` +
                 `The device downloads and installs the signed image, then reboots. ` +
                 `If the new firmware can't get online it rolls back automatically.`)) {
      toast("Update cancelled", "info");
      return;
    }

    // fetch resolves for ANY answered status, so a 503 from the shared OOM guard arrives as a
    // perfectly successful promise. Left unchecked it would fall through into the poll below and
    // surface 5 minutes later as "Update timed out" — the wrong diagnosis for a retryable refusal.
    let r;
    try { r = await post("/ota/update", {}); }
    catch { toast("Couldn't start the update", "err"); return; }
    if (r.status === 503) { toast("Device busy — retry in a moment", "err"); return; }
    if (!r.ok) { toast(await errorOf(r, "Couldn't start the update"), "err"); return; }

    toast("Downloading… keep the device powered", "info");
    const done = await otaPoll(["checking", "updating"], 300,
                               (t) => { if (t.state === "updating") toast(`Downloading… ${t.progress}%`, "info"); });
    if (!done)                  { toast("Update timed out", "err"); return; }
    if (done.state === "error") { toast(done.message || "Update failed", "err"); return; }

    // state === "done": the device reboots ~600 ms after reporting it. Hand off to the same
    // reboot-poll the config saves use, so the UI reconnects instead of showing a dead page.
    toast("Installed — rebooting…", "ok");
    rebootPoll(renderDashboard);
    handedOff = true;
  } finally {
    if (!handedOff) S.busy = false;
  }
}

// ── Reboot-and-reconnect writes (WiFi / MQTT / Syslog) ────────────────────
// Mark a save button in-flight: disabled + spinner (DESIGN.md §8). The /set_mqtt broker pre-flight
// blocks up to ~8 s, long enough that an un-styled disabled button reads as an ignored click.
function setBusy(id, on) {
  const b = $(id);
  if (!b) return;
  b.disabled = on;
  if (on) {
    if (b.dataset.label == null) b.dataset.label = b.textContent;   // remember the idle label once
    b.innerHTML = `<span class="spin"></span>Saving…`;              // static markup — no interpolation
  } else {
    b.textContent = b.dataset.label || "Save";
  }
}

// Read the {"ok":false,"error":…} body every write endpoint answers a rejection with. Take the value
// only when it really is a non-empty error string: .catch covers an unparseable body, but a body that
// parses to JSON `null` would still resolve, and `null.error` throws — which here would escape
// saveReboot before idle() runs and strand S.busy + the Save button disabled for good. Mirrors
// setup.html's errorText().
async function errorOf(r, fallback) {
  const o = await r.json().catch(() => null);
  return (o && typeof o.error === "string" && o.error) || fallback;
}

// Poll /status until the rebooted device answers again, then hand back to `then`.
// A WiFi rollback deliberately outruns this window (wifi.cpp takes 60–180 s to decide), so the
// rollback outcome is NOT reported here — renderRollbackBanner() surfaces it off /status instead.
function rebootPoll(then) {
  let tries = 0;
  const poll = setInterval(async () => {
    tries++;
    try {
      S.status = await j("/status");
      clearInterval(poll); S.busy = false;
      toast("Saved", "ok");
      then();
    } catch {
      if (tries > 14) { clearInterval(poll); S.busy = false; toast("Rebooted — reconnect to the device", "info"); }
    }
  }, 1500);
}

// One flow for all three modal saves. The endpoints share a contract: {"ok":true,"reboot":true} →
// persisted, device restarts; {"ok":true,"reboot":false} → nothing changed, no restart; a 4xx →
// {"ok":false,"error":…} and NOTHING was written; a 503 → the shared heap guard refused the request.
//
// Only a 2xx may enter the reboot-poll. fetch rejects on transport errors ONLY, never on status, so
// an answered 4xx/5xx is a verdict that arrives as a perfectly resolved promise — and firing the poll
// off it reported "Saved" for REJECTED writes: with no reboot to wait for, the follow-up /status
// answers on the first try, which the poll can't tell apart from a device that came back up.
// (/set_wifi's 500 on a failed config_save is the same shape: nothing persisted, no reboot.)
async function saveReboot(url, body, { btn, showError, close, then, busyMsg }) {
  // The reboot-poll keeps S.busy set for ~22 s AFTER the modal closes, so the card is reopenable
  // while a change is still landing. Say so — a silent `return` here is exactly the ignored-write
  // feedback gap this whole flow exists to close.
  if (S.busy) { toast("Still applying the last change…", "info"); return; }
  S.busy = true;
  setBusy(btn, true);
  if (busyMsg) toast(busyMsg, "info");
  const idle = () => { S.busy = false; setBusy(btn, false); };
  const reject = (msg) => { idle(); showError(msg); toast(msg, "err"); };
  let r;
  try {
    r = await post(url, body);
  } catch {
    // The endpoints answer BEFORE rebooting (reboot_soon fires ~400 ms after the response), so a
    // throw here means the request never landed — nothing was written and the modal must stay open.
    reject("Couldn't reach the device");
    return;
  }
  // 503 is the device out of contiguous heap, not a bad field: nothing was written and the same save
  // is worth retrying verbatim, so it gets a toast and no inline field error blaming the input.
  if (r.status === 503) { idle(); toast("Device busy — retry in a moment", "err"); return; }
  if (!r.ok) { reject(await errorOf(r, "Rejected")); return; }
  const res = await r.json().catch(() => ({}));
  setBusy(btn, false);
  close();
  if (res.reboot === false) { S.busy = false; toast("No changes", "info"); return; }   // /set_mqtt: unchanged
  toast("Rebooting — reconnecting…", "info");
  rebootPoll(then);   // stays busy until the device answers again (or the poll gives up)
}

// ── Boot ─────────────────────────────────────────────────────────────────
function wire() {
  // The dashboard card grid (#valueGroups) is rebuilt on every poll, so its interactive controls are
  // wired by delegation: the ESP32 card's Firmware row checks for an OTA update, and its RX/TX
  // dropdowns re-run pin auto-detection on change.
  $("valueGroups").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "ota") { checkFirmwareUpdate(); return; }
    // Tapping a value row (that has a description) expands/collapses its explainer accordion.
    const desc = e.target.closest("[data-desc]");
    if (desc) toggleDesc(desc);
  });
  $("valueGroups").addEventListener("change", (e) => {
    if (e.target.id === "e32Rx" || e.target.id === "e32Tx") onPinPick();
  });
  // Connections tile (#connTile) is rebuilt every poll too — each row's pencil opens its own edit
  // modal (WiFi/MQTT/Syslog/NTP), delegated the same way.
  $("connTile").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (!edit) return;
    if (edit.dataset.edit === "wifi") openWifi();
    else if (edit.dataset.edit === "mqtt") openMqtt();
    else if (edit.dataset.edit === "syslog") openSyslog();
    else if (edit.dataset.edit === "ntp") openNtp();
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
    // NOT trimmed: leading/trailing spaces are valid SSID bytes (an AP may legitimately name itself
    // " home " or "wifi "), so the field is an opaque identifier — trimming it would submit, and try
    // to join, a different network than the one the user selected.
    const ssid = $("wfSSID").value;
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
    saveReboot("/set_wifi", { ssid, pass }, {
      btn: "wfBtn",
      showError: wifiFieldError,
      close: closeWifi,
      then: renderDashboard,
    });
  });
  $("wfSSID").addEventListener("input", () => { $("wfSSID").classList.remove("invalid"); $("wfSSIDError").hidden = true; });
  $("wfPass").addEventListener("input", () => { $("wfPass").classList.remove("invalid"); $("wfPassError").hidden = true; });

  $("mqCancel").onclick = closeMqtt;
  $("mqttBackdrop").onclick = closeMqtt;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("mqttModal").hidden) closeMqtt(); });
  $("mqttForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const broker = $("mqBroker").value.trim();
    if (!validMqtt(broker)) {
      $("mqBroker").classList.add("invalid");
      $("mqError").textContent = "Enter host:port — e.g. 192.168.1.10:1883 — or mqtts://host:8883 for TLS";
      $("mqError").hidden = false;
      toast("Check the broker address", "err");
      return;
    }
    saveReboot("/set_mqtt", {
      broker,
      // user is an opaque credential like pass — NOT trimmed. Spaces can be significant in a broker
      // username, and mangling it here would fail auth against a broker that would otherwise accept it.
      user: $("mqUser").value,
      pass: $("mqPass").value,
      clear_creds: $("mqClearCreds").checked,   // explicit credential clear (blank fields keep them)
    }, {
      btn: "mqBtn",
      showError: (msg) => { $("mqBroker").classList.add("invalid"); $("mqError").textContent = msg; $("mqError").hidden = false; },
      close: closeMqtt,
      then: renderDashboard,
      busyMsg: "Verifying MQTT connection…",   // the endpoint pre-flights the broker (DNS→TCP→CONNECT)
    });
  });
  $("mqBroker").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; });
  // Typing credentials upgrades the broker scheme to TLS (the bridge refuses plaintext + creds);
  // clearing them again strips the scheme back to bare. Only mutates the broker while editing the
  // credential fields — typing in the broker field itself is left untouched.
  const handleCredsInput = () => {
    // Empty fields are NOT "no credentials". With credentials stored and the remove box unticked, the
    // device KEEPS them — that is the whole point of the empty-means-keep default — so the broker
    // still needs mqtts://. Inferring "no creds" from the fields alone let the else-branch strip the
    // scheme off a broker the user never touched (type a password, change your mind, backspace it —
    // and mqtts://host silently became host), producing a save the firmware then rejects with
    // "Credentials require mqtts://": an error blaming a scheme this page removed on its own.
    // (Ticked, the fields are disabled and this can't fire; the term keeps the intent explicit.)
    const typed = $("mqUser").value.length > 0 || $("mqPass").value.length > 0;
    const hasCreds = typed || (!!S.status?.mqtt?.has_creds && !$("mqClearCreds").checked);
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
  // Deliberately does NOT strip an mqtts:// broker back to plaintext the way clearing the cred fields
  // does: dropping credentials is not a request to drop TLS, and an anonymous mqtts:// broker is a
  // valid target. The scheme stays the user's call.
  $("mqClearCreds").addEventListener("change", (e) => {
    setMqttClear(e.target.checked);
    $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
  });

  $("slHost").addEventListener("input", () => { $("slHost").classList.remove("invalid"); $("slError").hidden = true; });

  $("slCancel").onclick = closeSyslog;
  $("syslogBackdrop").onclick = closeSyslog;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("syslogModal").hidden) closeSyslog(); });
  $("syslogForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("slHost").value.trim();   // host:port is an address, not a credential — OK to trim
    let host = "";
    let port = 514;
    if (raw) {
      const idx = raw.lastIndexOf(":");
      if (idx !== -1) {
        host = raw.substring(0, idx);
        // Validate the FULL port string. `parseInt(...) || 514` silently turned "0", "abc" and
        // "514abc" into 514 — masking a typo as a valid save. Require all-digits in 1–65535 instead.
        const portStr = raw.substring(idx + 1);
        if (!/^\d+$/.test(portStr) || +portStr < 1 || +portStr > 65535) {
          $("slHost").classList.add("invalid");
          $("slError").textContent = "Port must be a whole number 1–65535 (e.g. logs.example.com:514).";
          $("slError").hidden = false;
          toast("Check the Syslog port", "err");
          return;
        }
        port = +portStr;
      } else {
        host = raw;
      }
    }
    saveReboot("/set_syslog", { host, port }, {
      btn: "slBtn",
      showError: (msg) => { $("slHost").classList.add("invalid"); $("slError").textContent = msg; $("slError").hidden = false; },
      close: closeSyslog,
      then: renderDashboard,
      busyMsg: "Saving Syslog settings…",
    });
  });

  $("ntpServer").addEventListener("input", () => { $("ntpServer").classList.remove("invalid"); $("ntpError").hidden = true; });
  $("ntpCancel").onclick = closeNtp;
  $("ntpBackdrop").onclick = closeNtp;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("ntpModal").hidden) closeNtp(); });
  $("ntpForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const server = $("ntpServer").value.trim();
    saveReboot("/set_ntp", { server }, {
      btn: "ntpBtn",
      showError: (msg) => { $("ntpServer").classList.add("invalid"); $("ntpError").textContent = msg; $("ntpError").hidden = false; },
      close: closeNtp,
      then: renderDashboard,
      busyMsg: "Saving NTP settings…",
    });
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
          } else if (Array.isArray(r.values)) {
            // Defensive only: every frame the firmware sends today is typed (http_status.cpp sends
            // "status"/"values" for both the live pushes and the "sub" snapshot), so this branch is
            // for a future/renamed frame that still carries a values array. The old fallback was
            // `r.values || r || []`, which assigned the frame OBJECT itself for anything without a
            // values key — every later pickValue()/faultValue() then ran .find/.filter on a non-array
            // and threw. Accept only an actual values array; drop unknown frames and keep the last
            // good values on screen.
            S._values = r.values;
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
