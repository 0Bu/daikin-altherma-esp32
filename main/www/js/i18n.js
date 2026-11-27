// Web UI for daikin-altherma-esp32 — a client-side, view-switched SPA over the firmware HTTP API.
// The hash-free URL is the dashboard; the header gear leads to the flat, addressable Settings screen,
// and each configuration row opens its own addressable modal there.
// Design contract: docs/DESIGN.md. Split from index.html for edit locality; spliced back in at
// build time (inline_assets.cmake). No framework, no external assets.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ── i18n: UI language ─────────────────────────────────────────────────────────
// The default is BROWSER-detected for every supported language, with English as the fallback for
// every key. On top of that the device can carry a MANUAL override (config ui_lang,
// POST /set_lang, /status.ui.lang): once the user picks a language it is stored in NVS and wins over
// the browser guess on every client that opens the dashboard, until they set it back to "Browser"
// (DESIGN.md §1). The heat-pump VALUE LABELS are NOT translated here: they arrive from the firmware
// over /values as English X10A register names (docs/REGISTERS.md) and stay verbatim; the
// tap-to-expand value/model descriptions keep their English source labels, but their explanatory
// prose is localized through the same device-local locale asset. The schematic inspector and HomeHub
// row names use that asset too. Dynamic strings built in this file go
// through t(); the static markup in index.html is localised by applyStaticI18n() reading data-i18n
// attributes, re-run by setLang() when the language changes live.
const UI_LANGS = Object.freeze(["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"]);
const uiLangSupported = (lang) => UI_LANGS.includes(lang);
// The compact UI catalog above is not the only visible copy surface. The schematic inspector,
// HomeHub source rows and tap-to-expand value/model explanations need longer, domain-specific wording
// that would make the already tight startup page too large if all languages were inlined. Locale
// modules register those tables alongside I18N after the same device-local /locale.js request.
// English retains the in-bundle fallback; German model explanations and the newer locales use
// the same lazy catalog without changing manufacturer transport labels or using prose as an id.
const INSPECT_I18N = Object.create(null);
const HOMEHUB_LABEL_I18N = Object.create(null);
const DESCRIPTION_I18N = Object.create(null);
const MODEL_DESCRIPTION_I18N = Object.create(null);
const FAULT_CODE_I18N = Object.create(null);
const MB_DELTA_I18N = Object.create(null);
// Locale assets store their compact UI translations positionally against the English key order.
// The comments in those source files retain the readable key mapping, while the shipped scripts
// omit repeated property names per language. This keeps all twelve external catalogs within the
// fixed application partition without weakening the English fallback contract.
function localeValues(values) {
  const keys = Object.keys(I18N.en);
  if (!Array.isArray(values) || values.length !== keys.length) throw new Error("locale catalog length");
  const catalog = {};
  keys.forEach((key, index) => { catalog[key] = values[index]; });
  return catalog;
}
const INSPECT_LOCALE_KEYS = ("status env3 sgrequest ou comp out ouhx hp disch lp eev r3t phe lwt " +
  "r2t rwt dt pth cop buh bsh valve valve2 tank heat spaceh room pump pel defrost quiet rhot " +
  "rcold wsup wtank wheat wret flow flow_switch wp").split(" ");
const HOMEHUB_LOCALE_OFFSETS =
  "1 2 3 4 6 7 9 10 12 13 21 22 23 30 31 32 33 35 36 37 38 40 41 42 43 44 45 49 50 51 52 53 54 55 56 57 58".split(" ");
const DESCRIPTION_LOCALE_COUNT = 130;
const FAULT_CODE_LOCALE_COUNT = 63;
const MB_DELTA_LOCALE_KEYS = ["outdoor_air", "room_temp"];
const MODEL_DESCRIPTION_LOCALE_KEYS = ("health_fault health_dhw_loss health_cycling health_defrost " +
  "health_pressure health_flow health_heater health_retries free_heap max_alloc capacity capacity_iu " +
  "candidates candidates_nocap oueeprom").split(" ");
