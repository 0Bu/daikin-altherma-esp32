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
// tap-to-expand descriptions currently carry German and English prose; another selected language
// falls back to English for that specialist layer. Dynamic strings built in this file go through
// t(); the static markup in index.html is localised by applyStaticI18n() reading data-i18n
// attributes, re-run by setLang() when the language changes live.
const UI_LANGS = Object.freeze(["en", "de", "es", "fr", "it", "pl", "cs", "uk"]);
const uiLangSupported = (lang) => UI_LANGS.includes(lang);
const autoLang = () => {
  const primary = String(navigator.language || "").trim().toLowerCase().split(/[-_]/, 1)[0];
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
let LANG = (() => { const c = lsGet("uiLang"); return uiLangSupported(c) ? c : autoLang(); })();
// English stays in the startup page as the guaranteed fallback. Every other catalog is a separate,
// pre-compressed asset served by this same ESP32: no CDN, no internet dependency, and no attempt to
// squeeze seven more catalogs into a dashboard already at its delivery limit. One Promise per
// language coalesces boot/status races and a failed asset is remembered for this page lifetime.
const LOCALE_LOADS = new Map();
function loadLocale(lang) {
  if (lang === "en" || I18N[lang]) return Promise.resolve(true);
  if (!uiLangSupported(lang)) return Promise.resolve(false);
  if (LOCALE_LOADS.has(lang)) return LOCALE_LOADS.get(lang);
  const pending = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `/locale.js?lang=${encodeURIComponent(lang)}`;
    script.async = true;
    script.onload = () => resolve(!!I18N[lang]);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  LOCALE_LOADS.set(lang, pending);
  return pending;
}
// Each key is a string, or a function for the parameterised ones (same arity in every catalog).
const I18N = {
  en: {
    "sys.nodata": "No data", "sys.unreachable": "Unreachable",
    "sys.x10a_down": "X10A offline", "sys.mb_carrying": "Operating mode unknown — readings from Modbus",
    "sys.mb_only": "X10A offline — readings from Modbus", "sys.mb_source": "X10A offline · Modbus",
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
    "sys.online": "Online", "sys.fault": "Fault", "sys.warning": "Warning",
    "sys.fault_line": (c) => "Fault · " + c + " — check the Daikin fault code.",
    "sys.warning_line": (c) => "Warning · " + c + " — check the heat pump.",
    "sys.polled": (s) => `Polled ${s}s ago`,
    "recovery.title": "Recovery mode",
    // Two causes reach recovery mode and need OPPOSITE advice. The crash-loop text sends the
    // reader to the configuration; saying that after a heap give-up would send them to fix
    // something that is already correct (/status.sys.safe_mode_cause picks between them).
    "recovery.meta_heap": "The device ran out of memory repeatedly and restarted itself. It is now running with the heat pump connection and MQTT switched off, so the web interface stays reachable. The configuration is most likely fine — install a newer firmware version under Settings. A power cycle retries the full stack.",
    "recovery.meta": "The device restarted repeatedly and entered recovery mode. Communication with the heat pump and MQTT are paused. Check the configuration — especially the RX/TX pins on the Protocol card in Settings — then restart the device.",
    "rollback.title": "WiFi change failed — rolled back",
    "rollback.meta": (back) => `The device could not connect with the new WiFi settings. It restored the previous network${back} and restarted. Check the network name and password under Settings → Connections, then try again.`,
    "crash.title_fault": "Device restarted after a crash",
    "crash.title_orphan": "Crash report waiting from an earlier restart",
    "crash.reset": "Reset", "crash.task": "task", "crash.fw": "fw", "crash.elf": "elf", "crash.corrupted": "corrupted",
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
    "bug.what_ph": "The tank temperature has read 12800 °C in Home Assistant since this morning.",
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
    "nav.settings_alert": (n) => `Settings — ${n} connection${n === 1 ? "" : "s"} down`,
    // ── The two sources (X10A + the HomeHub Modbus stack) ──
    "src.modbus_tag": "modbus",
    "src.agree": "Both sources agree",
    "src.delta": (d, u) => `Difference ${d}${u ? " " + u : ""}`,
    "src.disagree": "The two sources disagree about this state",
    "conn.homehub": "HomeHub", "conn.searching": "Searching…",
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
    "check.fault": "Unit fault", "check.dhw_loss": "DHW tank heat loss",
    "check.cycling": "Compressor starts",
    "check.defrost": "Defrost cycles", "check.pressure": "Water pressure, lowest",
    "check.flow": "Flow rate, lowest", "check.heater": "Backup heater",
    "check.retries": "Protection retries",
    "check.status.ok": "OK", "check.status.info": "NOTE",
    "check.status.warn": "WARNING", "check.status.collecting": "CHECKING",
    "check.status.observation": "MEASURED ONLY", "check.status.experimental": "EXPERIMENTAL",
    "check.status.unavailable": "NOT AVAILABLE",
    "check.summary": (s, n, a) => a > 0 ? `${s} · ${n}/${a} assessed` : s,
    "check.detail.value_label": "Value:",
    "check.detail.assessment_label": "Assessment:",
    "check.detail.ok": "Assessment complete; no finding in the observed plant data.",
    "check.detail.info": "Worth knowing about, but not proof of a defect. What counts as notable here is under “Normal” below.",
    "check.detail.warn": "A device finding or documented limit needs attention.",
    // The fault row's own four sentences. See checkupDetailKey() in dashboard.js: this row reports
    // the DEVICE's class, so it has to say which of the states behind one word it is in.
    "check.detail.fault.error": "The unit is reporting an error right now. The exact code is in the “Operation” card.",
    "check.detail.fault.warning": "The unit is reporting a warning or caution right now, not an error. The exact code is in the “Operation” card.",
    "check.detail.fault.past": "Nothing is being reported right now. A message did appear during the last 24 hours and cleared on its own, which is why this row is not OK. Nothing needs to be done about a message that has cleared; if it keeps coming back, note when it appears.",
    "check.detail.fault.past_unknown": "A message appeared during the last 24 hours. Whether one is active right now cannot be read — the fault row is not answering, so check the X10A link.",
    "check.detail.collecting": (n, r) => `${n} of ${r} captured; no assessment is possible yet.`,
    "check.detail.cycling_split": " Only confirmed space heating is assessed here. Hot-water runs answer different constraints; positively identified cooling is excluded. Counted per complete run: the 3-way valve and, on the room circuit, the I/U operating mode must stay readable and unchanged for the whole run. Everything else is unclassified and judged by neither.",
    "check.detail.cycling_pooled": " Assessed on all runs together because class evidence was insufficient: an input was too sparse, fewer than 12 runs were classified, or more than 10% of completed runs were unclassified. Hot water or cooling can therefore mask short heating runs. The class figures beside this are observations, not what decided the verdict.",
    "check.detail.outdoor_cycling": " The X10A outdoor figures include only fresh samples from completed, consistently classified space-heating runs. They are context and do not change the cycling threshold or verdict.",
    "check.detail.outdoor_defrost": " The X10A outdoor figures include only fresh samples while both defrost and compressor state were readable and the compressor was running. They are context and do not change the defrost threshold or verdict.",
    "check.detail.dhw_candidate": (n, r, c, w) => `${n} of ${r} completed in clean one-hour windows; current clean window: ${c} of ${w}.`,
    "check.detail.dhw_settling": (n, r, s) => `${n} of ${r} completed in clean one-hour windows; tank charging or BSH was detected, with ${s} settling time remaining.`,
    "check.detail.dhw_waiting": (n, r) => `${n} of ${r} completed in clean one-hour windows; no complete clean one-hour window yet.`,
    // What the window DISCARDED. Appended to whichever sentence above applies, because "0 min" and
    // "0 min after nine attempts were thrown away by tank charging" are different findings, and only
    // the second one tells the reader where to look.
    "check.detail.dhw_aborted": (n, reasons, best) => ` ${n} candidate ${n === 1 ? "window" : "windows"} discarded (${reasons}); longest reached ${best} of 60 min.`,
    // The verdict that says this is not a matter of waiting longer. The generic path is deliberately
    // NON-CAUSAL: the persisted window has only an abort total, an OR-ed set of reason kinds and the
    // best duration. It cannot say which cause dominated, or pair circulation evidence with an
    // aborted candidate. The all-blind case below is stronger because that one reason kind is the
    // only evidence that occurred anywhere in the window.
    "check.detail.dhw_blocked": (n, reasons, best) => `Not assessable with this method: over a full 24 hours not one clean one-hour window completed, and ${n} candidate ${n === 1 ? "window was" : "windows were"} discarded (${reasons}); the longest reached ${best} of 60 min. Tank charging needs 105 undisturbed minutes (45 min settling plus a 60-minute window); draws, pump activity, unreadable data, or continuous heat loss fast enough to look like a draw can also prevent a clean hour. The stored totals do not show which cause dominated, so fast continuous heat loss cannot be excluded.`,
    "check.detail.dhw_blocked_link": (n, best) => `Not assessable: over a full 24 hours not one clean one-hour window completed, and all ${n} candidate ${n === 1 ? "window was" : "windows were"} discarded because the X10A link stopped answering mid-window; the longest reached ${best} of 60 min. This is the link, not the plant — check the X10A wiring and the RX/TX pins.`,
    "check.detail.dhw_reason.charge": "tank charging",
    "check.detail.dhw_reason.pump": "internal pump",
    "check.detail.dhw_reason.draw": "draw-like drop",
    "check.detail.dhw_reason.reading": "implausible R5T",
    "check.detail.dhw_reason.blind": "X10A not answering",
    "check.detail.collecting_unknown": "Not enough usable evidence for an assessment yet.",
    "check.detail.observation": "Measured value only; there is no universal OK/WARNING limit.",
    "check.detail.experimental": "Experimental observation; a stable counter is not proof that no limiting occurred.",
    "check.detail.unavailable": "The active profile provides no assessable data for this check.",
    "check.starts": (n) => `${n} ${n === 1 ? "start" : "starts"}`,
    "check.cycles": (n) => `${n} ${n === 1 ? "cycle" : "cycles"}`,
    "check.paired_cycles": (n) => `${n} paired`,
    "check.mean": (d) => `${d}/start`,
    // The operating class the 3-way valve says a run served. `d` is empty while no mean has been
    // established, so the count still reads as the observation it is.
    "check.cycling_space": (n, d) => d ? `space ${n} × ${d}` : `space ${n}`,
    "check.cycling_dhw": (n, d) => d ? `hot water ${n} × ${d}` : `hot water ${n}`,
    "check.cycling_cooling": (n) => `cooling ${n} excluded`,
    "check.cycling_censored": (n) => `${n} unclassified`,
    "check.outdoor_one": (source, mean) => `${source} ${mean} °C`,
    "check.outdoor_range": (source, min, mean) => `${source} min ${min} °C · mean ${mean} °C`,
    "check.min": (m) => `${m} min`,
    "check.tank": (m) => `tank ${m} min`,
    "check.tank_runtime": (d) => `tank ${d}`,
    "check.loss_windows": (n) => `${n} ${n === 1 ? "window" : "windows"}`,
    "check.loss_pump_off": "also while the circulation pump was off",
    "check.loss_with_pump": "during circulation-pump operation",
    "check.loss_unattributed": "pump attribution incomplete",
    "check.fault_err": "Fault active", "check.fault_warn": "Warning active",
    "check.fault_past": "Occurred in the last 24 h · not active now", "check.fault_none": "None active",
    "check.fault_unknown": "Current state unknown",
    "check.fault_past_unknown": "Occurred in the last 24 h · current state unknown",
    "check.retry_seen": "Counter increase seen", "check.retry_none": "No increase seen",
    "values.waiting": "Waiting for the first poll…",
    "values.sg_x10a_mode": "Smart-Grid mode (X10A contacts)",
    "group.Operation": "Operation", "group.Domestic hot water": "Domestic hot water",
    "group.Water circuit": "Water circuit", "group.Refrigerant / outdoor": "Refrigerant / outdoor",
    "group.Electrical": "Electrical", "group.Device": "Device", "group.Other values": "Other values",
    "group.Protection": "Protection", "protect.limiting": "limiting now",
    "group.Values": "Values",
    "state.on": "ON", "state.off": "OFF",
    // HomeHub enum names from EKRHH 4P744838-1E §9.2. APIs/MQTT keep the raw numeric constants;
    // the browser applies these names only at the visual boundary.
    "enum.auto": "Auto", "enum.heating": "Heating", "enum.cooling": "Cooling",
    "enum.no_error": "No error", "enum.fault": "Fault", "enum.warning": "Warning",
    "enum.space_heating": "Space heating", "enum.dhw": "DHW",
    "enum.free_running": "Free running", "enum.forced_off": "Forced off",
    "enum.recommended_on": "Recommended on", "enum.forced_on": "Forced on",
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
    "hist.loading": "Loading trend…", "hist.none": "No readings recorded yet.",
    "hist.err": "Trend unavailable.",
    "hist.gaps": (n) => `${n} gap${n === 1 ? "" : "s"} — not measured`,
    "hist.nm": "not measured", "hist.rel": (h) => `${h} h ago`,
    "hist.held": "outdoor unit resting", "hist.heldnote": (h) => `${h} h resting — not measured`,
    "hist.forecast": "Open-Meteo · forecast", "hist.in_hours": (h) => `in ${h} h`,
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
    "hist.defrost_total": (d) => `Defrost observed active · ${d} sampled raster time`,
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
    "toast.saved": "Saved", "toast.no_changes": "No changes",
    "toast.reboot": "Rebooting — reconnecting…", "toast.rebooted": "Rebooted — reconnect to the device",
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
    "ota.confirm": (cur, avail) => `Update available: v${cur} → v${avail}\n\nThe device downloads and installs the signed image, then reboots. If the new firmware can't get online it rolls back automatically.`,
    "aria.ota": "Check for firmware updates",
    "ota.title_check": "Tap to check for firmware updates",
    "ota.title_avail": (v) => `Update v${v} available — tap to install`,
    "mq.err_format": "Enter host:port — e.g. 192.168.1.10:1883 — or mqtts://host:8883 for TLS",
    "sl.err_port": "Port must be a whole number 1–65535 (e.g. logs.example.com:514).",
    "btn.saving": "Saving…", "btn.verifying": "Verifying…", "btn.save": "Save",
    "btn.cancel": "Cancel", "btn.close": "Close",
    // static index.html markup (data-i18n)
    "schem.outdoor_unit": "OUTDOOR UNIT", "schem.defrost_pill": "❄ defrost", "schem.outdoor": "Outdoor",
    "insp.close": "Close",
    "schem.leaving_water": "R1T", "schem.dhw_tank": "DHW TANK", "schem.set": "set",
    "schem.bsh_label": "E-heater",
    "schem.space_circuit": "SPACE CIRCUIT", "schem.heating": "HEATING", "schem.cooling": "COOLING",
    "schem.pump": "PUMP", "schem.return": "R4T", "schem.room": "Room",
    "schem.flow_rate": "flow", "schem.water_press": "water pressure",
    "schem.r2t": "R2T", "schem.r3t": "R3T",
    "schem.flow_switch": "Flow switch", "schem.valve2": "2WV",
    "wifi.title": "WiFi configuration", "wifi.ssid": "WiFi network (SSID)", "wifi.pass": "WiFi password",
    "wifi.err_ssid": "SSID must be 32 characters or less",
    "wifi.err_pass": "Password must be empty (open network) or between 8 and 63 characters",
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
    "dyn.card": "Heating-curve diagnosis",
    "dyn.state": "Status",
    "dyn.state_recording": "Recording", "dyn.state_recording_nowx": "Recording · no forecast",
    "dyn.state_waiting": "Waiting for space heating", "dyn.state_cooling": "Cooling · not sampled", "dyn.state_room": "Room source unusable",
    "dyn.state_x10a": "X10A offline", "dyn.state_homehub": "HomeHub offline",
    "dyn.state_gate": "Plant state unknown", "dyn.state_mode": "Heating/cooling mode unknown", "dyn.state_clock": "Clock not set",
    "dyn.state_blocked": "Not recording",
    "dyn.state_setup_room": "Set up a room source", "dyn.state_setup_homehub": "HomeHub not set up",
    "dyn.state_homehub_disabled": "Diagnosis off — HomeHub disabled",
    "dyn.state_no_broker": "Not recording — no MQTT broker", "dyn.state_safe_mode": "Not recording — safe mode",
    "dyn.state_inactive": "Not recording — sampler not running",
    "dyn.room_off": "Room thermostat switched off", "dyn.room_not_heating": "Room thermostat not on heating",
    "dyn.room_stale": "Room reading too old", "dyn.room_no_value": "Waiting for a room reading",
    "dyn.room_invalid_payload": "Invalid MQTT message",
    "dyn.room_invalid_temperature": "Room temperature outside the permitted range",
    "dyn.room_invalid_setpoint": "Target temperature outside the permitted range",
    "dyn.room_no_setpoint": "Target temperature missing",
    "dyn.room_no_time": "Measurement time missing", "dyn.room_retained_no_time": "Retained value without measurement time",
    "dyn.room_future_time": "Measurement time is in the future", "dyn.room_backward_time": "Measurement time moved backwards",
    "dyn.room_invalid_time": "Invalid measurement time",
    "dyn.room_no_enabled": "Thermostat on/off state missing", "dyn.room_no_hvac_mode": "Thermostat operating mode missing",
    "dyn.room_source": "Room-temperature source",
    "dyn.weather": "Optional comparison forecast", "dyn.strategy": "Diagnostic signal",
    "dyn.not_configured": "Not configured",
    "dyn.outdoor": "Measured outdoor air",
    "dyn.outdoor_detail_status": "Status",
    "dyn.outdoor_detail_now": "Current reading",
    "dyn.outdoor_detail_sample": "At the last recorded event",
    "dyn.outdoor_status_live": (source) => `${source} has a current reading; it is attached to each recorded event as context.`,
    "dyn.outdoor_status_unavailable": (source) => `${source} is configured but has no current reading. Events continue without this axis.`,
    "dyn.outdoor_status_absent": (source) => `${source} is not configured. Events continue without this axis.`,
    "dyn.outdoor_status_idle": (source) => `${source} is configured, but nothing is being recorded now. The status row above says why.`,
    "dyn.outdoor_sample_none": "Recorded without an outdoor value",
    "dyn.outdoor_help_axis": "The outdoor temperature is what makes a recorded room deviation readable. Without it, +0.5 K at −5 °C and +0.5 K at +12 °C look identical, although one points to a curve that is too steep and the other to one set too high. It is optional: recording continues without it, and the value is never used to decide whether an event is recorded.",
    "dyn.outdoor_help_placement": "This is whatever the sensor measures where it is mounted. The firmware cannot tell where that is — next to the indoor unit it is room air, at a shaded outdoor position it is genuine outdoor air, and only the latter makes the comparison meaningful.",
    "dyn.outdoor_help_setup": "An M5Stack ENV III on the board's Grove port can supply this. Mounted outdoors and shaded, it measures the outdoor air continuously — unlike the heat pump's own sensor, which stops being refreshed while the outdoor unit rests. It is set up under ESP32 → Hardware, together with the board it plugs into.",
    "dyn.plant_outdoor": "Plant outdoor air",
    "dyn.plant_outdoor_help": "This is HomeHub input 44, the heat pump's own outside-air concept. It is captured from the same current Modbus cycle as the heating-window gates and its source is stored with the event. It stays separate from ENV III and never changes whether an event is recorded.",
    "dyn.shadow_strategy": "Raw room deviation · 30 min",
    "dyn.card_help": "Every 30 minutes during clearly identified space heating, the firmware records how far the reference-room temperature is from its target, together with the outdoor temperature at that moment when a sensor supplies one. Together with run time, minimum leaving-water limits and thermostat activity, the longer-term pattern can show whether the heating curve tends to be too high or too low. A 1 K room deviation does not automatically mean a 1 K leaving-water change. This function only reads data and writes nothing to the heat pump.",
    "dyn.state_help_recording": "Confirmed space heating is running and the room input is valid, so raw room-error samples are being recorded. Read a season trend with run-time and clipping evidence; one sample is not a verdict.",
    "dyn.state_help_waiting": "The plant is not in normal space operation right now, so no sample is recorded. Through the summer this is the normal, expected state and not a fault.",
    "dyn.state_help_cooling": "HomeHub reports normal space operation, but the current mode is cooling. Cooling windows are deliberately excluded from the heating-curve data set.",
    "dyn.state_help_blocked": "A required input is missing, so nothing is being recorded. Recording resumes once it returns; stale or ambiguous evidence is never sampled.",
    "dyn.state_help_room": "The room reading reaches the device, but it cannot currently provide a valid deviation from target. No sample is formed until the source becomes usable again.",
    "dyn.state_help_setup": "The diagnosis starts when a timestamped MQTT room source with a target is saved. The forecast is optional comparison evidence; no location disclosure is required.",
    "dyn.state_help_inactive": "The sources are configured, but nothing is evaluating them: the sampler runs on the MQTT connection, and this board came up in safe mode after repeated crash boots, where every optional consumer stays out of the way. Nothing is lost \u2014 recording resumes on its own once the board boots normally again.",
    "dyn.state_help_no_broker": "A room source is saved, but the diagnosis reads it over MQTT and no broker is configured. Set the broker in the Connections card; the saved room source is kept and recording starts by itself.",
    "dyn.state_help_setup_homehub": "The diagnosis needs the HomeHub to tell it when the plant is actually heating; without one it cannot tell a heating window apart from hot water or a standstill. Set the HomeHub address in the Protocol card.",
    "dyn.state_help_homehub_disabled": "This diagnosis depends on two HomeHub plant signals. With the HomeHub address explicitly empty, neither Modbus nor this dependent diagnosis runs.",
    "dyn.strategy_help": "The sample is room target minus actual room temperature: positive means the room is below target, negative means it is above. There is no deadband, rounding, clamp or slew limit. It is an uncalibrated indicator, not a requested leaving-water offset. The reference room must represent the heated zone. Its own thermostat or closed valves form an inner control loop: they can remove heat demand and hide a curve that is too high. Read the room trend together with how often leaving-water temperature is held at its minimum (D2 clipping share) and how often the zone actually requests heat.",
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
    "ref.title": "Room-temperature source",
    "ref.name": "Name", "ref.temperature_source": "Temperature source",
    "ref.target": "Target temperature", "ref.timestamp_source": "Timestamp source · optional",
    "ref.max_age": "Maximum age · seconds",
    "ref.temperature_source_help": "Exact MQTT topic and optional JSON path after $. Missing or wrong paths are reported when a payload arrives.",
    "ref.target_help": "A fixed value in °C, or an exact MQTT topic with an optional JSON path after $.",
    "ref.timestamp_source_help": "Optional RFC3339/Unix source time as topic$path. Empty uses live MQTT arrival time; retained values then fail closed.",
    "ref.max_age_help": "Maximum permitted age of the source reading, from 10 to 3600 seconds.", "ref.error": "Last error",
    "ref.broker_off": "MQTT broker disabled", "ref.retained": "cached by broker",
    "ref.time_untrusted": "Retained value without trusted measurement time", "ref.clock_unsynced": "Device clock not synchronized",
    "ref.now": "now", "ref.ago": (s) => `${s} s ago`, "ref.age_unknown": "unknown",
    "ref.saved": "Room-temperature source saved",
    "ref.detail.status_label": "Status:", "ref.detail.diagnosis_label": "Heating-curve diagnosis:",
    "ref.status.measurement_valid": "Measurement valid",
    "ref.status.not_configured": "Not set up", "ref.status.usable": "Usable",
    "ref.status.unusable": "Not usable", "ref.status.error": "Error",
    "ref.status.stale": "Stale", "ref.status.waiting": "Waiting",
    "ref.status.unavailable": "Unavailable",
    "ref.detail.setup": "Add an MQTT source using the pencil",
    "ref.detail.stale": "Reading is older than permitted",
    "ref.detail.waiting": "No MQTT reading received yet",
    "ref.detail.error": (e) => `MQTT message rejected: ${e}`,
    "ref.detail.temperature_label": "Room temperature:",
    "ref.detail.temperature": (v) => `${v} °C`,
    "ref.detail.setpoint_label": "Target temperature:",
    "ref.detail.setpoint": (v) => `${v} °C`,
    "ref.detail.last_measurement_label": "Latest reading:",
    "ref.detail.last_measurement": (v) => v,
    "ref.detail.last_measurement_stale": (v, max) => `${v} · permitted: at most ${max} s`,
    "ref.detail.purpose": "The diagnosis compares room and target temperature to reveal over time whether the heating curve is too high or too low. The heat pump is not controlled.",
    "ref.delete": "Delete", "ref.deleting": "Deleting…",
    "ref.deleted": "Room-temperature source and captured reading deleted",
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
    "wx.title": "Open-Meteo weather forecast", "wx.latitude": "Latitude", "wx.longitude": "Longitude",
    "wx.waiting": "Waiting for forecast", "wx.fetching": "Fetching Open-Meteo forecast…",
    "wx.unavailable": "Unavailable", "wx.error": "Open-Meteo forecast error",
    "wx.detail.status": "Status:", "wx.status.fresh": "Current", "wx.status.inactive": "Off",
    "wx.status.fetching": "Updating", "wx.status.stale": "Stale",
    "wx.status.unavailable": "Unavailable", "wx.status.waiting": "Waiting",
    "wx.detail.fresh": "The forecast was fetched successfully.",
    "wx.detail.fetching": "The ESP32 is fetching new forecast data.",
    "wx.detail.stale": "The last successful fetch is too old; the values are shown for diagnosis only.",
    "wx.detail.unavailable": "The last fetch failed; an older value, if present, is shown for diagnosis only.",
    "wx.detail.waiting": "No forecast has been received yet.",
    "wx.detail.temperature_label": "Temperature:",
    "wx.detail.temperature": (v) => `${v} °C is the mean forecast outdoor-air temperature for the next two complete hours.`,
    "wx.detail.solar_label": "Solar irradiation:",
    "wx.detail.solar": (v) => `${v} Wh/m² is the forecast global horizontal irradiation over the same two-hour period.`,
    "wx.detail.source_label": "Source:",
    "wx.detail.source": "Open-Meteo · DWD ICON Seamless. Observation only; the forecast does not change heat-pump control.",
    "wx.err_both": "Enter both latitude and longitude, or leave both empty to disable",
    "wx.err_latitude": "Latitude must be a decimal number between -90 and 90",
    "wx.err_longitude": "Longitude must be a decimal number between -180 and 180",
    "wx.saving": "Saving weather source…",
    "wx.hint.configured": "The ESP32 requests a new forecast every 45 minutes. Each request sends the coordinates to Open-Meteo and reveals the connection's public IP address. Leave both coordinate fields empty to remove the source.",
    "wx.hint.setup": "Enter latitude and longitude. A coordinate pair copied from Google Maps can be pasted into either field and is split automatically. After saving, the ESP32 requests a new forecast every 45 minutes. Each request sends the coordinates to Open-Meteo and reveals the connection's public IP address. The forecast is observation-only and does not change heat-pump control.",
    "wx.attribution": "Weather data by Open-Meteo.com · DWD ICON Seamless",
    "ref.err_temperature_source": "Enter an exact MQTT topic, optionally followed by $json-path",
    "ref.err_target": "Enter a fixed value from 5 to 35 °C or an exact MQTT topic, optionally followed by $json-path",
    "ref.err_timestamp_source": "Enter an exact MQTT topic, optionally followed by $json-path",
    "ref.err_max_age": "Maximum age must be a whole number between 10 and 3600 seconds",
    "ref.save_help": "Save stores the mapping. It subscribes while Plant diagnostics is enabled; otherwise it remains dormant. A readable, fresh MQTT value is still required.",
    "syslog.title": "Syslog server", "syslog.hostport": "Host : port",
    "syslog.hint": "Enter the Syslog server as hostname or IP address plus port. Leave the field empty to disable Syslog.",
    "ntp.title": "NTP server", "ntp.server": "Server",
    "ntp.hint": "Enter the hostname or IP address of the time server. Leave the field empty to use the firmware default.",
    // HomeHub transport dialog (issue #32). It exposes no actuator control; the link is read-only,
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
    "board.led_rgb_off": "Off — no Wi-Fi mode active.",
    "board.led_rgb_setup": "Blue, blinking slowly — setup portal active.",
    "board.led_rgb_connecting": "Yellow, blinking quickly — connecting to Wi-Fi.",
    "board.led_rgb_healthy": "Green, solid — all configured connections ready.",
    "board.led_rgb_bus_down": "Red, double flash — X10A disconnected.",
    "board.led_rgb_mqtt_down": "Orange, blinking — X10A connected, MQTT disconnected.",
    "board.led_rgb_wipe_armed": "Red, blinking very quickly — erase armed; release to abort.",
    "board.led_rgb_wiping": "White, solid — erasing settings; do not disconnect power.",
    "board.led_gpio_off": "Off — no Wi-Fi mode active.",
    "board.led_gpio_setup": "Blinking slowly — setup portal active.",
    "board.led_gpio_connecting": "Blinking quickly — connecting to Wi-Fi.",
    "board.led_gpio_healthy": "Solid — all configured connections ready.",
    "board.led_gpio_bus_down": "Double flash — X10A disconnected.",
    "board.led_gpio_mqtt_down": "Blinking at medium speed — X10A connected, MQTT disconnected.",
    "board.led_gpio_wipe_armed": "Blinking very quickly — erase armed; release to abort.",
    "board.led_gpio_wiping": "Solid after very rapid blinking — erasing settings; do not disconnect power.",
    "board.ledinv": "Active low (LED lights when the pin is driven LOW)",
    "board.btninv": "Active low (button shorts the pin to GND)",
    "board.hint": "Hold the reset button for 5 seconds to erase all settings and open the setup portal. Select “None” when no button is connected.",
    "card.hardware": "Hardware", "card.hw_off": "None",
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
    "card.diagnostics_help": "Enables the 24-hour plant checkup, heating-curve diagnosis and additional sources such as room temperature, weather forecast and circulation-pump power.",
    "diagnostics.off": "Off", "diagnostics.on": "On",
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
    "lang.uk": "Українська",
    "lang.saved": "Language saved",
    "ota.downgrade_confirm": (cur, avail) => `Switch back to v${avail}?\n\nThe installed version v${cur} is newer. This older build is offered because you selected a different update channel. Its signature is verified before installation, and the device restores the current build automatically if the older one cannot get online.`,
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
function operationModeFromFlags(dhw, space) {
  return dhw === true && space === true ? t("mode.space_dhw")
       : dhw === true ? t("mode.dhw")
       : space === true ? t("mode.space")
       : (dhw === false && space === false) ? t("mode.stop") : null;
}
// The diagram and its explainer are two views of the same state. X10A carries the detailed hydronic
// enum; while that bus is down, the HomeHub's two activity flags distinguish hot water, generic space
// operation and stop, but NOT Heating from Cooling. Resolve only that supportable answer here so
// a visible "Stopp" headline back into an unexplained dash.
function schematicOperationMode() {
  const hp = S.status?.hp || {};
  if (hp.connected) {
    return operationModeText(pickValue(/i\/u operation mode/i) ||
                             pickValue(/operation mode|^mode$/i));
  }
  return mbLive() ? operationModeFromFlags(mbBool(52), mbBool(53)) : null;
}
// Localise the static markup in index.html: elements tagged data-i18n get their text set from the
// dictionary. Runs once at boot (the static DOM is never rebuilt). SVG <text>/<tspan> nodes work the
// same as HTML here (textContent). Value units (°C, kW, bar, rps, l/min, K) carry no data-i18n — they
// are language-neutral and left verbatim.
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}
// Switch the live language: swap LANG, cache it for the next first paint, and re-localise the parts
// that are NOT rebuilt on a poll — the static HTML + inline SVG (applyStaticI18n) and the schematic's
// hit-target labels (labelSchematicHits, with English fallback for specialist copy). Dynamic strings repaint through
// t()/tx() on the caller's next render. A no-op (returns false) when the language is unchanged, so a
// poll that reports the same language costs nothing.
function activateLang(next) {
  if (next === LANG) return false;
  LANG = next;
  lsSet("uiLang", next);
  applyStaticI18n();
  labelSchematicHits();
  return true;
}
function setLang(next) {
  if (!uiLangSupported(next)) next = autoLang();
  if (next === "en" || I18N[next]) return activateLang(next);
  return loadLocale(next).then((loaded) => activateLang(loaded ? next : "en"));
}
// Reconcile the language with the device's stored override (/status.ui.lang): a supported language
// forces that language on this client; "auto" (or a pre-override device that omits the field) hands
// the choice back to the browser. Called from refreshStatus before the frame is painted.
function setLangFromStatus(s) {
  const stored = s && s.ui && s.ui.lang;
  return setLang(uiLangSupported(stored) ? stored : autoLang());
}
