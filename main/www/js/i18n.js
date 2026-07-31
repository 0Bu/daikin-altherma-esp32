// Web UI for daikin-altherma-esp32 — a client-side, view-switched SPA over the firmware HTTP API.
// The dashboard is what the app opens on and where it spends its life; the header gear leads to a
// Settings menu whose entries push sub-screens (Connections today), and each connection is edited
// from a modal there.
// Design contract: docs/DESIGN.md. Split from index.html for edit locality; spliced back in at
// build time (inline_assets.cmake). No framework, no external assets.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ── i18n: UI language (de | en) ──────────────────────────────────────────────
// The default is BROWSER-detected — German for a `de*` browser, English otherwise (English is the
// fallback for every key). On top of that the device can carry a MANUAL override (config ui_lang,
// POST /set_lang, /status.ui.lang): once the user picks a language it is stored in NVS and wins over
// the browser guess on every client that opens the dashboard, until they set it back to "Browser"
// (DESIGN.md §1). The heat-pump VALUE LABELS are NOT translated here: they arrive from the firmware
// over /values as English X10A register names (docs/REGISTERS.md) and stay verbatim; the
// tap-to-expand descriptions carry the German explanation instead. Dynamic strings built in this file
// go through t(); the static markup in index.html is localised by applyStaticI18n() reading data-i18n
// attributes, re-run by setLang() when the language changes live. Keep this the single source of UI
// copy so both paths agree.
const autoLang = () => (/^de\b/i.test(navigator.language || "") ? "de" : "en");
// localStorage, GUARDED: Safari private mode throws on access, and the UI must not die over a
// language cache. A failure just means no first-paint fast-path — the device's /status is the source
// of truth for the language anyway, so the only cost is one frame in the browser default.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode / quota */ } };
// Mutable, because the device's stored override can switch it at runtime. Seeded from a localStorage
// cache of the last effective language so the FIRST paint doesn't flash the browser default before
// the async /status lands, then reconciled with the device on every poll (setLangFromStatus).
let LANG = (() => { const c = lsGet("uiLang"); return c === "de" || c === "en" ? c : autoLang(); })();
// Each key is a string, or a function for the parameterised ones (same arity in both languages).
const I18N = {
  en: {
    "sys.nodata": "No data", "sys.unreachable": "Unreachable",
    "sys.x10a_down": "X10A offline", "sys.mb_carrying": "Operating mode unknown — readings from Modbus",
    "sys.mb_only": "X10A offline — readings from Modbus",
    "mode.stop": "Stop", "mode.heat": "Heating", "mode.cool": "Cooling",
    "mode.dhw": "Hot water", "mode.heat_dhw": "Heating + hot water",
    "mode.cool_dhw": "Cooling + hot water",
    "sys.unreachable_sub": "Can't reach the device — retrying…",
    "sys.waiting": "Waiting for the heat pump…", "sys.operating": "Operating",
    "sys.standby": "Standby — not running", "sys.defrosting": "Defrosting",
    "sys.circulating": "Circulating — compressor off",
    "sys.bsh_active": "Electric tank heater active",
    "sys.online": "Online", "sys.fault": "Fault", "sys.warning": "Warning",
    "sys.fault_line": (c) => "Fault · " + c + " — check the outdoor unit.",
    "sys.warning_line": (c) => "Warning · " + c + " — check the heat pump.",
    "sys.polled": (s) => `Polled ${s}s ago`,
    "recovery.title": "Recovery mode",
    "recovery.meta": "The device restarted too many times and came up in recovery mode. Heat-pump polling and MQTT are paused. Correct the configuration (for example the RX/TX pins on the Protocol card in Settings), then reboot to resume normal operation.",
    "rollback.title": "WiFi change failed — rolled back",
    "rollback.meta": (back) => `The new WiFi credentials couldn't connect, so the device restored the previous network${back} and restarted. Open Settings and check the WiFi name and password on the Connections tile, then try again.`,
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
    "bug.intro": "Describe what goes wrong. The device adds its own status, readings and log — with your network name, addresses and server names removed first.",
    "bug.what": "What happens",
    "bug.what_ph": "The tank temperature has read 12800 °C in Home Assistant since this morning.",
    "bug.need_text": "Describe what happens first — one or two sentences are enough.",
    "bug.continue": "Prepare the report",
    "bug.step2_title": "Check the report",
    "bug.step2": "This is what the device has to say about itself. Read it over, then use the button below: it copies the report and opens the issue form, with your description already filled in. Paste the report into the form's “Device report” field, answer the remaining questions, and submit.",
    "bug.collecting": "Collecting device data…",
    "bug.collect_fail": "Could not read the device — the report below says which parts are missing.",
    "bug.copy": "Copy & open GitHub", "bug.download": "Download .md",
    "bug.md_hint": "Prefer a file, or the copy did not work? Download .md saves the same report, and you can drag that file straight into the form's “Device report” field instead of pasting.",
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
    "conn.notfound": "Not found this boot — tap to retry or enter one",
    "group.Modbus": "Modbus",
    "conn.title": "Connections", "conn.offline": "Offline", "conn.disabled": "Disabled",
    "conn.connecting": "Connecting…", "conn.connected": "Connected", "conn.resolving": "Resolving…",
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
    // Named for the unit it came from: the indoor unit's rated code stands in only when the outdoor
    // unit reports no capacity, and the two are routinely different sizes.
    "card.capacity_iu": "Capacity (indoor unit)",
    "card.candidates": "Possible models", "card.oueeprom": "Outdoor unit ID",
    // The X10A observation card (logic/checkup.hpp). Row labels name what was COUNTED, not the sensor:
    // the reader is being shown a rolling aggregate, and "Water pressure" would read as the live figure
    // that is already in the value list further down.
    "card.checkup": "X10A check · 24 h",
    "check.fault": "Unit fault", "check.cycling": "Compressor starts",
    "check.defrost": "Defrost cycles", "check.pressure": "Water pressure, lowest",
    "check.flow": "Flow rate, lowest", "check.heater": "Backup heater",
    "check.retries": "Protection retries",
    "check.status.ok": "OK", "check.status.info": "NOTE",
    "check.status.warn": "WARNING", "check.status.collecting": "CHECKING",
    "check.status.observation": "MEASURED ONLY", "check.status.experimental": "EXPERIMENTAL",
    "check.status.unavailable": "NOT AVAILABLE",
    "check.summary": (s, n, a) => a > 0 ? `${s} · ${n}/${a} assessed` : s,
    "check.detail.label": "Status:",
    "check.detail.ok": "Assessment complete; no finding in the observed X10A data.",
    "check.detail.info": "Notable value or pattern; this is not proof of a defect.",
    "check.detail.warn": "A device finding or documented limit needs attention.",
    "check.detail.collecting": (n, r) => `${n} of ${r} captured; no assessment is possible yet.`,
    "check.detail.collecting_unknown": "Not enough usable evidence for an assessment yet.",
    "check.detail.observation": "Measured value only; there is no universal OK/WARNING limit.",
    "check.detail.experimental": "Experimental observation; a stable counter is not proof that no limiting occurred.",
    "check.detail.unavailable": "The active profile provides no assessable data for this check.",
    "check.starts": (n) => `${n} ${n === 1 ? "start" : "starts"}`,
    "check.cycles": (n) => `${n} ${n === 1 ? "cycle" : "cycles"}`,
    "check.paired_cycles": (n) => `${n} paired`,
    "check.mean": (d) => `${d}/start`,
    "check.min": (m) => `${m} min`,
    "check.tank": (m) => `tank ${m} min`,
    "check.tank_runtime": (d) => `tank ${d}`,
    "check.fault_err": "Fault active", "check.fault_warn": "Warning active",
    "check.fault_past": "Seen in window", "check.fault_none": "None active",
    "check.fault_unknown": "Current state unknown",
    "check.fault_past_unknown": "Seen in window · current state unknown",
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
    "chip.demand_on": "Demand ON", "chip.demand_off": "Demand OFF", "chip.quiet": "Quiet",
    "schem.sg_boost": "BOOST",
    "sg.mode0": "Free running", "sg.mode1": "Forced off",
    "sg.mode2": "Recommended on", "sg.mode3": "Forced on",
    "schem.to_dhw": "3WV → DHW", "schem.to_heat": "3WV → heating",
    "normal.label": "Normal:",
    "hist.title": "Last 24 hours", "hist.since": (h) => `Since restart · ${h} h`,
    "hist.now": "now", "hist.ago": (h) => `${h} h ago`,
    "hist.loading": "Loading trend…", "hist.none": "No readings recorded yet.",
    "hist.err": "Trend unavailable.",
    "hist.gaps": (n) => `${n} gap${n === 1 ? "" : "s"} — not measured`,
    "hist.nm": "not measured", "hist.rel": (h) => `${h} h ago`,
    "hist.held": "outdoor unit resting", "hist.heldnote": (h) => `${h} h resting — not measured`,
    "hist.aria": (l) => `${l} — 24-hour trend. Arrow keys read out individual samples.`,
    "hist.aria_pinned": (l, r) => `${l} — 24-hour trend. Pinned readout: ${r}. Tap it again to clear.`,
    "hist.pin_hint": "tap to pin",
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
    "ota.unreachable": "device unreachable",
    // The install finished; only the automatic page reload gave up waiting for the board.
    "ota.reload_hint": "installed — reload the page",
    "ota.confirm": (cur, avail) => `Update available: v${cur} → v${avail}\n\nThe device downloads and installs the signed image, then reboots. If the new firmware can't get online it rolls back automatically.`,
    "aria.ota": "Check for firmware updates",
    "ota.title_check": "Tap to check for firmware updates",
    "ota.title_avail": (v) => `Update v${v} available — tap to install`,
    "mq.err_format": "Enter host:port — e.g. 192.168.1.10:1883 — or mqtts://host:8883 for TLS",
    "sl.err_port": "Port must be a whole number 1–65535 (e.g. logs.example.com:514).",
    "btn.saving": "Saving…", "btn.save": "Save", "btn.cancel": "Cancel", "btn.close": "Close",
    // static index.html markup (data-i18n)
    "schem.outdoor_unit": "OUTDOOR UNIT", "schem.defrost_pill": "❄ defrost", "schem.outdoor": "Outdoor",
    "insp.close": "Close",
    "schem.leaving_water": "leaving water · pre-BUH", "schem.dhw_tank": "DHW TANK", "schem.set": "set",
    "schem.bsh_badge": "E-heater active",
    "schem.heating": "HEATING", "schem.pump": "PUMP", "schem.return": "return", "schem.room": "Room",
    "schem.flow_rate": "flow", "schem.water_press": "water pressure",
    "wifi.title": "WiFi configuration", "wifi.ssid": "WiFi network (SSID)", "wifi.pass": "WiFi password",
    "wifi.err_ssid": "SSID must be 32 characters or less",
    "wifi.err_pass": "Password must be empty (open network) or between 8 and 63 characters",
    "wifi.hint": "SSID is required. If connection to the new network fails, the device rolls back to the old WiFi settings.",
    "mqtt.title": "MQTT broker", "mqtt.hostport": "Host : port", "mqtt.user": "Username · optional",
    "mqtt.pass": "Password · optional", "mqtt.clear": "Remove stored credentials — connect anonymously",
    "mqtt.hint": "Credentials require a TLS broker — use an mqtts:// URL (e.g. mqtts://host:8883). Empty host disables MQTT.",
    "syslog.title": "Syslog server", "syslog.hostport": "Host : port",
    "syslog.hint": "IP address or hostname and port of the Syslog server. Empty host disables Syslog.",
    "ntp.title": "NTP server", "ntp.server": "Server",
    "ntp.hint": "Hostname or IP of the NTP server the device syncs its clock from. Empty resets to the firmware default.",
    // HomeHub / transport card + its edit modal (issue #32). The link is READ-ONLY — the copy must
    // never imply the firmware controls the pump from here (docs/SECURITY.md).
    "homehub.title": "Modbus", "homehub.mode": "Connection mode",
    "homehub.mode_auto": "Find automatically", "homehub.mode_manual": "Manual address",
    "homehub.mode_off": "Disabled", "homehub.host": "Host · IP or .local name",
    "homehub.port": "Port", "homehub.unit": "Unit id",
    "homehub.hint": "Automatic search makes a bounded set of attempts per boot and then stops. A later boot tries again; only Disabled stops future searches. Selecting automatic search again retries immediately. Port defaults to 502, unit id to 1. Read-only — the firmware never controls the heat pump from here.",
    "hh.searching": "Searching…", "hh.saved": "Modbus settings saved",
    "hh.err_host": "Enter a HomeHub address for Manual mode",
    "hh.err_port": "Port must be between 1 and 65535",
    "hh.err_unit": "Unit id must be between 1 and 247",
    "board.title": "Board hardware", "board.ledtype": "Status LED", "board.none": "None",
    "board.preset": "Board", "board.preset_custom": "Custom",
    "board.led_gpio": "Plain LED (GPIO)", "board.led_ws2812": "Addressable RGB (WS2812)",
    "board.ledpin": "LED pin", "board.btnpin": "Reset button pin",
    "board.ledinv": "Active low (LED lights when the pin is driven LOW)",
    "board.btninv": "Active low (button shorts the pin to GND)",
    "board.hint": "Holding the reset button for 5 seconds ERASES all stored settings (WiFi, MQTT, Syslog/NTP) and reboots into the setup portal — the LED flashes red while it is armed, then turns solid white while erasing. Leave the button on \"None\" unless one is actually wired: an unconnected pin can float and trigger it.",
    "card.hardware": "Hardware", "card.hw_off": "None",
    "card.hw_led": (pin, kind) => `GPIO${pin} · ${kind}`, "card.hw_btn": (pin) => `GPIO${pin}`,
    // Firmware / update channel (ESP32 card). Two published feeds: releases are cut by hand, the
    // dev feed follows every merge to main. "Version" is the running build, "Update channel" is
    // which feed the next check reads.
    "card.firmware": "Version", "card.channel": "Update channel",
    "chan.release": "Release", "chan.dev": "Development",
    "chan.saved": (c) => `Update channel: ${c}`,
    // Settings card titles (the old ESP32 card split into ESP32 / Protocol / Firmware) + the UI
    // language override. "auto" is labelled "Browser" — it IS the browser's own navigator.language,
    // not a separate automatic mode; de/en are named in their OWN tongue, the convention for a
    // language picker.
    "card.proto_title": "Protocol", "card.fw_title": "Firmware",
    "card.language": "Language",
    "lang.auto": "Browser", "lang.de": "Deutsch", "lang.en": "English",
    "lang.saved": "Language saved",
    "ota.downgrade_confirm": (cur, avail) => `Switch back to v${avail}?\n\nThe device is running v${cur}, which is NEWER. Installing an older build is only offered because you picked a different update channel; the signed image is verified exactly as an update is, and the device rolls back automatically if it can't get online.`,
  },
  de: {
    "sys.nodata": "Keine Daten", "sys.unreachable": "Nicht erreichbar",
    "sys.x10a_down": "X10A offline", "sys.mb_carrying": "Betriebsart unbekannt — Werte aus dem Modbus",
    "sys.mb_only": "X10A offline — Werte aus dem Modbus",
    "mode.stop": "Stopp", "mode.heat": "Heizen", "mode.cool": "Kühlen",
    "mode.dhw": "Warmwasser", "mode.heat_dhw": "Heizen + Warmwasser",
    "mode.cool_dhw": "Kühlen + Warmwasser",
    "sys.unreachable_sub": "Gerät nicht erreichbar — erneuter Versuch…",
    "sys.waiting": "Warte auf die Wärmepumpe…", "sys.operating": "In Betrieb",
    "sys.standby": "Bereitschaft — läuft nicht", "sys.defrosting": "Abtauen",
    "sys.circulating": "Umwälzung — Verdichter aus",
    "sys.bsh_active": "Heizstab aktiv",
    "sys.online": "Online", "sys.fault": "Störung", "sys.warning": "Warnung",
    "sys.fault_line": (c) => "Störung · " + c + " — Außeneinheit prüfen.",
    "sys.warning_line": (c) => "Warnung · " + c + " — Wärmepumpe prüfen.",
    "sys.polled": (s) => `vor ${s}s abgefragt`,
    "recovery.title": "Wiederherstellungsmodus",
    "recovery.meta": "Das Gerät ist zu oft neu gestartet und im Wiederherstellungsmodus hochgefahren. Wärmepumpen-Abfrage und MQTT sind pausiert. Korrigiere in den Einstellungen die Konfiguration, etwa die RX/TX-Pins auf der Protokoll-Karte, und starte neu, um den Normalbetrieb fortzusetzen.",
    "rollback.title": "WLAN-Änderung fehlgeschlagen — zurückgesetzt",
    "rollback.meta": (back) => `Die neuen WLAN-Zugangsdaten konnten sich nicht verbinden, daher hat das Gerät das vorherige Netzwerk${back} wiederhergestellt und neu gestartet. Öffne die Einstellungen und prüfe in der Kachel „Verbindungen“ WLAN-Name und Passwort, dann versuche es erneut.`,
    "crash.title_fault": "Gerät ist nach einem Absturz neu gestartet",
    "crash.title_orphan": "Absturzbericht von einem früheren Neustart",
    "crash.reset": "Reset", "crash.task": "Task", "crash.fw": "FW", "crash.elf": "elf", "crash.corrupted": "beschädigt",
    "crash.download": "Absturzbericht herunterladen", "crash.copy": "Diagnose kopieren", "crash.dismiss": "Bericht löschen",
    "crash.copied": "Diagnose kopiert — in einen Fehlerbericht einfügen",
    "crash.copy_fail": "Kopieren fehlgeschlagen — /coredump und /diag manuell öffnen",
    "crash.ask_dump": "Auf dem Gerät löschen? Der Core-Dump geht mit — lade ihn vorher für einen Fehlerbericht herunter.",
    "crash.ask": "Diesen Bericht auf dem Gerät löschen?",
    "crash.ask_yes": "Löschen", "crash.ask_no": "Behalten",
    "crash.deleted": "Absturzbericht gelöscht",
    "crash.delete_fail": "Das Gerät konnte ihn nicht löschen — der Bericht ist noch da",
    "bug.row": "Fehler melden",
    "bug.title": "Fehler melden",
    "bug.intro": "Beschreibe, was schiefgeht. Das Gerät legt seinen Zustand, seine Messwerte und sein Protokoll dazu — Netzwerkname, Adressen und Servernamen vorher entfernt.",
    "bug.what": "Was passiert",
    "bug.what_ph": "Die Speichertemperatur zeigt seit heute Morgen 12800 °C in Home Assistant.",
    "bug.need_text": "Beschreibe zuerst, was passiert — ein bis zwei Sätze genügen.",
    "bug.continue": "Bericht erstellen",
    "bug.step2_title": "Bericht prüfen",
    "bug.step2": "Das sagt das Gerät über sich selbst. Lies es durch und nimm dann den Knopf unten: er kopiert den Bericht und öffnet das Formular, deine Beschreibung steht schon drin. Füge den Bericht dort im Feld „Device report“ ein, beantworte die restlichen Fragen und schick es ab.",
    "bug.collecting": "Sammle Gerätedaten…",
    "bug.collect_fail": "Das Gerät war nicht vollständig lesbar — im Bericht unten steht, was fehlt.",
    "bug.copy": "Kopieren & GitHub öffnen", "bug.download": ".md herunterladen",
    "bug.md_hint": "Lieber eine Datei, oder das Kopieren hat nicht geklappt? „.md herunterladen“ speichert denselben Bericht — die Datei kannst du im Formular einfach ins Feld „Device report“ ziehen statt einzufügen.",
    "bug.copied": "Bericht kopiert — im Feld „Device report“ einfügen",
    "bug.copy_fail": "Kopieren fehlgeschlagen — Text unten markieren und von Hand kopieren",
    "bug.redacted": "Netzwerkname, Adressen, Broker und Servernamen sind bereits entfernt.",
    "nav.settings": "Einstellungen", "nav.back": "Zurück",
    "nav.settings_alert": (n) => `Einstellungen — ${n} Verbindung${n === 1 ? "" : "en"} gestört`,
    // ── Die beiden Quellen (X10A + der HomeHub-Modbus-Stack) ──
    "src.modbus_tag": "modbus",
    "src.agree": "Beide Quellen einig",
    "src.delta": (d, u) => `Abweichung ${d}${u ? " " + u : ""}`,
    "src.disagree": "Die beiden Quellen widersprechen sich bei diesem Zustand",
    "conn.homehub": "HomeHub", "conn.searching": "Suche…",
    "conn.notfound": "Bei diesem Start nicht gefunden — zum Wiederholen oder Eintragen tippen",
    "group.Modbus": "Modbus",
    "conn.title": "Verbindungen", "conn.offline": "Offline", "conn.disabled": "Deaktiviert",
    "conn.connecting": "Verbinde…", "conn.connected": "Verbunden", "conn.resolving": "Löse auf…",
    "conn.enabled": "Aktiv", "conn.enabled_noping": "Aktiv, Host antwortet nicht auf Ping",
    "conn.synced": "Synchronisiert", "conn.syncing": "Synchronisiere…",
    "conn.error": (e) => "Fehler: " + e, "conn.connected_to": (s) => "Verbunden mit " + s,
    "conn.aria": (label, state) => `${label}: ${state}. Zum Bearbeiten tippen.`,
    "modbus.err.mdns_not_found": "Kein HomeHub per mDNS gefunden.",
    "modbus.err.no_address": "Keine HomeHub-Adresse eingetragen.",
    "modbus.err.resolve_failed": "Die HomeHub-Adresse konnte nicht aufgelöst werden.",
    "modbus.err.connect_timeout": "Zeitüberschreitung — der HomeHub ist nicht erreichbar.",
    "modbus.err.connection_refused": "HomeHub erreichbar, aber der Modbus-TCP-Port ist geschlossen.",
    "modbus.err.network_unreachable": "Keine Netzwerkroute zum HomeHub.",
    "modbus.err.host_unreachable": "Der HomeHub ist im Netzwerk nicht erreichbar.",
    "modbus.err.connect_failed": "Die Verbindung zum HomeHub ist fehlgeschlagen.",
    "modbus.err.request_failed": (r) => `Modbus-Anfrage konnte${r ? ` für Register ${r}` : ""} nicht erstellt werden.`,
    "modbus.err.send_timeout": (r) => `Zeitüberschreitung beim Senden der Modbus-Anfrage${r ? ` an Register ${r}` : ""}.`,
    "modbus.err.send_failed": (r) => `Modbus-Anfrage konnte${r ? ` an Register ${r}` : ""} nicht gesendet werden.`,
    "modbus.err.response_timeout": (r) => `Zeitüberschreitung bei der HomeHub-Antwort${r ? ` an Register ${r}` : ""}.`,
    "modbus.err.connection_closed": (r) => `Der HomeHub hat die Verbindung${r ? ` an Register ${r}` : ""} geschlossen.`,
    "modbus.err.receive_failed": (r) => `HomeHub-Antwort konnte${r ? ` an Register ${r}` : ""} nicht gelesen werden.`,
    "modbus.err.invalid_response": (r) => `Ungültige Modbus-Antwort${r ? ` an Register ${r}` : ""}.`,
    "modbus.err.internal_error": "Der Modbus-Abfragezyklus ist intern fehlgeschlagen.",
    "modbus.err.exception": (r, n, why) => `HomeHub lehnt Register ${r || "?"} ab — Ausnahme ${n}: ${why}.`,
    "modbus.exc.1": "unzulässige Funktion", "modbus.exc.2": "unzulässige Registeradresse",
    "modbus.exc.3": "unzulässiger Wert", "modbus.exc.4": "Gerätefehler",
    "modbus.exc.5": "Anfrage bestätigt", "modbus.exc.6": "Gerät beschäftigt",
    "modbus.exc.8": "Speicher-Paritätsfehler", "modbus.exc.10": "Gateway-Pfad nicht verfügbar",
    "modbus.exc.11": "Ziel antwortet nicht", "modbus.exc.unknown": "unbekannter Grund",
    "card.model": "Modell", "card.hplink": "Wärmepumpen-Verbindung", "card.online": "Online",
    "card.uptime": "Laufzeit",
    "card.freeheap": "Freier Speicher", "card.maxalloc": "Größter freier Block",
    "card.offline": "Offline", "card.protocol": "Protokoll", "card.rxpin": "RX-Pin",
    "card.txpin": "TX-Pin", "card.capacity": "Nennleistung der Außeneinheit",
    "card.capacity_iu": "Nennleistung der Inneneinheit",
    "card.candidates": "Mögliche Modelle", "card.oueeprom": "Kennung der Außeneinheit",
    "card.checkup": "X10A-Check · 24 h",
    "check.fault": "Störung der Anlage", "check.cycling": "Verdichterstarts",
    "check.defrost": "Abtauvorgänge", "check.pressure": "Wasserdruck, niedrigster",
    "check.flow": "Durchfluss, niedrigster", "check.heater": "Zusatzheizer",
    "check.retries": "Schutz-Rückregelungen",
    "check.status.ok": "OK", "check.status.info": "HINWEIS",
    "check.status.warn": "WARNUNG", "check.status.collecting": "PRÜFT",
    "check.status.observation": "NUR MESSWERT", "check.status.experimental": "EXPERIMENTELL",
    "check.status.unavailable": "NICHT VERFÜGBAR",
    "check.summary": (s, n, a) => a > 0 ? `${s} · ${n}/${a} bewertet` : s,
    "check.detail.label": "Status:",
    "check.detail.ok": "Bewertung abgeschlossen; kein Befund in den beobachteten X10A-Daten.",
    "check.detail.info": "Auffälliger Wert oder Verlauf; das ist kein Defektnachweis.",
    "check.detail.warn": "Ein Gerätebefund oder eine dokumentierte Grenze erfordert Prüfung.",
    "check.detail.collecting": (n, r) => `${n} von ${r} erfasst; eine Bewertung ist noch nicht möglich.`,
    "check.detail.collecting_unknown": "Noch nicht genug verwertbare Evidenz für eine Bewertung.",
    "check.detail.observation": "Nur Messwert; dafür gibt es keinen allgemeinen Grenzwert für OK oder WARNUNG.",
    "check.detail.experimental": "Experimentelle Beobachtung; ein stabiler Zähler beweist nicht, dass keine Begrenzung stattfand.",
    "check.detail.unavailable": "Das aktive Profil liefert für diese Prüfung keine auswertbaren Daten.",
    "check.starts": (n) => `${n} ${n === 1 ? "Start" : "Starts"}`,
    "check.cycles": (n) => `${n} ${n === 1 ? "Vorgang" : "Vorgänge"}`,
    "check.paired_cycles": (n) => `${n} gepaart`,
    "check.mean": (d) => `${d}/Start`,
    "check.min": (m) => `${m} min`,
    "check.tank": (m) => `Speicher ${m} min`,
    "check.tank_runtime": (d) => `Speicher ${d}`,
    "check.fault_err": "Störung aktiv", "check.fault_warn": "Warnung aktiv",
    "check.fault_past": "Im Fenster aufgetreten", "check.fault_none": "Aktuell keine",
    "check.fault_unknown": "Aktueller Zustand unbekannt",
    "check.fault_past_unknown": "Im Fenster aufgetreten · aktuell unbekannt",
    "check.retry_seen": "Zähleranstieg beobachtet", "check.retry_none": "Kein Anstieg beobachtet",
    "values.waiting": "Warte auf die erste Abfrage…",
    "values.sg_x10a_mode": "Smart-Grid-Betriebsart (X10A-Kontakte)",
    "group.Operation": "Betrieb", "group.Domestic hot water": "Warmwasser",
    "group.Water circuit": "Wasserkreis", "group.Refrigerant / outdoor": "Kältemittel und Außeneinheit",
    "group.Electrical": "Elektrik", "group.Device": "Gerät", "group.Other values": "Weitere Werte",
    "group.Protection": "Schutz", "protect.limiting": "regelt zurück",
    "group.Values": "Werte",
    // Register-state tokens stay ON/OFF in both languages. The X10A labels are English technical
    // names ("Reheat ON/OFF", "Storage comfort ON/OFF"), so mixing them with EIN/AUS reads as one
    // broken label rather than as a translation.
    "state.on": "ON", "state.off": "OFF",
    // Deutsche Herstellerbegriffe aus EKRHH 4P744838-1E §9.2.
    "enum.auto": "Auto", "enum.heating": "Heizen", "enum.cooling": "Kühlen",
    "enum.no_error": "Kein Fehler", "enum.fault": "Fehler", "enum.warning": "Warnung",
    "enum.space_heating": "Raumheizung", "enum.dhw": "Brauchwarmwasser",
    "enum.free_running": "Freier Betrieb", "enum.forced_off": "Zwangsabschaltung",
    "enum.recommended_on": "Empfehlung ein", "enum.forced_on": "Erzwungen ein",
    "enum.unknown": (n) => `Unbekannt (${n})`,
    "chip.demand_on": "Anforderung ON", "chip.demand_off": "Anforderung OFF", "chip.quiet": "Leise",
    "schem.sg_boost": "BOOST",
    "sg.mode0": "Freier Betrieb", "sg.mode1": "Zwangsabschaltung",
    "sg.mode2": "Empfehlung ein", "sg.mode3": "Erzwungen ein",
    "schem.to_dhw": "3WV → WW", "schem.to_heat": "3WV → Heizung",
    "normal.label": "Normal:",
    "hist.title": "Letzte 24 Stunden", "hist.since": (h) => `Seit Neustart · ${h} h`,
    "hist.now": "jetzt", "hist.ago": (h) => `vor ${h} h`,
    "hist.loading": "Verlauf wird geladen…", "hist.none": "Noch keine Messwerte aufgezeichnet.",
    "hist.err": "Verlauf nicht verfügbar.",
    "hist.gaps": (n) => `${n} Lücke${n === 1 ? "" : "n"} — nicht gemessen`,
    "hist.nm": "nicht gemessen", "hist.rel": (h) => `vor ${h} h`,
    "hist.held": "Außeneinheit ruht", "hist.heldnote": (h) => `${h} h Stillstand — nicht gemessen`,
    "hist.aria": (l) => `${l} — 24-Stunden-Verlauf. Mit den Pfeiltasten einzelne Messpunkte ablesen.`,
    "hist.aria_pinned": (l, r) => `${l} — 24-Stunden-Verlauf. Angehefteter Wert: ${r}. Nochmal antippen zum Entfernen.`,
    "hist.pin_hint": "antippen zum Anheften",
    "toast.saved": "Gespeichert", "toast.no_changes": "Keine Änderungen",
    "toast.reboot": "Neustart — verbinde neu…", "toast.rebooted": "Neu gestartet — bitte neu mit dem Gerät verbinden",
    "toast.busy_retry": "Gerät ausgelastet — gleich erneut versuchen", "toast.unreachable": "Gerät nicht erreichbar",
    "toast.rejected": "Abgelehnt", "toast.applying": "Letzte Änderung wird noch angewendet…",
    "toast.check_wifi": "WLAN-Einstellungen prüfen", "toast.check_broker": "Broker-Adresse prüfen",
    "toast.check_syslog_port": "Syslog-Port prüfen",
    "toast.verifying_mqtt": "Prüfe MQTT-Verbindung…", "toast.saving_syslog": "Speichere Syslog-Einstellungen…",
    "toast.saving_ntp": "Speichere NTP-Einstellungen…", "toast.trying_pins": "Teste Pins…",
    "toast.saving_board": "Speichere Board-Hardware…",
    "ota.uptodate": "aktuell", "ota.check_failed": "Prüfung fehlgeschlagen", "ota.starting": "starte…",
    "ota.pct": (p) => `${p}%`, "ota.rebooting": "Neustart…", "ota.failed": "Update fehlgeschlagen",
    "ota.timeout": "Zeitüberschreitung", "ota.cancelled": "abgebrochen", "ota.busy": "Gerät ausgelastet",
    "ota.unreachable": "Gerät nicht erreichbar",
    "ota.reload_hint": "installiert — Seite neu laden",
    "ota.confirm": (cur, avail) => `Update verfügbar: v${cur} → v${avail}\n\nDas Gerät lädt das signierte Abbild, installiert es und startet neu. Kommt die neue Firmware nicht online, wird automatisch zurückgesetzt.`,
    "aria.ota": "Nach Firmware-Updates suchen",
    "ota.title_check": "Tippen, um nach Firmware-Updates zu suchen",
    "ota.title_avail": (v) => `Update v${v} verfügbar — tippen zum Installieren`,
    "mq.err_format": "Host:Port eingeben — z. B. 192.168.1.10:1883 — oder mqtts://host:8883 für TLS",
    "sl.err_port": "Port muss eine ganze Zahl von 1 bis 65535 sein, zum Beispiel logs.example.com:514.",
    "btn.saving": "Speichere…", "btn.save": "Speichern", "btn.cancel": "Abbrechen", "btn.close": "Schließen",
    // static index.html markup (data-i18n)
    "schem.outdoor_unit": "AUSSENEINHEIT", "schem.defrost_pill": "❄ Abtauen", "schem.outdoor": "Außen",
    "insp.close": "Schließen",
    "schem.leaving_water": "Vorlauf · vor BUH", "schem.dhw_tank": "WW-SPEICHER", "schem.set": "Soll",
    "schem.bsh_badge": "Heizstab aktiv",
    "schem.heating": "HEIZUNG", "schem.pump": "PUMPE", "schem.return": "Rücklauf", "schem.room": "Raum",
    "schem.flow_rate": "Durchfluss", "schem.water_press": "Wasserdruck",
    "wifi.title": "WLAN-Konfiguration", "wifi.ssid": "WLAN-Netzwerk · SSID", "wifi.pass": "WLAN-Passwort",
    "wifi.err_ssid": "SSID darf höchstens 32 Zeichen haben",
    "wifi.err_pass": "Für ein offenes Netz muss das Passwort leer sein, sonst 8–63 Zeichen lang",
    "wifi.hint": "SSID ist erforderlich. Scheitert die Verbindung zum neuen Netz, setzt das Gerät auf die alten WLAN-Einstellungen zurück.",
    "mqtt.title": "MQTT-Broker", "mqtt.hostport": "Host : Port", "mqtt.user": "Benutzername · optional",
    "mqtt.pass": "Passwort · optional", "mqtt.clear": "Gespeicherte Zugangsdaten entfernen — anonym verbinden",
    "mqtt.hint": "Zugangsdaten erfordern einen TLS-Broker — eine mqtts://-URL verwenden, zum Beispiel mqtts://host:8883. Ein leerer Host deaktiviert MQTT.",
    "syslog.title": "Syslog-Server", "syslog.hostport": "Host : Port",
    "syslog.hint": "IP-Adresse oder Hostname und Port des Syslog-Servers. Leerer Host deaktiviert Syslog.",
    "ntp.title": "NTP-Server", "ntp.server": "Server",
    "ntp.hint": "Hostname oder IP des NTP-Servers, mit dem das Gerät seine Uhr synchronisiert. Leer setzt auf den Firmware-Standard zurück.",
    "homehub.title": "Modbus", "homehub.mode": "Verbindungsmodus",
    "homehub.mode_auto": "Automatisch suchen", "homehub.mode_manual": "Adresse manuell",
    "homehub.mode_off": "Deaktiviert", "homehub.host": "Host · IP oder .local-Name",
    "homehub.port": "Port", "homehub.unit": "Unit-ID",
    "homehub.hint": "Die automatische Suche versucht es pro Start mehrmals und beendet sich dann. Beim nächsten Start wird erneut gesucht; nur Deaktiviert verhindert weitere Suchen. Automatisch suchen und Speichern wiederholt die Suche sofort. Port ist standardmäßig 502, die Unit-ID 1. Nur lesend — die Firmware steuert die Wärmepumpe von hier aus nie.",
    "hh.searching": "Suche läuft…", "hh.saved": "Modbus-Einstellungen gespeichert",
    "hh.err_host": "Für den manuellen Modus eine HomeHub-Adresse eingeben",
    "hh.err_port": "Port muss zwischen 1 und 65535 liegen",
    "hh.err_unit": "Unit-ID muss zwischen 1 und 247 liegen",
    "board.title": "Board-Hardware", "board.ledtype": "Status-LED", "board.none": "Keine",
    "board.preset": "Board", "board.preset_custom": "Benutzerdefiniert",
    "board.led_gpio": "Einfache LED · GPIO", "board.led_ws2812": "Adressierbare RGB-LED · WS2812",
    "board.ledpin": "LED-Pin", "board.btnpin": "Reset-Taster-Pin",
    "board.ledinv": "Aktiv bei LOW — LED leuchtet bei niedrigem Pin-Pegel",
    "board.btninv": "Aktiv bei LOW — Taster zieht den Pin auf GND",
    "board.hint": "Den Reset-Taster 5 Sekunden zu halten LÖSCHT alle gespeicherten Einstellungen wie WLAN, MQTT, Syslog und NTP und startet ins Setup-Portal neu — die LED blinkt rot, solange der Vorgang scharf ist, und leuchtet dann weiß, während gelöscht wird. Den Taster auf „Keine“ lassen, solange keiner verdrahtet ist: ein offener Pin kann floaten und ihn auslösen.",
    "card.hardware": "Hardware", "card.hw_off": "Keine",
    "card.hw_led": (pin, kind) => `GPIO${pin} · ${kind}`, "card.hw_btn": (pin) => `GPIO${pin}`,
    "card.firmware": "Version", "card.channel": "Update-Kanal",
    "chan.release": "Release", "chan.dev": "Development",
    "chan.saved": (c) => `Update-Kanal: ${c}`,
    // Karten-Titel (die alte ESP32-Karte in ESP32 / Protokoll / Firmware unterteilt) + die
    // UI-Sprache. "auto" hei\u00dft "Browser" \u2014 es IST die eigene navigator.language des Browsers, kein
    // separater Automatik-Modus; de/en sind in ihrer EIGENEN Sprache benannt, wie bei einer
    // Sprachauswahl \u00fcblich.
    "card.proto_title": "Protokoll", "card.fw_title": "Firmware",
    "card.language": "Sprache",
    "lang.auto": "Browser", "lang.de": "Deutsch", "lang.en": "English",
    "lang.saved": "Sprache gespeichert",
    "ota.downgrade_confirm": (cur, avail) => `Zur\u00fcck auf v${avail} wechseln?\n\nDas Ger\u00e4t l\u00e4uft auf v${cur} \u2014 also NEUER. Ein \u00e4lterer Stand wird nur angeboten, weil du einen anderen Update-Kanal gew\u00e4hlt hast; das signierte Abbild wird genauso gepr\u00fcft wie bei einem Update, und das Ger\u00e4t setzt automatisch zur\u00fcck, wenn es nicht online kommt.`,
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
  return dhw === true ? t("mode.dhw")
       : space === true ? t("mode.heat")
       : (dhw === false && space === false) ? t("mode.stop") : null;
}
// The diagram and its explainer are two views of the same state. X10A carries the detailed hydronic
// enum; while that bus is down, the HomeHub's two activity flags still distinguish hot water, space
// operation and stop. Resolve that one user-facing answer here so opening the explainer cannot turn
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
// hit-target labels (labelSchematicHits, whose copy is bilingual). Dynamic strings repaint through
// t()/tx() on the caller's next render. A no-op (returns false) when the language is unchanged, so a
// poll that reports the same language costs nothing.
function setLang(next) {
  if (next !== "de" && next !== "en") next = autoLang();
  if (next === LANG) return false;
  LANG = next;
  lsSet("uiLang", next);
  applyStaticI18n();
  labelSchematicHits();
  return true;
}
// Reconcile the language with the device's stored override (/status.ui.lang): "de"/"en" force that
// language on this client, "auto" (or a pre-override device that omits the field) hands the choice
// back to the browser. Called from refreshStatus before the frame is painted.
function setLangFromStatus(s) {
  const stored = s && s.ui && s.ui.lang;
  return setLang(stored === "de" || stored === "en" ? stored : autoLang());
}