function inspectValues(held, values) {
  const catalog = {
    held: { lead: held[0], why: held[1] },
    held_unknown: held[2],
  };
  values.forEach((value, index) => {
    const entry = { t: value[0], aria: value[1] || value[0], what: value[2] };
    if (value.length === 4) entry.now = value[3];
    catalog[INSPECT_LOCALE_KEYS[index]] = entry;
  });
  return catalog;
}
function homeHubValues(values) {
  const catalog = {};
  HOMEHUB_LOCALE_OFFSETS.forEach((offset, index) => { catalog[offset] = values[index]; });
  return Object.freeze(catalog);
}
// Value descriptions are already matched by the ordered DESCRIPTIONS table, so the winning array
// position is their stable locale identifier. Model rows already have stable ids. Each compact row
// is [what] or [what, normal]; a compact locale may fold essential normal context into `what` and
// omit the second field, but it never falls back to English. Keeping the rows positional avoids
// repeating 130 regexes/keys in every signed locale asset. The locale contract pins their order.
function descriptionValues(values) {
  if (!Array.isArray(values) || values.length !== DESCRIPTION_LOCALE_COUNT)
    throw new Error("description locale length");
  return values;
}
function modelDescriptionValues(values) {
  if (!Array.isArray(values) || values.length !== MODEL_DESCRIPTION_LOCALE_KEYS.length)
    throw new Error("model description locale length");
  const catalog = {};
  MODEL_DESCRIPTION_LOCALE_KEYS.forEach((key, index) => { catalog[key] = values[index]; });
  return catalog;
}
function faultCodeValues(values, none, unknown) {
  if (!Array.isArray(values) || values.length !== FAULT_CODE_LOCALE_COUNT ||
      values.some((value) => typeof value !== "string" || !value.trim()) ||
      typeof none !== "string" || !none.trim() || typeof unknown !== "string" || !unknown.trim())
    throw new Error("fault-code locale length");
  return Object.freeze({ values, none, unknown });
}
function mbDeltaValues(values) {
  if (!Array.isArray(values) || values.length !== MB_DELTA_LOCALE_KEYS.length ||
      values.some((value) => typeof value !== "string" || !value.trim()))
    throw new Error("Modbus delta locale length");
  return Object.freeze(Object.fromEntries(MB_DELTA_LOCALE_KEYS.map((key, index) => [key, values[index]])));
}
const INLINE_DOMAIN_LANGS = new Set(["en", "de"]);
const autoLang = () => {
  let primary = String(navigator.language || "").trim().toLowerCase().split(/[-_]/, 1)[0];
  if (primary === "no") primary = "nb"; // generic Norwegian browsers use the Bokmal catalog
  return uiLangSupported(primary) ? primary : "en";
};
// localStorage, GUARDED: Safari private mode throws on access, and the UI must not die over a
// language cache. A failure just means no first-paint fast-path — the device's /status is the source
// of truth for the language anyway, so the only cost is one frame in the browser default.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode / quota */ } };
// Mutable, because the device's stored override can switch it at runtime. Seeded from a localStorage
// cache of the last effective language so the FIRST paint doesn't flash the browser default before
// the async /status lands, then reconciled with the device on every poll (setLangFromStatus).
const INITIAL_AUTO_LANG = autoLang();
let UI_LANG_MODE = (() => { const m = lsGet("uiLangMode"); return uiLangSupported(m) ? m : "auto"; })();
let LANG = (() => { const c = lsGet("uiLang"); return uiLangSupported(c) ? c : INITIAL_AUTO_LANG; })();
// English stays in the startup page as the guaranteed fallback. The other catalogs share one
// lossless pre-compressed asset served by this ESP32. Its first load registers all languages;
// the startup page stays independent of that request and the internet. One Promise per
// language coalesces boot/status races and a failed asset is remembered for this page lifetime.
const LOCALE_LOADS = new Map();
const LOCALE_ASSET_TAG = "";
function localeReady(lang) {
  if (!I18N[lang]) return false;
  if (lang === "en") return true;
  if (lang === "de") return !!MODEL_DESCRIPTION_I18N.de &&
    MODEL_DESCRIPTION_LOCALE_KEYS.every(key => !!MODEL_DESCRIPTION_I18N.de[key]) &&
    !!FAULT_CODE_I18N.de && FAULT_CODE_I18N.de.values.length === FAULT_CODE_LOCALE_COUNT;
  const inspect = INSPECT_I18N[lang], homehub = HOMEHUB_LABEL_I18N[lang];
  const descriptions = DESCRIPTION_I18N[lang], models = MODEL_DESCRIPTION_I18N[lang];
  const faultCodes = FAULT_CODE_I18N[lang], mbDeltas = MB_DELTA_I18N[lang];
  return !!inspect && INSPECT_LOCALE_KEYS.every((key) => !!inspect[key]) && !!inspect.held &&
         !!inspect.held_unknown &&
         !!homehub && HOMEHUB_LOCALE_OFFSETS.every((offset) => homehub[offset] != null) &&
         Array.isArray(descriptions) && descriptions.length === DESCRIPTION_LOCALE_COUNT &&
         !!models && MODEL_DESCRIPTION_LOCALE_KEYS.every((key) => !!models[key]) &&
         (INLINE_DOMAIN_LANGS.has(lang) ||
           (!!faultCodes && faultCodes.values.length === FAULT_CODE_LOCALE_COUNT &&
            !!mbDeltas && MB_DELTA_LOCALE_KEYS.every((key) => !!mbDeltas[key])));
}
const LOCALE_LOAD_TIMEOUT_MS = 6000;
function loadLocale(lang) {
  if (localeReady(lang)) return Promise.resolve(true);
  if (!uiLangSupported(lang)) return Promise.resolve(false);
  if (LOCALE_LOADS.has(lang)) return LOCALE_LOADS.get(lang);
  let settled = false;
  let pending;
  pending = new Promise((resolve) => {
    const script = document.createElement("script");
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (!ok) {
        if (LOCALE_LOADS.get(lang) === pending) LOCALE_LOADS.delete(lang);
        script.remove?.();
      }
      resolve(ok);
    };
    const q = LOCALE_ASSET_TAG
      ? `lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(LOCALE_ASSET_TAG)}`
      : `lang=${encodeURIComponent(lang)}`;
    script.src = `/locale.js?${q}`;
    script.async = true;
    script.onload = () => finish(localeReady(lang));
    script.onerror = () => finish(false);
    if (typeof setTimeout === "function") timer = setTimeout(() => finish(false), LOCALE_LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
  if (!settled) LOCALE_LOADS.set(lang, pending);
  return pending;
}
// Each key is a string, or a function for the parameterised ones (same arity in every catalog).
const I18N = {
  en: {
    "sys.nodata": "No data", "sys.unreachable": "Unreachable",
    "sys.mb_only": "X10A offline — readings from Modbus",
    "mode.stop": "Stop", "mode.heat": "Heating", "mode.cool": "Cooling", "mode.space": "Space H/C",
    "mode.dhw": "Hot water", "mode.heat_dhw": "Heating + hot water",
    "mode.cool_dhw": "Cooling + hot water", "mode.space_dhw": "Space H/C + hot water",
    "sys.unreachable_sub": "Can't reach the device — retrying…",
    "sys.waiting": "Waiting for the heat pump…", "sys.operating": "Operating",
    "sys.standby": "Standby — not running", "sys.defrosting": "Defrosting",
    "sys.circulating": "Circulating — compressor off",
    "sys.cool_mode": "Cooling mode",
    "sys.residual_circulating": "Residual-heat circulation — no cooling output",
    "sys.bsh_active": "Electric tank heater active",
    "sys.disinfecting": "Tank disinfection active",
    "sys.online": "Online", "sys.fault": "Fault", "sys.warning": "Warning",
    "sys.fault_line": (c) => "Fault · " + c + " — check the Daikin fault code.",
    "sys.warning_line": (c) => "Warning · " + c + " — check the heat pump.",
    "sys.polled": (s) => `Polled ${s}s ago`,
    "config.unreadable_title": "Service settings unreadable",
    "config.unreadable_meta": "This build could not read stored service settings. It uses fallback settings and has not replaced the stored copy. Compatible newer firmware may restore it. A successful service-settings save replaces it; saving only X10A pins or protocol does not.",
    "recovery.title": "Recovery mode",
    // Two causes reach recovery mode and need OPPOSITE advice. The crash-loop text sends the
    // reader to the configuration; saying that after a heap give-up would send them to fix
    // something that is already correct (/status.sys.safe_mode_cause picks between them).
    "recovery.meta_heap": "The device ran out of memory repeatedly and restarted itself. It is now running with the heat pump connection and MQTT switched off, so the web interface stays reachable. The configuration is most likely fine — install a newer firmware version under Settings. A power cycle retries the full stack.",
    "recovery.meta": "The device restarted repeatedly and entered recovery mode. Communication with the heat pump and MQTT are paused. Check the configuration — especially the RX/TX pins on the Protocol card in Settings — then restart the device.",
    "rollback.title": "WiFi change failed — rolled back",
    "rollback.meta": (back) => `The device could not connect with the new WiFi settings. It restored the previous network${back} and restarted. Check the network name and password under Settings → Connections, then try again.`,
    "crash.title_fault": "Device restarted after a fault",
    "crash.title_orphan": "Crash report waiting from an earlier restart",
    "crash.reset": "Reset", "crash.task": "task", "crash.fw": "fw", "crash.elf": "elf", "crash.corrupted": "corrupted",
    "crash.stored_dump": "Stored crash report",
    "crash.stored_hint": "The report’s age and connection to this restart are unknown.",
    "crash.backtrace": "Call stack",
    "crash.download": "Download crash report", "crash.copy": "Copy diagnostics", "crash.dismiss": "Delete report",
    "crash.copied": "Diagnostics copied — paste into a bug report",
    "crash.copy_fail": "Copy failed — open /coredump and /diag manually",
    "crash.ask_dump": "Delete on the device? The core dump goes with it — download it first for a bug report.",
    "crash.ask": "Delete this report on the device?",
    "crash.ask_yes": "Delete", "crash.ask_no": "Keep",
    "crash.deleted": "Crash report deleted",
    "crash.delete_fail": "The device could not delete it — the report is still there",
    "bug.row": "Report a bug",
    "bug.title": "Report a bug",
    "bug.intro": "Briefly describe the problem. The device will add its status, readings and log after removing network names, addresses and server names.",
    "bug.what": "What happens",
    "bug.need_text": "Describe what happens first — one or two sentences are enough.",
    "bug.continue": "Prepare the report",
    "bug.step2_title": "Check the report",
    "bug.step2": "Review the report below. The button copies it and opens the GitHub issue form with your description already filled in. Paste the report into “Device report”, answer the remaining questions and submit the issue.",
    "bug.collecting": "Collecting device data…",
    "bug.collect_fail": "Could not read the device — the report below says which parts are missing.",
    "bug.copy": "Copy & open GitHub", "bug.download": "Download .md",
    "bug.md_hint": "If copying fails or you prefer a file, download the same report as .md. Drag the file into the form's “Device report” field instead of pasting the text.",
    "bug.copied": "Report copied — paste it into the “Device report” field",
    "bug.copy_fail": "Copy failed — select the text below and copy it by hand",
    "bug.redacted": "Your network name, addresses, broker and server names have already been removed.",
    "nav.settings": "Settings", "nav.back": "Back",
    "nav.cards": "Dashboard cards", "nav.diagnosis": "Diagnostics", "nav.outdoor": "Outdoor unit",
    "nav.settings_alert": (n) => `Settings — ${n} connection${n === 1 ? "" : "s"} down`,
    // ── The two sources (X10A + the HomeHub Modbus stack) ──
    "src.modbus_tag": "modbus",
    "src.agree": "Both sources agree",
    "src.delta": (d, u) => `Difference ${d}${u ? " " + u : ""}`,
    "src.disagree": "The two sources disagree about this state",
    "conn.homehub": "HomeHub",
    "group.Modbus": "Modbus",
    "conn.title": "Connections", "conn.offline": "Offline", "conn.disabled": "Disabled",
    "conn.connecting": "Connecting…", "conn.connected": "Connected", "conn.resolving": "Resolving…",
    // The wired transport's three states. "No cable" and "no address" look identical from the
    // outside and call for opposite actions — plug something in, versus fix DHCP/the VLAN — so they
    // are two strings, not one "not connected".
    "conn.eth_no_cable": "No cable", "conn.eth_no_lease": "Cable connected, no address",
    "conn.eth_fd": "full duplex",
    "conn.enabled": "Enabled", "conn.enabled_noping": "Enabled, host not answering ping",
    "conn.synced": "Synced", "conn.syncing": "Syncing…",
    "conn.error": (e) => "Error: " + e, "conn.connected_to": (s) => "Connected to " + s,
    "conn.aria": (label, state) => `${label}: ${state}. Tap to edit.`,
    "modbus.err.mdns_not_found": "No HomeHub found via mDNS.",
    "modbus.err.no_address": "No HomeHub address is configured.",
    "modbus.err.resolve_failed": "The HomeHub address could not be resolved.",
    "modbus.err.connect_timeout": "Connection timed out — the HomeHub is not reachable.",
    "modbus.err.connection_refused": "HomeHub reachable, but the Modbus TCP port is closed.",
    "modbus.err.network_unreachable": "No network route to the HomeHub.",
    "modbus.err.host_unreachable": "The HomeHub is not reachable on the network.",
    "modbus.err.connect_failed": "The connection to the HomeHub failed.",
    "modbus.err.request_failed": (r) => `Could not build the Modbus request${r ? ` for register ${r}` : ""}.`,
    "modbus.err.send_timeout": (r) => `Sending the Modbus request timed out${r ? ` at register ${r}` : ""}.`,
    "modbus.err.send_failed": (r) => `The Modbus request could not be sent${r ? ` at register ${r}` : ""}.`,
    "modbus.err.response_timeout": (r) => `The HomeHub response timed out${r ? ` at register ${r}` : ""}.`,
    "modbus.err.connection_closed": (r) => `The HomeHub closed the connection${r ? ` at register ${r}` : ""}.`,
    "modbus.err.receive_failed": (r) => `The HomeHub response could not be read${r ? ` at register ${r}` : ""}.`,
    "modbus.err.invalid_response": (r) => `Invalid Modbus response${r ? ` at register ${r}` : ""}.`,
    "modbus.err.internal_error": "The Modbus polling cycle failed internally.",
    "modbus.err.exception": (r, n, why) => `HomeHub rejected register ${r || "?"} (exception ${n}: ${why}).`,
    "modbus.exc.1": "illegal function", "modbus.exc.2": "illegal data address",
    "modbus.exc.3": "illegal data value", "modbus.exc.4": "device failure",
    "modbus.exc.5": "request acknowledged", "modbus.exc.6": "device busy",
    "modbus.exc.8": "memory parity error", "modbus.exc.10": "gateway path unavailable",
    "modbus.exc.11": "target did not respond", "modbus.exc.unknown": "unknown reason",
    "card.model": "Model", "card.hplink": "Heat-pump link", "card.online": "Online",
    "card.uptime": "Uptime",
    "card.freeheap": "Free memory", "card.maxalloc": "Largest free block",
    "card.offline": "Offline", "card.protocol": "Protocol", "card.rxpin": "RX pin",
    "card.txpin": "TX pin", "card.capacity": "Capacity",
    "card.hplink_help": "Shows whether the ESP32 is currently receiving valid replies from the heat pump over X10A.",
    "card.protocol_help": "X10A-I and X10A-S are the two supported service-interface frame formats. The firmware detects the format from valid replies.",
    "card.rxpin_help": "GPIO on which the ESP32 receives X10A data from the heat pump. While the link is offline, the selector starts a new automatic detection attempt with the chosen pair.",
    "card.txpin_help": "GPIO on which the ESP32 sends X10A requests to the heat pump. RX and TX must be different and match the physical wiring.",
    // Named for the unit it came from: the indoor unit's rated code stands in only when the outdoor
    // unit reports no capacity, and the two are routinely different sizes.
    "card.capacity_iu": "Capacity (indoor unit)",
    "card.candidates": "Possible models", "card.oueeprom": "Outdoor unit ID",
    // The rolling plant-observation card (logic/checkup.hpp). Row labels name what was COUNTED, not the sensor:
    // the reader is being shown a rolling aggregate, and "Water pressure" would read as the live figure
    // that is already in the value list further down.
    "card.checkup": "Plant diagnostics · 24 h",
    "service.title": "Refrigerant (heating)",
    "service.state.waiting": "WAITING",
    "service.state.observing": "RECORDING",
    "service.state.limited": "PARTIAL",
    "service.state.interrupted": "PAUSED",
    "service.short.observing": (d) => `RECORDING · ${d}`,
    "service.short.limited": (d) => `RECORDING · ${d} · Partial`,
    "service.reason.unsupported_profile": "This model does not provide every required reading.",
    "service.reason.compressor_not_running": "The compressor is not running.",
    "service.reason.unsupported_or_unknown_mode": "Ordinary space heating is not confirmed.",
    "service.reason.dhw_path": "The heat pump is heating domestic hot water.",
    "service.reason.defrost": "The outdoor unit is defrosting.",
    "service.reason.unit_fault": "The heat pump is reporting a fault or warning.",
    "service.reason.special_controller_phase": "A short startup or special controller phase is active.",
    "service.reason.missing_fresh_signal": "At least one required current reading is missing.",
    "service.reason.poll_gap": "The X10A connection was interrupted or intentionally paused.",
    "service.window": (d, n) => `${d} · ${n} ${n === 1 ? "reading" : "readings"}`,
    "service.help.observing": "Recording this heating run.",
    "service.help.limited": "Passive recording of this heating run; optional context is incomplete.",
    "service.help.interrupted": "Restarts with the next eligible heating run.",
    "service.common": "One space-heating run, separate from 24-hour checks. No refrigerant-charge or normal-range diagnosis. Valve: command, not measured position.",
    "check.fault": "Unit fault", "check.dhw_loss": "DHW tank cooling",
    "check.cycling": "Compressor starts",
    "check.defrost": "Defrost", "check.pressure": "Water pressure",
    "check.flow": "Min. flow rate",
    "check.flow.lowest": "Lowest flow while heating",
    "check.flow.runup": "Readings count after 10 minutes of continuous room heating.",
    "check.flow.assessment": "The installation manual lists the minimum flow for your model and operating mode. Too little flow can trigger a 7H error.",
    "check.flow.explain": "Flow rate is the number of liters of water that pass through the heat pump each minute.",
    "check.flow.live": "Now",
    "check.flow.show": "Show a low point",
    "check.flow.readout": (value) => `In this period, at least one reading was ${value}. Room heating had already been running for at least ten minutes.`,
    "check.flow.locations_missing": "The time of older readings at this value was not saved.",
    "check.flow.unavailable": "The readings needed to determine the heating minimum are unavailable.",
    "check.flow.waiting": "Waiting for a qualifying heating period.",
    "check.heater": "Electric heaters",
    "check.retries": "Protection counters",
    "check.status.ok": "OK", "check.status.info": "NOTE",
    "check.status.warn": "WARNING", "check.status.collecting": "CHECKING",
    "check.status.observation": "MEASURED", "check.status.experimental": "TENTATIVE",
    "check.status.unavailable": "N/A",
    "check.dhw.maximum": "Strongest tank cooling",
    "check.dhw.waiting": "Waiting for a qualifying one-hour window.",
    "check.dhw.no_window": "No completed one-hour window in the last 24 h.",
    "check.dhw.locations_missing": "No time window in the current chart is available for older readings at this value.",
    "check.dhw.stale": "Current tank-cooling readings are missing or stale; marked windows are historical.",
    "check.dhw.shape_step": "Sudden temperature drop in this hour — fits a hot-water draw or sudden tank mixing.",
    "check.dhw.shape_steady": "Steady cooling without a sudden drop — fits standing heat loss, thermosiphoning, or continuous circulation.",
    "check.dhw.circ_on": "The external circulation pump ran during this hour (≥ 5 min), which fits circulation heat loss.",
    "check.dhw.circ_off": "The external circulation pump stayed off for at least 2 hours, making external circulation loss unlikely here.",
    "check.dhw.pump_off": "The internal water pump stayed off, making heat draw via the 3-way valve unlikely; sensor R5T alone cannot prove the exact cause.",
    "check.dhw.pump_on": "The internal heating pump ran during this hour, so internal heat draw via the 3-way valve remains possible; sensor R5T alone cannot prove the exact cause.",
    "check.dhw.circ_label": "External circulation pump",
    "check.dhw.summary_phases": (n) => `${n} strong cooling phase(s) (≥ 0.8 °C/h) in 24 h.`,
    "check.dhw.summary_circ_on": (name, withPump, total) => `${name} ran during ${withPump} of ${total} strong phases.`,
    "check.dhw.summary_circ_off": (name) => `${name} stayed off (≥ 2 h) during observed strong phases.`,
    "check.detail.value_label": "Value:",
    "check.detail.assessment_label": "Assessment:",
    "check.detail.ok": "This rule did not trigger in readable data.",
    "check.detail.info": "An observed hint; its limit is explained below.",
    "check.detail.warn": "A unit error or sustained low-pressure observation.",
    // The fault row's own four sentences. See checkupDetailKey() in dashboard.js: this row reports
    // the DEVICE's class, so it has to say which of the states behind one word it is in.
    "check.detail.fault.error": "The unit is reporting an error right now. The exact code is in the “Operation” card.",
    "check.detail.fault.warning": "The unit is reporting a warning or caution right now, not an error. The exact code is in the “Operation” card.",
    "check.detail.fault.past": "No message is active now; a message was recorded in this window. Its disappearance establishes neither cause nor resolution.",
    "check.detail.fault.past_unknown": "A message was recorded in this window; the current fault state is unreadable.",
    "check.detail.collecting": (a, b) => `Readable signals: ${a} of ${b} required.`,
    "check.detail.collecting_unknown": "No current assessment.",
    "check.detail.observation": "Observation only; no universal OK/WARNING limit.",
    "check.detail.experimental": "Experimental counters; stability cannot exclude limiting.",
    "check.detail.unavailable": "No assessable signal in this profile.",
    "check.starts": (n) => `${n} ${n === 1 ? "start" : "starts"}`,
    "check.cycling.runs": (n) => `${n} ${n === 1 ? "run" : "runs"}`,
    "check.cycling.mean": (d) => `avg. ${d}`,
    "check.cycling.completed": "Completed runs",
    "check.cycling.unclear": "Unclear purpose",
    "check.cycling.unclear_hint": "Runs can change mode or be recorded only in part.",
    "check.cycling.short": "Heating runs are short on average.",
    "check.cycling.normal": "Heating runs are long enough on average.",
    "check.cycling.few": "Too few heating runs yet.",
    "check.cycling.waiting": "More data needed.",
    "check.cycling.class_unavailable": "This system provides too little information to assess heating runs.",
    "check.cycling.unavailable": "No compressor data.",
    "check.cycling.stale": "Measurements are currently missing.",
    "check.cycling.history_empty": "No history yet.",
    "check.cycling.timed_starts": (s) => `${s} with recorded times`,
    "check.cycling.run_start": "Start",
    "check.cycling.run_stop": "Stop",
    "check.cycling.run_duration": "Duration",
    "check.cycling.run_ongoing": "Running",
    "check.cycling.run_stop_unknown": "Stop unknown",
    "check.cycling.no_timed_runs": "No recorded starts in this hour.",
    "check.cycling.run_details_unavailable": "No individual run times available for this hour.",
    "check.cycling.saved_starts": (s) => `Of these, ${s} come from hourly totals saved before the restart.`,
    "check.cycling.short_runs": (n) => `${n} < 5 min`,
    "check.cycling.col_stop": "Why it stopped",
    "check.cycling.stop_low_flow": "Flow temp above target · low flow",
    "check.cycling.stop_low_rps": "Flow temp above target · low speed",
    "check.cycling.stop_req_off": "Heating request ended",
    "check.cycling.stop_tgt_drop": "Target temperature lowered",
    "check.cycling.stop_defrost": "Paused for defrost",
    "check.cycling.stop_defrost_done": "Defrost completed",
    "check.cycling.stop_dhw": "Switched to hot water",
    "check.cycling.stop_normal_dhw": "Hot water run ended",
    "check.cycling.stop_normal": "Normal stop",
    "check.cycling.out_cond": (v) => ` (${v} outside)`,
    "check.cycling.find_low_flow": (minFlow, typ) => `Short runs, low flow: flow above target in minutes at ${minFlow}${typ}.`,
    "check.cycling.find_low_rps": (flow, cond) => `Short runs, low speed${cond}: flow above target soon after start (${flow}).`,
    "check.cycling.find_control": "Control stop: request off or target lowered.",
    "check.cycling.find_defrost_dhw": (cond) => `Defrost & DHW${cond}: heating paused for defrost and DHW.`,
    "check.cycling.find_defrost": (cond) => `Defrost${cond}: heating paused for outdoor defrost.`,
    "check.cycling.find_dhw": "DHW: heating paused for hot water.",
    "check.cycling.find_steady": (flow) => flow ? `Steady heating: min. ${flow}.` : "Steady heating.",
    "check.cycling.pause_tag": (d) => ` after ${d} pause`,
    "check.cycling.cond_tag": (lwt, tgt) => tgt ? `flow ${lwt}, target ${tgt}` : `flow ${lwt}`,
    "check.cycling.from_tag": (prev) => ` from ${prev}`,
    "check.cycling.rwt_tag": (rwt) => `return ${rwt}`,
    "check.cycling.typ_tag": (typ) => `, typ. ${typ}`,
    "check.cycling.s_cool": (at, pause, lwt, tgt) => `Started ${at}${pause}: flow ${lwt}, target ${tgt}, request on.`,
    "check.cycling.s_req": (at, pause, cond) => `Started ${at}${pause} on request${cond}.`,
    "check.cycling.s_tgt": (at, pause, prev, tgt, cond) => `Started ${at}${pause}: target raised${prev} to ${tgt}${cond}.`,
    "check.cycling.s_defrost_after": (at, pause, cond) => `Resumed ${at}${pause} following defrost${cond}.`,
    "check.cycling.s_dhw_after": (at, pause, cond) => `Resumed ${at}${pause} following hot water${cond}.`,
    "check.cycling.s_defrost": (at, pause) => `Started ${at}${pause} for defrost.`,
    "check.cycling.s_dhw": (at, pause, cond) => `Started ${at}${pause} for hot water${cond}.`,
    "check.cycling.s_gen": (at, pause, cond) => `Started ${at}${pause}${cond}.`,
    "check.cycling.e_low_flow": (to, lwt, tgt, rwt, flow, typ) => `Stopped ${to}: flow ${lwt} above target ${tgt}${rwt} at ${flow}${typ}.`,
    "check.cycling.e_low_rps": (to, lwt, tgt, rwt, flow, rps) => `Stopped ${to}: flow ${lwt} above target ${tgt}${rwt} at ${flow} and ${rps}.`,
    "check.cycling.e_req": (to, vals) => `Stopped ${to}: request off${vals}.`,
    "check.cycling.e_tgt": (to, prev, tgt, vals) => `Stopped ${to}: target lowered${prev} to ${tgt}${vals}.`,
    "check.cycling.e_defrost_run": (to, vals) => `Defrost ended ${to}${vals}.`,
    "check.cycling.e_defrost_pause": (to, vals) => `Stopped ${to} for defrost${vals}.`,
    "check.cycling.e_dhw": (to, vals) => `Stopped ${to}: switched to hot water${vals}.`,
    "check.cycling.e_norm": (to, vals) => `Ended ${to}${vals}.`,
    "check.cycling.e_ongoing": "Still running at last sample.",
    "check.cycling.cause_unavailable": "No cause details",
    "check.cycling.cause_older_unavailable": "No saved start or stop details are available for these older runs.",
    "check.heater_context.categories": "emergency flag|error status|defrost/recovery|hot-water route|Silent Mode flag|outdoor ≤+2°C|outdoor >+2°C|compressor reported stopped|Silent Mode + mild heating",
    "check.heater_context.notice": "Provisional project notice: ≥15 min reported ON with Silent Mode, heating and outdoor >+2°C.",
    "check.heater_insp.runtime": "Reported ON time (24 h)",
    "check.heater_insp.zero": "No ON time reported in the last 24 h.",
    "check.heater_insp.zero_cov": (d) => `No ON time reported across ${d} of observation in the last 24 h.`,
    "check.heater_insp.active": "Reported active during the last 24 h.",
    "check.heater_insp.active_cov": (d) => `Reported active during ${d} of observation in the last 24 h.`,
    "check.heater_insp.active_ctx": (list) => `Co-occurred with: ${list}.`,
    "check.heater_insp.active_unclassified": "Reported active during the last 24 h without a classified context.",
    "check.heater_insp.active_unclassified_cov": (d) => `Reported active during ${d} of observation in the last 24 h without a classified context.`,
    "check.heater_insp.archive_incomplete": "24 h context archive is incomplete.",
    "check.heater_insp.stale": "Current readings are missing or stale.",
    "check.heater_insp.limit": "Flag duration is not electrical energy and does not establish cause or necessity; missing or between-sample signals remain unknown.",
    "check.heater_insp.waiting": "Waiting for 24 h heater observations.",
    "check.heater_insp.unavailable": "24 h heater diagnosis is unavailable for this source.",
    "check.min": (m) => `${m} min`,
    "check.hour.latest": "Latest interval",
    "check.hour.earlier": (h) => `${h} h earlier`,
    "check.hour.other": "Other / unknown",
    "check.hour.gap": "Sampling gap",
    "check.hour.coverage": (observed, possible) => possible ? `${observed} of ${possible} observed` : `${observed} observed · elapsed time unknown`,
    "check.hour.ending": (time) => `Interval end ${time}`,
    "check.hour.saved": (time) => `Saved time ${time}`,
    "check.fault_err": "Fault active", "check.fault_warn": "Warning active",
    "check.fault_past": "Previously active", "check.fault_none": "None active",
    "check.fault_unknown": "Unknown",
    "check.fault_past_unknown": "Past · unknown",
    "check.fault_since_short": (d) => `for ${d}`,
    "check.fault_ago_short": (d) => `${d} ago`,
    "check.fault_hero_ok": (d) => `No fault or warning reported in ${d} of 24 h observation.`,
    "check.fault_latched_only": "Stored fault flag reported by the heat pump; no timestamped episode fell within the recorded 24 h window.",
    "check.fault_unit_outdoor": "Outdoor unit",
    "check.fault_unit_indoor": "Indoor unit",
    "check.fault_unit_both": "Outdoor + indoor",
    "check.fault_secondary": (s) => `Also active: ${s}`,
    "check.fault_stop_ongoing": "active",
    "check.fault_stop_unknown": "unclear",
    "check.fault_col_code": "Code",
    "check.fault_col_meaning": "Meaning",
    "check.fault_ok_label": "Fault-free",
    "check.fault_gap_label": "Unmeasured",
    "check.fault_severity_caution": "Caution",
    "check.retry_seen": "Increase", "check.retry_none": "No increase",
    "check.retry_hero_none": (d) => `None of the five protection counters increased during ${d} of comparable observation.`,
    "check.retry_hero_none_short": "None of the five protection counters increased in comparable readings.",
    "check.retry_hero_seen": (d) => `Protection-counter increase recorded during ${d} of comparable observation.`,
    "check.retry_hero_seen_short": "Protection-counter increase recorded in comparable readings.",
    "check.retry_hero_collecting": "Waiting for consecutive readable readings of all five counters and the compressor state.",
    "check.retry_counters_legacy": "At least one counter increased, but this snapshot does not identify which one.",
    "check.retry_monitored": "Monitored protection areas",
    "check.retry_counter.discharge_temp": "Discharge temp.",
    "check.retry_counter.inv_current": "Inverter current",
    "check.retry_counter.high_pressure": "High pressure",
    "check.retry_counter.low_pressure": "Low pressure",
    "check.retry_counter.fin_temp": "Inverter heatsink",
    "service.flow.comp": "1. Compressor",
    "service.flow.high": "2. High side",
    "service.flow.valve": "3. Valve",
    "service.flow.low": "4. Low side",
    "service.stage.comp": "1. Compressor",
    "service.stage.high": "2. High-pressure side",
    "service.stage.valve": "3. Expansion valve",
    "service.stage.low": "4. Low-pressure side",
    "service.metric.comp": "Compressor",
    "service.metric.disch": "Discharge temperature",
    "service.metric.eev": "Expansion-valve command",
    "service.metric.hp": "High pressure",
    "service.metric.lp": "Low pressure",
    "check.hydronic.agree_labels": "Pump-only R1T−R4T|Pump-only R2T−R1T|Agreement status|Agreement limits",
    "check.hydronic.agree_reasons": "Flow below 5.0 l/min|Compressor running|Heater active or ambiguous|3-way valve changed|Temperatures not stationary",
    "check.hydronic.agree_limits": "R2T unavailable|DHW route included",
    "check.hydronic.agree_meta": "windows|readings|Passive agreement only; not calibration; external heat not excluded.",
    "service.metric.range": (a, b, c, d) => `min ${a} · mean ${b} · max ${c} ${d}`,
    "service.metric.mean": (v, u) => `mean ${v} ${u}`,
    "service.metric.minmax": (a, b, u) => `min ${a} · max ${b} ${u}`,
    "service.metric.samples": (n) => `${n} accepted ${n === 1 ? "reading" : "readings"}`,
    "service.metric.input_none": "No selected input",
    "service.metric.meta_limit": "Counts are accepted readings, not time coverage. A selected input does not prove a current reading.",
    "service.eev.note": "Command only · not measured position",
    "service.limits.title": "Reading counts & limits",
    "service.limit.special_phases_unavailable": "Controller phase signals",
    "service.limit.temperature_context_incomplete": "Suction/liquid temperatures",
    "service.limit.pressure_sides_incomplete": "Both pressure sides",
    "service.limit.outdoor_context_incomplete": "Outdoor air/coil temperatures",
    "service.row.limits": "Incomplete context:",
    "check.detail.period_label": "Data window:",
    "check.detail.period": (a) => `${a}, at most 24 h; possible gaps`,
    "check.detail.age_label": "Last sample age:",
    "check.detail.fault.ok": "No current or retained message in readable fault signals.",
    "check.defrost.normal": "Short defrost cycles are expected in cold, damp weather. The defrost share shows how much of the compressor runtime with a readable defrost signal went into defrosting.",
    "check.defrost.modbus.about": "Modbus reports defrost and compressor restart preparation on one signal.",
    "check.defrost.modbus.normal": "The signal is off during steady operation. Either phase can turn it on.",
    "check.defrost.starts_label": "Observed defrost starts",
    "check.defrost.share": "Defrost share",
    "check.defrost.notice": "High defrost share",
    "check.detail.pressure.info": "Low",
    "check.detail.pressure.warn": "Critical",
    "check.detail.pressure.ok": "Normal",
    "check.pressure.finding": "Confirmed finding",
    "check.pressure.sustained": (a) => `At or below ${a} for at least 60 consecutive seconds.`,
    "check.pressure.clear": "No sustained low pressure confirmed.",
    "check.pressure.rules": "How is pressure assessed?",
    "check.pressure.unavailable": "X10A pressure diagnosis unavailable.",
    "check.pressure.pending": "Reading in the critical range. Duration is still unknown.",
    "check.detail.source_stale": "No fresh X10A sample; current state unknown. History retained.",
    "check.detail.current_label": "≤1.0 bar low",
    "check.detail.minimum_time_label": "≤0.5 bar critical",
    "check.detail.coverage_missing": (a) => `Missing readable time: ${a} s.`,
    "values.waiting": "Waiting for the first poll…",
    "values.sg_x10a_mode": "Smart-Grid mode (X10A contacts)",
    "group.Operation": "Operation", "group.Domestic hot water": "Domestic hot water",
    "group.Water circuit": "Water circuit", "group.Refrigerant / outdoor": "Refrigerant / outdoor",
    "group.Electrical": "Electrical", "group.Device": "Device", "group.Other values": "Other values",
    "group.Protection": "Protection",
    "group.Values": "Values",
    "state.on": "ON", "state.off": "OFF",
    // HomeHub enum names from EKRHH 4P744838-1E §9.2. APIs/MQTT keep the raw numeric constants;
    // the browser applies these names only at the visual boundary.
    "enum.auto": "Auto", "enum.heating": "Heating", "enum.cooling": "Cooling",
    "enum.no_error": "No error", "enum.fault": "Fault", "enum.warning": "Warning",
    "enum.space_heating": "Space heating", "enum.dhw": "DHW",
    "enum.free_running": "Free running", "enum.forced_off": "Forced off",
    "enum.recommended_on": "Recommended on", "enum.forced_on": "Forced on",
    "enum.space_cooling": "Space cooling",
    "enum.none": "None",
    "enum.reduced": "Reduced",
    "enum.automatic": "Automatic",
    "enum.manual": "Manual",
    "enum.actuator": "Actuator",
    "enum.tank_heat_up": "Tank heat-up",
    "a4.quiet_selection": "Quiet mode selection",
    "a4.heating_offset": "Weather-dependent heating offset, main zone",
    "a4.imposed_power_limit": "Imposed power limit",
    "a4.pre_phe_outdoor": "Water temperature before outdoor plate heat exchanger",
    "a4.main_target": "Heating/cooling target, main zone",
    "a4.quiet_help": "Selects Off, Automatic or Manual quiet operation. It does not report current quiet activity; the selected level or schedule can still be Off.",
    "a4.current_help": "Reports None, Heating or Cooling for space conditioning. Read it with the normal-operation flag; it does not prove that the compressor is running.",
    "a4.limit_help": "The imposed electrical power limit, not measured consumption. Protective operation can exceed this setting.",
    "a4.demand_help": "Reports Free, Forced off, Forced on, Recommended on or Reduced demand response. These numeric codes differ from the configured Smart Grid selection.",
    "a4.operation_help": "Reports Stop, Tank heat-up, Space heating, Space cooling or Actuator operation. This is a reported state, not proof of useful heat transfer.",
    "a4.heating_offset_help": "Adjusts the main-zone weather-dependent heating curve in kelvin. This is an offset, not a measured temperature or the complete water-temperature target.",
    "a4.pre_phe_outdoor_help": "Water temperature before the outdoor plate heat exchanger. This is a water-side sensor, not the outside-air or refrigerant temperature.",
    "a4.flow_help": "Altherma 4 flow scaling is not verified. The displayed L/min value uses the existing conversion; compare it with the unit's own reading before judging performance.",
    "a4.pump_help": "The Altherma 4 guide names pump speed but lists L/min. The % unit shown here is an unverified assumption; compare with the unit's own reading.",
    "a4.pressure_help": "Altherma 4 pressure scaling is not verified. The displayed bar value uses the existing conversion; compare it with the unit's own reading before judging pressure.",
    "a4.demand_response": "Demand response mode",
    "a4.unit_operation": "Unit operating state",
    "a4.cooling_offset": "Weather-dependent cooling offset, main zone",
    "a4.add_target": "Heating/cooling target, additional zone",
    "a4.abnormality_counter": "User abnormality counter",
    "a4.cooling_offset_help": "Adjusts the main-zone weather-dependent cooling curve in kelvin. This is an offset, not a measured temperature or the complete water-temperature target.",
    "a4.abnormality_help": "Cumulative count of user-facing abnormalities recorded by the unit. An unchanged non-zero value reflects past events, not an active fault; check Unit abnormality and its fault code for the current state.",
    "enum.unknown": (n) => `Unknown (${n})`,
    "chip.space_on": "Space H/C ON", "chip.space_off": "Space H/C OFF", "chip.quiet": "Quiet",
    "schem.sg_boost": "BOOST",
    "sg.mode0": "Free running", "sg.mode1": "Forced off",
    "sg.mode2": "Recommended on", "sg.mode3": "Forced on",
    "schem.to_dhw": "3WV → DHW", "schem.to_space": "3WV → space",
    "normal.label": "Normal:",
    "meaning.label": "How to read it:",
    "hist.title": "Last 24 hours", "hist.recorded": (h) => `Recorded · ${h} h`,
    "hist.now": "now", "hist.ago": (h) => `${h} h ago`,
    "hist.retained": "Last received sample",
    "hist.before_retained": (h) => `${h} h before the last received sample`,
    "hist.loading": "Loading trend…", "hist.none": "No readings recorded yet.",
    "hist.err": "Trend unavailable.",
    "hist.gaps": (n) => `${n} gap${n === 1 ? "" : "s"} — not measured`,
    "hist.nm": "not measured", "hist.rel": (h) => `${h} h ago`,
    "hist.held": "outdoor unit resting", "hist.heldnote": (h) => `${h} h resting — not measured`,
    "hist.aria": (l) => `${l} — 24-hour trend. Arrow keys read out individual samples.`,
    "hist.aria_pinned": (l, r) => `${l} — 24-hour trend. Pinned readout: ${r}. Tap it again to clear.`,
    "hist.pin_hint": "tap to pin",
    "hist.duration_min": (m) => `${m} min`, "hist.duration_h": (h) => `${h} h`,
    "hist.duration_hm": (h, m) => `${h} h ${m} min`,
    // Sub-minute tier, used by the per-row state age alone: a trend raster is five minutes wide, but
    // a flag that switched twenty seconds ago is exactly the case someone is looking at.
    "hist.duration_sec": (s) => `${s} s`,
    "hist.state_phase_run": (state, when, d) => `${state}\n${when} · approx. ${d}`,
    "hist.state_active": "Active", "hist.state_off": "Off",
    // HOW LONG A SWITCHED ROW HAS READ WHAT IT READS. `val.since_min` is not a softer wording of
    // `val.since` — it is a WEAKER CLAIM, and the two must never be interchangeable: the board saw
    // the state arrive in the first, and only found it already standing in the second. `val.since_gap`
    // names the part of the run the bus did not answer for, during which a flag could have pulsed and
    // returned unseen.
    "val.since": (d) => `for ${d}`,
    "val.since_min": (d) => `\u2265 ${d}`,
    "val.since_gap": (d) => `${d} of it not observed`,
    "hist.modbus_plateau": (when, d) => `register unchanged ${when} · approx. ${d} · measurement age unknown`,
    "hist.boost_total": (d) => `Boost active · ${d}`,
    "hist.boost_none": "No Boost in the recorded period.",
    "hist.boost_ago_range": (a, b) => `${a}–${b} h ago`,
    "hist.boost_active": "Boost active", "hist.boost_inactive": "Boost off",
    "hist.boost_aria": (l, d) => `${l} — Smart-Grid state timeline with all four modes. ${d}. Arrow keys read individual samples.`,
    "hist.defrost_total": (d) => `5-minute blocks with defrost · ${d}`,
    "hist.defrost_none": "No defrost cycle observed in the recorded period.",
    "hist.defrost_active": "Defrost active", "hist.defrost_inactive": "Defrost off",
    "hist.defrost_aria": (l, d) => `${l} — defrost timeline. ${d}. Arrow keys read individual samples.`,
    "hist.quiet_total": (d) => `Quiet mode observed active · ${d} sampled raster time`,
    "hist.quiet_none": "No quiet-mode interval observed in the recorded period.",
    "hist.quiet_active": "Quiet mode active", "hist.quiet_inactive": "Quiet mode off",
    "hist.quiet_aria": (l, d) => `${l} — quiet-mode timeline. ${d}. Arrow keys read individual samples.`,
    "hist.heater_total": (d) => `Heater observed active · ${d} sampled raster time`,
    "hist.heater_none": "No tank-heater use observed in the recorded period.",
    "hist.heater_active": "Heater active", "hist.heater_inactive": "Heater off",
    "hist.heater_aria": (l, d) => `${l} — tank-heater timeline. ${d}. Arrow keys read individual samples.`,
    "hist.preheat_total": (d) => `Tank preheat observed active · ${d} sampled raster time`,
    "hist.preheat_none": "No tank-preheat interval observed in the recorded period.",
    "hist.preheat_active": "Tank preheat active", "hist.preheat_inactive": "Tank preheat off",
    "hist.preheat_aria": (l, d) => `${l} — X10A tank-preheat timeline. ${d}. Arrow keys read individual samples.`,
    "hist.disinfection_total": (d) => `Disinfection observed active · ${d} sampled raster time`,
    "hist.disinfection_none": "No disinfection operation observed in the recorded period.",
    "hist.disinfection_active": "Disinfection active", "hist.disinfection_inactive": "Disinfection off",
    "hist.disinfection_aria": (l, d) => `${l} — HomeHub disinfection timeline. ${d}. Arrow keys read individual samples.`,
    "hist.buh_total": (d) => `Backup heater observed active · ${d} sampled raster time`,
    "hist.buh_none": "No backup-heater use observed in the recorded period.",
    "hist.buh_active": "Backup heater active", "hist.buh_inactive": "Backup heater off",
    "hist.buh_step1": "Step 1", "hist.buh_step2": "Step 2",
    "hist.buh_aria": (l, d) => `${l} — backup-heater timeline. ${d}. Arrow keys read individual samples.`,
    "hist.valve_dhw_total": (d) => `DHW · ${d}`, "hist.valve_space_total": (d) => `Space circuit · ${d}`,
    "hist.valve_none": "No DHW position in the recorded period.",
    "hist.valve_dhw": "DHW", "hist.valve_space": "Space circuit",
    "hist.valve_aria": (l, d) => `${l} — 3-way-valve timeline. ${d}. Arrow keys read individual samples.`,
    "hist.circ_total": (d) => `Pump observed running · ${d} sampled raster time`,
    "hist.circ_none": "No pump run observed in the recorded period.",
    "hist.circ_on": "Running", "hist.circ_off": "Stopped",
    "hist.circ_unavailable": "Unavailable",
    "hist.circ_gaps": (n) => `${n} unavailable interval${n === 1 ? "" : "s"}`,
    "hist.circ_aria": (l, d) => `${l} — circulation-pump timeline. ${d}. Arrow keys read individual samples.`,
    "hist.valve2_on_total": (d) => `2WV output ON · ${d}`,
    "hist.valve2_off_total": (d) => `2WV output OFF · ${d}`,
    "hist.valve2_on": "2WV output ON", "hist.valve2_off": "2WV output OFF",
    "hist.valve2_none": "No ON state recorded for the 2-way-valve output in the selected period.",
    "hist.valve2_aria": (l, d) => `${l} — 2-way-valve output timeline. ${d}. Arrow keys read individual samples.`,
    "hist.flow_switch_total": (d) => `X10A status ON · ${d} sampled raster time`,
    "hist.flow_switch_on": "X10A status ON", "hist.flow_switch_off": "X10A status OFF",
    "hist.flow_switch_none": "No ON state recorded for this X10A status in the selected period.",
    "hist.flow_switch_aria": (l, d) => `${l} — water-flow-switch timeline. ${d}. Arrow keys read individual samples.`,
    "hist.comp_total": (d, n) => `Compressor · ${d} · ${n} ${n === 1 ? "phase" : "phases"}`,
    "hist.comp_none": "No compressor operation observed in the recorded period.",
    "hist.comp_active": "Compressor running", "hist.comp_inactive": "Compressor off",
    "hist.comp_aria": (l, d) => `${l} — HomeHub compressor timeline. ${d}. Use arrow keys to read individual samples.`,
    "hist.mb_defrost_total": (d) => `Defrost / restart · ${d}`,
    "hist.mb_defrost_none": "No defrost or restart phase observed in the recorded period.",
    "hist.mb_defrost_active": "Defrost / restart", "hist.mb_defrost_inactive": "Normal / idle",
    "hist.mb_defrost_aria": (l, d) => `${l} — HomeHub defrost/restart timeline. ${d}. Use arrow keys to read individual samples.`,
    "hist.pump_total": (d) => `Pump · ${d}`,
    "hist.pump_none": "No circulation-pump operation observed in the recorded period.",
    "hist.pump_active": "Pump running", "hist.pump_inactive": "Pump off",
    "hist.pump_aria": (l, d) => `${l} — HomeHub circulation-pump timeline. ${d}. Use arrow keys to read individual samples.`,
    "toast.saved": "Saved", "toast.no_changes": "No changes",
    "toast.reboot": "Rebooting — reconnecting…", "toast.rebooted": "Rebooted — reconnect to the device",
    "board.draft_stale": "Board settings changed. Reopen the editor before saving.",
    "toast.busy_retry": "Device busy — retry in a moment", "toast.unreachable": "Couldn't reach the device",
    "toast.rejected": "Rejected", "toast.applying": "Still applying the last change…",
    "toast.check_wifi": "Check WiFi settings", "toast.check_broker": "Check the broker address",
    "toast.check_syslog_port": "Check the Syslog port",
    "toast.verifying_mqtt": "Verifying MQTT connection…", "toast.saving_syslog": "Saving Syslog settings…",
    "toast.saving_ntp": "Saving NTP settings…", "toast.trying_pins": "Trying pins…",
    "toast.saving_board": "Saving board hardware…",
    // OTA status shown INLINE beside the header version (#otaStat) — short by design: it shares one
    // line with the IP and the version, so these read as a suffix, not as sentences.
    "ota.uptodate": "up to date", "ota.check_failed": "check failed", "ota.starting": "starting…",
    "ota.pct": (p) => `${p}%`, "ota.rebooting": "rebooting…", "ota.failed": "update failed",
    "ota.timeout": "timed out", "ota.cancelled": "cancelled", "ota.busy": "device busy",
    "ota.replaced": "update operation changed — check again",
    "ota.unreachable": "device unreachable",
    "ota.active_title": "Firmware update", "ota.active_sub": (detail) => `Installation in progress · ${detail}`,
    "ota.active_sub_cached": (detail) => `Installation in progress · ${detail} · last received state`,
    "ota.snapshot_title": "Firmware update", "ota.snapshot_label": "Data state",
    "ota.snapshot_value": "Snapshot",
    "ota.snapshot_help": "Last received state before this reload. Live data may pause during installation; settings stay locked until restart.",
    // The install finished; only the automatic page reload gave up waiting for the board.
    "ota.reload_hint": "installed — reload the page",
    "ota.dialog_title": "Firmware update", "ota.switch_title": "Switch firmware version",
    "ota.changes_title": "Changes in this update",
    "ota.no_changes": "No changelog was supplied for this update.",
    "ota.install_help": "The device downloads and installs the signed image, then restarts. If the new firmware cannot get online, the device automatically restores the current build.",
    "ota.switch_help": "This build is older because a different update channel is selected. Its signature is verified before installation, and the device automatically restores the current build if the older one cannot get online.",
    "ota.install": "Install update", "ota.switch": "Install older build",
    "aria.ota": "Check for firmware updates",
    "ota.title_check": "Tap to check for firmware updates",
    "ota.title_avail": (v) => `Update v${v} available — tap to install`,
    "mq.err_format": "Enter host:port — e.g. 192.168.1.10:1883 — or mqtts://host:8883 for TLS",
    "sl.err_port": "Port must be a whole number 1–65535 (e.g. logs.example.com:514).",
    "btn.saving": "Saving…", "btn.verifying": "Verifying…", "btn.save": "Save",
    "btn.cancel": "Cancel", "btn.close": "Close",
    // static index.html markup (data-i18n)
    "schem.card_aria": "Live system schematic: outdoor unit, refrigerant circuit, plate heat exchanger, water circuit with backup heater and 3-way valve, domestic hot water tank and space circuit",
    "schem.group_aria": "Live system schematic — tap a value or component for an explanation",
    "schem.outdoor_unit": "OUTDOOR UNIT", "schem.defrost_pill": "defrost", "schem.outdoor": "Outdoor",
    "insp.close": "Close",
    "schem.defrost_transfer": "During confirmed defrost, heat can move from the water into the refrigerant. The pipes show that direction only when current circulation and temperatures support it.",
    "schem.leaving_water": "R1T", "schem.dhw_tank": "DHW TANK", "schem.set": "set",
    "schem.bsh_label": "E-heater",
    "schem.space_circuit": "SPACE CIRCUIT", "schem.heating": "HEATING", "schem.cooling": "COOLING",
    "schem.pump": "PUMP", "schem.return": "R4T", "schem.room": "Room",
    "schem.flow_rate": "flow", "schem.water_press": "water pressure",
    "schem.r2t": "R2T", "schem.r3t": "R3T",
    "schem.flow_switch": "Flow switch", "schem.valve2": "2WV",
    "wifi.title": "WiFi configuration", "wifi.ssid": "WiFi network (SSID)", "wifi.pass": "WiFi password",
    "wifi.err_ssid": "SSID must be 1–32 UTF-8 bytes",
    "wifi.err_pass": "Password must be empty (open network) or 8–63 UTF-8 bytes",
    "wifi.hint": "Enter the WiFi network name. If the device cannot connect, it restores the previous WiFi settings automatically.",
    "mqtt.title": "MQTT broker", "mqtt.hostport": "Host : port", "mqtt.user": "Username · optional",
    "mqtt.pass": "Password · optional", "mqtt.clear": "Remove stored credentials — connect anonymously",
    "mqtt.hint": "A username or password requires an encrypted TLS connection (mqtts://, for example mqtts://host:8883). Leave the host empty to disable MQTT.",
    "mqtt.base": "Base topic",
    "mqtt.base_hint": "One base topic per device. A second board on this broker needs its own, or the two share their topics, their metrics and their Home Assistant device. Changing it renames this installation in Home Assistant and leaves the old retained topics behind on the broker.",
    "err.mqtt_base_too_long": "Base topic is too long.",
    "err.mqtt_base_wildcard": "A base topic cannot contain + or # — those are subscription wildcards, and a broker refuses to publish to them.",
    "err.mqtt_base_reserved": "A base topic cannot start with $ — that tree belongs to the broker itself.",
    "err.mqtt_base_slash": "A base topic cannot start or end with a slash.",
    "err.mqtt_base_control": "A base topic cannot contain control characters.",
    "err.mqtt_base_space": "A base topic cannot contain spaces.",
    "err.mqtt_base_empty_segment": "A base topic cannot contain an empty segment (//).",
    "err.mqtt_base_not_sluggable": "A base topic needs at least one letter or digit — it becomes this installation's Home Assistant device id, and without one two devices would collide.",
    "mqtt.err.waiting_x10a": "No heat-pump response on X10A yet — check wiring, GND and the RX/TX pins.",
    "mqtt.err.task_alloc": "The MQTT task could not be started — restart the device and check diagnostics.",
    "mqtt.err.transport": "TLS/TCP connection to the broker failed.",
    "mqtt.err.refused": "The broker refused the connection — check username and password.",
    "mqtt.err.connection": "Connection to the MQTT broker failed.",
    "dyn.state_gate": "Plant state unknown", "dyn.state_mode": "Heating/cooling mode unknown",
    "env.title": "Outdoor sensor", "env.card": "Outdoor climate", "env.none": "No sensor",
    "env.temperature": "Temperature", "env.humidity": "Humidity", "env.pressure": "Air pressure",
    "env.sensor_state": "Sensor", "env.live": "Live", "env.collecting": "Collecting…",
    "env.history_title": "ENV III measurements",
    "env.history_help": "Temperature, humidity and air pressure are retained on the ESP32 as rolling 24-hour trends at five-minute intervals.",
    "env.history_scales": "individual scales",
    "env.unavailable": "Sensor unavailable", "env.err_pins": "SDA and SCL must be different valid pins",
    "env.saving": "Saving outdoor-sensor configuration…", "env.checking": "Checking ENV III…",
    "env.err_not_reachable": "ENV III is not currently reachable on these SDA/SCL pins.",
    "env.err_sht30": "The ENV III temperature/humidity sensor is not reachable on these pins.",
    "env.err_qmp6988": "The ENV III pressure sensor is not reachable on these pins.",
    "env.err_disable_first": "Select No sensor and save before changing the SDA/SCL pins.",
    "env.pins_hint": "SDA = data (yellow Grove wire); SCL = clock (white Grove wire). If the two selected GPIOs are reversed, the firmware verifies the opposite order and saves the working assignment automatically.",
    "env.atoms3_header_hint": "AtomS3 Lite: use two offered pins — the case header carries GPIO5–GPIO8 and GPIO38. The Grove port (GPIO2/1) appears only while the X10A link is not on it: one pad cannot carry both the serial link and the I2C bus. GPIO39 is unavailable for ENV III.",
    "circ.title": "Circulation-pump source", "circ.row": "DHW circulation pump",
    "circ.default_name": "Circulation pump", "circ.name": "Name", "circ.topic": "MQTT topic",
    "circ.power_path": "Power JSON path", "circ.time_path": "Timestamp JSON path",
    "circ.power_help": "Actual active power in watts; the relay output is not used.",
    "circ.time_help": "Measurement time as RFC3339 or Unix seconds.",
    "circ.on_threshold": "ON from · W", "circ.off_threshold": "OFF through · W",
    "circ.max_age": "Maximum age · seconds", "circ.confirm": "Confirmation · seconds",
    "circ.hint": "Read-only. Saving first tests one fresh MQTT value and never switches the plug.",
    "circ.settings_help": "The board correlates actual pump power with clean one-hour tank-cooling windows. It only observes and never switches the plug.",
    "circ.not_configured": "Not configured", "circ.unavailable": "Unavailable",
    "circ.broker_off": "No MQTT broker",
    "circ.running": "Running", "circ.stopped": "Stopped", "circ.checking": "Checking",
    "circ.stale": "Stale", "circ.waiting": "Waiting for a message",
    "circ.detail.source": "Source", "circ.detail.power": "Active power",
    "circ.detail.state": "Detected state", "circ.detail.age": "Measurement age",
    "circ.delete": "Delete", "circ.deleting": "Deleting…", "circ.deleted": "Circulation-pump source deleted",
    "circ.saved": "Circulation-pump source saved", "circ.test_failed": "No readable, fresh pump-power value received",
    "circ.err_topic": "Enter an exact MQTT topic without + or # wildcards",
    "circ.err_power_path": "Enter the active-power JSON path, for example apower",
    "circ.err_time_path": "Enter the timestamp JSON path, for example aenergy.minute_ts",
    "circ.err_max_age": "Maximum age must be a whole number between 10 and 3600 seconds",
    "circ.err_confirm": "Confirmation must be a whole number between 1 and 600 seconds",
    "circ.err_threshold": "Power thresholds must use at most one decimal place",
    "circ.err_order": "The ON threshold must be greater than the OFF threshold",
    "syslog.title": "Syslog server", "syslog.hostport": "Host : port",
    "syslog.hint": "Enter the Syslog server as hostname or IP address plus port. Leave the field empty to disable Syslog.",
    "ntp.title": "NTP server", "ntp.server": "Server",
    "ntp.hint": "Enter the hostname or IP address of the time server. Leave the field empty to use the firmware default.",
    // HomeHub transport dialog (issue legacy-32). It exposes no actuator control; the link is read-only,
    // because the Modbus link is read-only (docs/MODBUS_PROTOCOL.md).
    "homehub.title": "Modbus", "homehub.host": "Host · IP or .local name",
    "homehub.port": "Port", "homehub.unit": "Unit id",
    "homehub.hint": "Fresh firmware searches once automatically on its first networked start and saves the result. Search can be run manually here as well. Save the result or enter an address manually. Saving an empty address disables HomeHub permanently: no future automatic search, no Modbus requests and no dependent diagnosis. Port defaults to 502, unit id to 1. This dialog configures the data source only; it exposes no heat-pump control.",
    "hh.search": "Search", "hh.searching": "Searching…",
    "hh.found": (host) => `HomeHub found: ${host}`, "hh.not_found": "No HomeHub found — enter the address manually.",
    "hh.saved": "Modbus settings saved",
    "hh.err_port": "Port must be between 1 and 65535",
    "hh.err_unit": "Unit id must be between 1 and 247",
    "board.title": "Board hardware", "board.ledtype": "Status LED", "board.none": "None",
    "board.reset_section": "Reset button", "board.env3_section": "ENV III · Outdoor sensor",
    "board.preset": "Board", "board.preset_custom": "Custom", "board.not_selected": "Not selected",
    "board.led_gpio": "Plain LED (GPIO)", "board.led_ws2812": "Addressable RGB (WS2812)",
    "board.ledpin": "LED pin", "board.btnpin": "Reset button pin",
    "board.ledlegend_rgb": "LED colours and blink patterns",
    "board.ledlegend_gpio": "LED blink patterns",
    "board.led_rgb_off": "Off — no network active.",
    "board.led_rgb_setup": "Blue, blinking slowly — setup portal active.",
    "board.led_rgb_connecting": "Yellow, blinking quickly — connecting to the network.",
    "board.led_rgb_healthy": "Green, solid — X10A and, if configured, MQTT connected.",
    "board.led_rgb_bus_down": "Red, double flash — X10A disconnected or recovery mode.",
    "board.led_rgb_mqtt_down": "Orange, blinking — X10A connected, MQTT disconnected.",
    "board.led_rgb_wipe_armed": "Red, blinking very quickly — erase armed; release to abort.",
    "board.led_rgb_wiping": "White, solid — factory reset/data erase in progress; do not disconnect power.",
    "board.led_gpio_off": "Off — no network active.",
    "board.led_gpio_setup": "Blinking slowly — setup portal active.",
    "board.led_gpio_connecting": "Blinking quickly — connecting to the network.",
    "board.led_gpio_healthy": "Solid — X10A and, if configured, MQTT connected.",
    "board.led_gpio_bus_down": "Double flash — X10A disconnected or recovery mode.",
    "board.led_gpio_mqtt_down": "Blinking at medium speed — X10A connected, MQTT disconnected.",
    "board.led_gpio_wipe_armed": "Blinking very quickly — erase armed; release to abort.",
    "board.led_gpio_wiping": "Solid after very rapid blinking — factory reset/data erase in progress; do not disconnect power.",
    "board.ledinv": "Active low (LED lights when the pin is driven LOW)",
    "board.btninv": "Active low (button shorts the pin to GND)",
    "board.hint": "Factory reset: hold for 5 seconds. If the history journal is not ready, nothing is erased. A reset clears Wi-Fi and other settings, recorded history, state durations, the raw crash dump and the MQTT cleanup record. Board, LED and button settings are kept if possible. A failed erase can leave a partial wipe. The device restarts only after all erases succeed. See /diag if the reset does not start or finish. Select “None” if no button is connected.",
    "card.hardware": "Hardware",
    "card.hw_led": (pin, kind) => `GPIO${pin} · ${kind}`, "card.hw_btn": (pin) => `GPIO${pin}`,
    "card.hw_board_m5stack": "M5Stack AtomS3 Lite is a compact ESP32-S3 board with an onboard WS2812 RGB status LED.",
    "card.hw_board_seeed": "Seeed XIAO ESP32-S3 is a compact ESP32-S3 board from Seeed Studio.",
    "card.hw_board_other": (name) => `Selected board: ${name}.`,
    "card.hw_active_low": "active LOW", "card.hw_active_high": "active HIGH",
    "card.hw_led_detail": (kind, pin, active) => `${kind} on GPIO${pin}${active ? `, ${active}` : ""}.`,
    "card.hw_led_disabled": "Not configured.",
    "card.hw_btn_detail": (pin, active) => `GPIO${pin}, ${active}.`,
    "card.hw_btn_disabled": "Not configured.",
    "card.hw_env_detail": (sda, scl) => `SDA on GPIO${sda}, SCL on GPIO${scl}.`,
    "card.hw_env_disabled": "Not configured.",
    // Firmware / update channel (ESP32 card). Two published feeds: releases are cut by hand, the
    // dev feed follows every merge to main. "Version" is the running build, "Update channel" is
    // which feed the next check reads.
    "card.firmware": "Version", "card.channel": "Update channel",
    "card.firmware_help": "The version currently running on the ESP32. Tap the value to check the selected update channel for a signed firmware image.",
    "card.channel_help": "Release follows manually published stable versions. Development follows the latest firmware-relevant merge. Changing the channel immediately checks that feed.",
    "chan.release": "Release", "chan.dev": "Development",
    "chan.saved": (c) => `Update channel: ${c}`,
    // Settings card titles (the old ESP32 card split into ESP32 / Protocol / Firmware) + the UI
    // language override. "auto" is labelled "Browser" — it IS the browser's own navigator.language,
    // not a separate automatic mode; languages are named in their OWN tongue, the convention for a
    // language picker.
    "card.proto_title": "Protocol", "card.fw_title": "Firmware",
    "settings.diagnostics": "Plant diagnostics",
    "card.language": "Language",
    "card.language_help": "Browser uses the browser's language preference. Choosing a language stores a fixed device-wide interface language.",
    "card.diagnostics": "Plant diagnostics",
    "card.diagnostics_help": "Enables the 24-hour plant checkup and optional circulation-pump power monitoring.",
    "diagnostics.off": "Off",
    "diagnostics.saved_on": "Plant diagnostics enabled — collecting starts now",
    "diagnostics.saved_off": "Plant diagnostics disabled — collection stopped",
    "probe.toggle": "Protocol diagnostics",
    "probe.intro": "Direct X10A register-page request with optional converter evaluation.",
    "probe.request": "Request", "probe.register": "Register", "probe.manual": "Manual input",
    "probe.page": "Register page", "probe.offset": "Payload offset", "probe.size": "Field width",
    "probe.byte": "byte", "probe.bytes": "bytes", "probe.converter": "Converter",
    "probe.page_help": "Hex or decimal · 0…255", "probe.offset_help": "Payload index · 0…31",
    "probe.size_help": "Bytes to decode", "probe.converter_auto": "Automatic",
    "probe.converter_auto_help": (size) => `Tests every implemented converter for ${size} byte${Number(size) === 1 ? "" : "s"}.`,
    "probe.conv_raw_byte": "raw byte · 0…255", "probe.conv_unsigned_byte": "unsigned raw byte",
    "probe.conv_tenth_byte": "raw byte × 0.1", "probe.conv_unsigned_half_byte": "unsigned byte × 0.5",
    "probe.conv_signed_raw_le": "signed integer · little-endian", "probe.conv_signed_raw_be": "signed integer · big-endian",
    "probe.conv_signed_256_le": "signed ÷ 256 · little-endian", "probe.conv_signed_256_be": "signed ÷ 256 · big-endian",
    "probe.conv_signed_tenth_le": "signed × 0.1 · little-endian", "probe.conv_signed_tenth_be": "signed × 0.1 · big-endian",
    "probe.conv_signed_tenth_nodata_le": "signed × 0.1 · little-endian · 0x8000 = no data",
    "probe.conv_signed_tenth_nodata_be": "signed × 0.1 · big-endian · 0x8000 = no data",
    "probe.conv_signed_128_le": "signed ÷ 256 × 2 · little-endian", "probe.conv_signed_128_be": "signed ÷ 256 × 2 · big-endian",
    "probe.conv_signed_half_be": "signed × 0.5 · big-endian", "probe.conv_signed_hundredth_be": "signed × 0.01 · big-endian",
    "probe.conv_unsigned_raw_le": "unsigned integer · little-endian", "probe.conv_unsigned_raw_be": "unsigned integer · big-endian",
    "probe.conv_unsigned_half_be": "unsigned × 0.5 · big-endian", "probe.conv_saturation": "pressure → saturation temperature",
    "probe.conv_raw_fan": "raw byte / fan step", "probe.conv_capacity": "indoor-unit capacity code",
    "probe.conv_eeprom_digit": "raw EEPROM digit", "probe.conv_eeprom_pair": "raw EEPROM digit pair",
    "probe.conv_bits_high": "bits 4–6 · 3-bit counter", "probe.conv_bits_low": "bits 0–2 · 3-bit counter",
    "probe.conv_operation_mode": "operation mode", "probe.conv_error_class": "error class",
    "probe.conv_error_code": "Daikin error code", "probe.conv_indoor_mode": "indoor mode · high nibble",
    "probe.conv_hybrid_mode": "hybrid mode", "probe.conv_bit": (bit) => `bit ${bit} · 0 or 1`,
    "probe.conv_unknown": "unknown converter",
    "probe.send": "Read register", "probe.querying": "Querying…",
    "probe.action_note": "One request per poll cycle. Blocked during OTA.",
    "probe.catalog_loading": "Loading active profile…",
    "probe.catalog_empty": "No register definitions available.",
    "probe.catalog_error": "Could not load profile registers.",
    "probe.catalog_profile": (profile) => `Profile: ${profile}`,
    "probe.catalog_fallback": (definition, profile) => `main/def: ${definition} · profile: ${profile}`,
    "probe.response": "Response", "probe.frame": "Frame", "probe.payload": "Payload",
    "probe.slice": "Selected bytes", "probe.interpretation": "Interpretation",
    "probe.response_for": (reg) => `Response from register ${reg}`,
    "probe.payload_marked": "Payload · selected bytes marked",
    "probe.slice_note": (offset, size, slice) => `Offset ${offset} · ${size} byte${size === 1 ? "" : "s"} · 0x${String(slice).replace(/\s+/g, "")}`,
    "probe.full_frame": "Complete frame", "probe.decode_value": "Converter result",
    "probe.no_decodes": "No converter result.", "probe.refused": "Value refused",
    "probe.unimplemented": "Not implemented", "probe.aliases": "also",
    "probe.invalid": "Check register page, offset, field width and converter.",
    "probe.failed": "Query failed.",
    "probe.status_ok": "Valid reply", "probe.status_busy": "Busy",
    "probe.status_no_link": "No X10A link", "probe.status_timeout": "Timeout",
    "probe.status_no_reply": "No reply", "probe.status_rejected": "Rejected",
    "probe.status_bad_crc": "Bad checksum", "probe.status_unexpected_reply": "Unexpected reply",
    "probe.status_invalid_length": "Invalid length", "probe.status_short_reply": "Partial reply",
    "probe.status_out_of_bounds": "Outside payload", "probe.status_error": "Error",
    "probe.transport_ok": "Frame complete and valid.",
    "probe.transport_busy": "Another register request is active.",
    "probe.transport_no_link": "X10A link is not available.",
    "probe.transport_timeout": "The poll task did not execute the request in time.",
    "probe.transport_no_reply": "No reply bytes received.",
    "probe.transport_rejected": "The unit rejected this register page.",
    "probe.transport_bad_crc": "Reply received; checksum invalid.",
    "probe.transport_unexpected_reply": "Reply belongs to a different register page.",
    "probe.transport_invalid_length": "Reply advertises an invalid frame length.",
    "probe.transport_short_reply": "Only part of the reply was received.",
    "probe.transport_out_of_bounds": "Requested bytes lie outside this payload.",
    "probe.transport_error": "Request failed.",
    "lang.auto": "Browser", "lang.de": "Deutsch", "lang.en": "English", "lang.es": "Español",
    "lang.fr": "Français", "lang.it": "Italiano", "lang.pl": "Polski", "lang.cs": "Čeština",
    "lang.uk": "Українська", "lang.zh": "简体中文", "lang.ja": "日本語",
    "lang.nb": "Norsk", "lang.sv": "Svenska", "lang.fi": "Suomi",
    "lang.saved": "Language saved",
    "check.detail.source_stale_modbus": "No fresh Modbus sample; current state unknown. History retained.",
    "mb.flow_scale_help": "Unverified /100 flow scaling (probe pending/fallback); compare L/min with unit display. Excluded from pipe motion, ΔT, heat output and 24-hour check.",
    "hist.modbus_flow_unverified": "Unverified /100 Modbus scaling (pending/fallback); compare L/min with unit.",
    "wf.label": "Performance factor",
    "wf.state.unsupported": "Not supported", "wf.state.collecting": "Collecting", "wf.state.standby": "Standby",
    "wf.verdict.cheaper": "cheaper than gas", "wf.verdict.similar": "like gas",
    "wf.verdict.more_expensive": "costlier than gas", "wf.verdict.limited": "limited",
    "wf.verdict.measured": "measured", "wf.verdict.partial": "provisional",
    "wf.aria.estimate": (v) => `estimated ${v}`,
    "wf.kpi.breakeven": (be) => `Break-even ${be}`, "wf.kpi.hp_cost": "Heat pump",
    "wf.kpi.gas_cost": "Gas · 88%",
    "wf.kpi.delta": "Delta", "wf.kpi.energy": "24 h heat",
    "wf.kpi.heat_elec": (e) => `el. ${e} kWh`,
    "wf.scope.est": "est.", "wf.scope.comp": "comp. only",
    "wf.scale.label": "Break-even", "wf.scale.band": (p) => `±${p}%`,
    "wf.scale.cheaper": "Cheaper →", "wf.scale.expensive": "← Costlier",
    "wf.desc.collecting": (o) => `First value after 2 h · ${o} so far`,
    "wf.desc.standby": (o) => `Too little runtime for a value · ${o} observed`,
    "wf.desc.unsupported": "Required flow, temperature, or electrical inputs unavailable.",
    "wf.banner.stale": "Source signal stale — figure paused.",
    "wf.banner.buh_limited": "Backup heater active outside electrical scope — figure limited.",
    "wf.banner.buh_unpaired": "Backup heater active without outlet sensor — excluded.",
    "wf.banner.bsh_excluded": (d) => `Tank booster ${d} excluded.`,
    "wf.banner.ct_unwired": "Mains clamp at 0 A — using compressor only.",
    "wf.ctx.window": "Period", "wf.ctx.power": "Power", "wf.ctx.outdoor": "Outdoor",
    "wf.ctx.outdoor_range": (avg, min) => `avg ${avg} °C · min ${min} °C`,
    "wf.ctx.defrost": "Defrost", "wf.ctx.buh": "Backup heater",
    "wf.ctx.buh_inc": (d) => `${d} · included`,
    "wf.ctx.cooling": "Cooling", "wf.ctx.excluded": (d) => `${d} excluded`,
    "wf.src.x10a_ct": "Clamp · whole unit", "wf.src.x10a_inv": "Inverter · comp. only",
    "wf.foot.base": "24 h heating & hot water · pure water · estimate.",
    "wf.foot.gas": "24 h heating & hot water · pure water · gas 88% condensing boiler, no fixed fees · estimate.",
    "wf.gas.row": "Gas comparison", "wf.gas.title": "Gas tariffs", "wf.not_configured": "No tariffs",
    "wf.gas.detail.elec": "Electricity", "wf.gas.detail.gas": "Gas", "wf.gas.detail.breakeven": "Break-even",
    "wf.gas.settings_help": "24 h HP vs. fixed 88% Hs modern condensing gas boiler (pure water 4.186 kJ/(L·K), no fixed fees).",
    "wf.gas.elec_price": "Elec. / kWh", "wf.gas.gas_price": "Gas / kWh", "wf.gas.currency": "Currency",
    "wf.gas.preview": (b) => `Break-even: ${b} (±20%)`, "wf.gas.preview_empty": "Enter prices for break-even.",
    "wf.gas.hint": "Fixed 88% Hs modern condensing gas boiler & pure water (4.186 kJ/(L·K)), Heating + DHW, no fixed fees. Updates 24 h.",
    "wf.gas.delete": "Clear", "wf.gas.deleting": "Clearing…", "wf.gas.saved": "Tariffs saved", "wf.gas.deleted": "Tariffs cleared",
    "wf.gas.err_price": "0.0001–99.9999.", "wf.gas.err_currency": "Select a supported currency.",
  },
};
function t(k, ...a) {
  const v = (I18N[LANG] && I18N[LANG][k] != null) ? I18N[LANG][k] : I18N.en[k];
  if (v == null) return k;
  return typeof v === "function" ? v(...a) : v;
}

// X10A keeps the converter's stable English operation-mode tokens in /values. The schematic is the
// user-facing summary, so translate the complete conv-315 vocabulary here instead of leaking the
// technical "DHW" abbreviation into an otherwise localised headline. Unknown future modes remain
// visible verbatim rather than being guessed into a known state.
const OPERATION_MODE_I18N = Object.freeze({
  "Stop": "mode.stop",
  "Heating": "mode.heat",
  "Cooling": "mode.cool",
  "DHW": "mode.dhw",
  "Heating + DHW": "mode.heat_dhw",
  "Cooling + DHW": "mode.cool_dhw",
});
function operationModeText(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const key = OPERATION_MODE_I18N[raw];
  return key ? t(key) : raw;
}
function operationModeFromFlags(dhw, space, spaceMode = null) {
  const sc = spaceMode === "heat" ? "heat" : spaceMode === "cool" ? "cool" : "space";
  return dhw === true && space === true ? t(`mode.${sc}_dhw`)
       : dhw === true ? t("mode.dhw")
       : space === true ? t(`mode.${sc}`)
       : (dhw === false && space === false) ? t("mode.stop") : null;
}
// The diagram and its explainer are two views of the same state. X10A carries the detailed hydronic
// enum; while that bus is down, the HomeHub's two activity flags distinguish hot water, generic space
// operation and stop, and input 38 refines active space operation to Heating or Cooling where known.
function schematicOperationMode() {
  const hp = S.status?.hp || {};
  if (hp.connected) {
    // The hydronic row. The outdoor controller's "Operation Mode" on page 0x10 is a different quantity,
    // and a lost hydronic page must blank this headline rather than print that row under its name.
    // Protocol S has no hydronic row: its one mode row, on another page, is the answer there.
    const row = (S._values || []).find((x) => /i\/u operation mode/i.test(x.label || "") ||
                                              (x.reg !== 0x10 && /^operation mode$/i.test(x.label || "")));
    return operationModeText(row?.value);
  }
  return mbLive() ? operationModeFromFlags(mbBool(52), mbBool(53),
    typeof mbCurrentSpaceMode === "function" ? mbCurrentSpaceMode() : null) : null;
}
// Localise the static markup in index.html: elements tagged data-i18n get their text set from the
// dictionary. Runs once at boot (the static DOM is never rebuilt). SVG <text>/<tspan> nodes work the
// same as HTML here (textContent). Value units (°C, kW, bar, rps, l/min, K) carry no data-i18n — they
// are language-neutral and left verbatim.
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
}
// Switch the live language: swap LANG, cache it for the next first paint, and re-localise the parts
// that are NOT rebuilt on a poll — the static HTML + inline SVG (applyStaticI18n), the schematic's
// hit-target labels (labelSchematicHits, including locale-specific inspector copy), and the active
// navigation title. Dynamic cards repaint through t()/tx() on the caller's next render. renderHeader
// is defined by app_state.js later in the assembled page; the guard keeps this fragment usable in
// the focused dictionary/render harnesses that intentionally load no navigation code. A no-op
// (returns false) when the language is unchanged, so a poll that reports the same language costs
// nothing.
function activateLang(next) {
  if (next === LANG) return false;
  LANG = next;
  lsSet("uiLang", next);
  applyStaticI18n();
  labelSchematicHits();
  if (typeof renderHeader === "function") renderHeader();
  return true;
}
let _languageRequest = 0;
function setLang(next, current = () => true, fromStatus = false) {
  const request = ++_languageRequest;
  const activate = (lang) => request === _languageRequest && current() ? activateLang(lang) : false;
  if (!fromStatus) {
    UI_LANG_MODE = uiLangSupported(next) ? next : "auto";
    lsSet("uiLangMode", UI_LANG_MODE);
  }
  if (!uiLangSupported(next)) next = autoLang();
  if (localeReady(next)) return activate(next);
  return loadLocale(next).then((loaded) => activate(loaded ? next : "en"));
}
// Reconcile the language with the device's stored override (/status.ui.lang): a supported language
// forces that language on this client; "auto" (or a pre-override device that omits the field) hands
// the choice back to the browser. Called from refreshStatus before the frame is painted.
function setLangFromStatus(s, current = () => true) {
  const stored = s && s.ui && s.ui.lang;
  const mode = uiLangSupported(stored) ? stored : "auto";
  UI_LANG_MODE = mode;
  lsSet("uiLangMode", mode);
  return setLang(uiLangSupported(stored) ? stored : autoLang(), current, true);
}
