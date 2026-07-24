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

// ── i18n: browser-detected UI language (de | en) ─────────────────────────────
// The device serves ONE page; the language is chosen client-side from the browser, no selector and
// no server round-trip (DESIGN.md §1). German for a `de*` browser, English otherwise — English is
// the fallback for every key. The heat-pump VALUE LABELS are NOT translated here: they arrive from
// the firmware over /values as English X10A register names (docs/REGISTERS.md) and stay verbatim;
// the tap-to-expand descriptions carry the German explanation instead. Dynamic strings built in this
// file go through t(); the static markup in index.html is localised by applyStaticI18n() reading
// data-i18n attributes. Keep this the single source of UI copy so both paths agree.
const LANG = /^de\b/i.test(navigator.language || "") ? "de" : "en";
// Each key is a string, or a function for the parameterised ones (same arity in both languages).
const I18N = {
  en: {
    "sys.nodata": "No data", "sys.unreachable": "Unreachable",
    "sys.unreachable_sub": "Can't reach the device — retrying…",
    "sys.waiting": "Waiting for the heat pump…", "sys.operating": "Operating",
    "sys.standby": "Standby — not running", "sys.defrosting": "Defrosting",
    "sys.circulating": "Circulating — compressor off",
    "sys.online": "Online", "sys.fault": "Fault",
    "sys.fault_line": (c) => "Fault · " + c + " — check the outdoor unit.",
    "sys.polled": (s) => `Polled ${s}s ago`,
    "recovery.title": "Recovery mode",
    "recovery.meta": "The device restarted too many times and came up in recovery mode. Heat-pump polling and MQTT are paused. Correct the configuration (for example the RX/TX pins on the ESP32 card in Settings), then reboot to resume normal operation.",
    "rollback.title": "WiFi change failed — rolled back",
    "rollback.meta": (back) => `The new WiFi credentials couldn't connect, so the device restored the previous network${back} and restarted. Open Settings and check the WiFi name and password on the Connections tile, then try again.`,
    "crash.title_fault": "Device restarted after a crash",
    "crash.title_orphan": "Crash report waiting from an earlier restart",
    "crash.reset": "Reset", "crash.task": "task", "crash.fw": "fw", "crash.elf": "elf", "crash.corrupted": "corrupted",
    "crash.download": "Download crash report", "crash.copy": "Copy diagnostics", "crash.dismiss": "Dismiss",
    "crash.copied": "Diagnostics copied — paste into a bug report",
    "crash.copy_fail": "Copy failed — open /coredump and /diag manually",
    "nav.settings": "Settings", "nav.back": "Back",
    "nav.settings_alert": (n) => `Settings — ${n} connection${n === 1 ? "" : "s"} down`,
    "conn.title": "Connections", "conn.offline": "Offline", "conn.disabled": "Disabled",
    "conn.connecting": "Connecting…", "conn.connected": "Connected", "conn.resolving": "Resolving…",
    "conn.enabled": "Enabled", "conn.enabled_noping": "Enabled, host not answering ping",
    "conn.synced": "Synced", "conn.syncing": "Syncing…",
    "conn.error": (e) => "Error: " + e, "conn.connected_to": (s) => "Connected to " + s,
    "conn.aria": (label, state) => `${label}: ${state}. Tap to edit.`,
    "card.model": "Model", "card.uptime": "Uptime", "card.lastreset": "Last reset",
    "card.freeheap": "Free heap", "card.hplink": "Heat-pump link", "card.online": "Online",
    "card.offline": "Offline", "card.protocol": "Protocol", "card.rxpin": "RX pin",
    "card.txpin": "TX pin", "card.capacity": "Capacity",
    "values.waiting": "Waiting for the first poll…",
    "group.Operation": "Operation", "group.Domestic hot water": "Domestic hot water",
    "group.Water circuit": "Water circuit", "group.Refrigerant / outdoor": "Refrigerant / outdoor",
    "group.Electrical": "Electrical", "group.Device": "Device", "group.Other values": "Other values",
    "group.Values": "Values",
    "chip.thermo_on": "Thermostat ON", "chip.thermo_off": "Thermostat off", "chip.quiet": "Quiet",
    "schem.to_dhw": "3WV → DHW", "schem.to_heat": "3WV → heating",
    "normal.label": "Normal:",
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
    "btn.saving": "Saving…", "btn.save": "Save", "btn.cancel": "Cancel",
    // static index.html markup (data-i18n)
    "schem.outdoor_unit": "OUTDOOR UNIT", "schem.defrost_pill": "❄ defrost", "schem.outdoor": "Outdoor",
    "schem.est": "estimated",
    "insp.hint": "Tap a value or component in the diagram for an explanation.",
    "insp.close": "Close",
    "schem.leaving_water": "leaving water · pre-BUH", "schem.dhw_tank": "DHW TANK", "schem.set": "set",
    "schem.heating": "HEATING", "schem.pump": "PUMP", "schem.return": "return", "schem.room": "Room",
    "kpi.target": "target",
    "schem.est_src": (s) => "estimated · " + s, "schem.no_ct": "no current sensor",
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
    "board.title": "Board hardware", "board.ledtype": "Status LED", "board.none": "None",
    "board.led_gpio": "Plain LED (GPIO)", "board.led_ws2812": "Addressable RGB (WS2812)",
    "board.ledpin": "LED pin", "board.btnpin": "Reset button pin",
    "board.ledinv": "Active low (LED lights when the pin is driven LOW)",
    "board.btninv": "Active low (button shorts the pin to GND)",
    "board.hint": "Holding the reset button for 5 seconds ERASES all stored settings (WiFi, MQTT, Syslog/NTP) and reboots into the setup portal — the LED flashes red while it is armed, then turns solid white while erasing. Leave the button on \"None\" unless one is actually wired: an unconnected pin can float and trigger it.",
    "card.hardware": "Hardware", "card.hw_off": "None",
    "card.hw_led": (pin, kind) => `GPIO${pin} · ${kind}`, "card.hw_btn": (pin) => `GPIO${pin}`,
  },
  de: {
    "sys.nodata": "Keine Daten", "sys.unreachable": "Nicht erreichbar",
    "sys.unreachable_sub": "Gerät nicht erreichbar — erneuter Versuch…",
    "sys.waiting": "Warte auf die Wärmepumpe…", "sys.operating": "In Betrieb",
    "sys.standby": "Bereitschaft — läuft nicht", "sys.defrosting": "Abtauen",
    "sys.circulating": "Umwälzung — Verdichter aus",
    "sys.online": "Online", "sys.fault": "Störung",
    "sys.fault_line": (c) => "Störung · " + c + " — Außeneinheit prüfen.",
    "sys.polled": (s) => `vor ${s}s abgefragt`,
    "recovery.title": "Wiederherstellungsmodus",
    "recovery.meta": "Das Gerät ist zu oft neu gestartet und im Wiederherstellungsmodus hochgefahren. Wärmepumpen-Abfrage und MQTT sind pausiert. Korrigiere die Konfiguration (z. B. die RX/TX-Pins auf der ESP32-Karte in den Einstellungen) und starte neu, um den Normalbetrieb fortzusetzen.",
    "rollback.title": "WLAN-Änderung fehlgeschlagen — zurückgesetzt",
    "rollback.meta": (back) => `Die neuen WLAN-Zugangsdaten konnten sich nicht verbinden, daher hat das Gerät das vorherige Netzwerk${back} wiederhergestellt und neu gestartet. Öffne die Einstellungen und prüfe in der Kachel „Verbindungen“ WLAN-Name und Passwort, dann versuche es erneut.`,
    "crash.title_fault": "Gerät ist nach einem Absturz neu gestartet",
    "crash.title_orphan": "Absturzbericht von einem früheren Neustart",
    "crash.reset": "Reset", "crash.task": "Task", "crash.fw": "FW", "crash.elf": "elf", "crash.corrupted": "beschädigt",
    "crash.download": "Absturzbericht herunterladen", "crash.copy": "Diagnose kopieren", "crash.dismiss": "Ausblenden",
    "crash.copied": "Diagnose kopiert — in einen Fehlerbericht einfügen",
    "crash.copy_fail": "Kopieren fehlgeschlagen — /coredump und /diag manuell öffnen",
    "nav.settings": "Einstellungen", "nav.back": "Zurück",
    "nav.settings_alert": (n) => `Einstellungen — ${n} Verbindung${n === 1 ? "" : "en"} gestört`,
    "conn.title": "Verbindungen", "conn.offline": "Offline", "conn.disabled": "Deaktiviert",
    "conn.connecting": "Verbinde…", "conn.connected": "Verbunden", "conn.resolving": "Löse auf…",
    "conn.enabled": "Aktiv", "conn.enabled_noping": "Aktiv, Host antwortet nicht auf Ping",
    "conn.synced": "Synchronisiert", "conn.syncing": "Synchronisiere…",
    "conn.error": (e) => "Fehler: " + e, "conn.connected_to": (s) => "Verbunden mit " + s,
    "conn.aria": (label, state) => `${label}: ${state}. Zum Bearbeiten tippen.`,
    "card.model": "Modell", "card.uptime": "Laufzeit", "card.lastreset": "Letzter Reset",
    "card.freeheap": "Freier Heap", "card.hplink": "Wärmepumpen-Verbindung", "card.online": "Online",
    "card.offline": "Offline", "card.protocol": "Protokoll", "card.rxpin": "RX-Pin",
    "card.txpin": "TX-Pin", "card.capacity": "Leistung",
    "values.waiting": "Warte auf die erste Abfrage…",
    "group.Operation": "Betrieb", "group.Domestic hot water": "Warmwasser",
    "group.Water circuit": "Wasserkreis", "group.Refrigerant / outdoor": "Kältemittel / Außen",
    "group.Electrical": "Elektrik", "group.Device": "Gerät", "group.Other values": "Weitere Werte",
    "group.Values": "Werte",
    "chip.thermo_on": "Thermostat EIN", "chip.thermo_off": "Thermostat aus", "chip.quiet": "Leise",
    "schem.to_dhw": "3WV → WW", "schem.to_heat": "3WV → Heizung",
    "normal.label": "Normal:",
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
    "sl.err_port": "Port muss eine ganze Zahl 1–65535 sein (z. B. logs.example.com:514).",
    "btn.saving": "Speichere…", "btn.save": "Speichern", "btn.cancel": "Abbrechen",
    // static index.html markup (data-i18n)
    "schem.outdoor_unit": "AUSSENEINHEIT", "schem.defrost_pill": "❄ Abtauen", "schem.outdoor": "Außen",
    "schem.est": "geschätzt",
    "insp.hint": "Tippe im Schema auf einen Wert oder ein Bauteil für eine Erklärung.",
    "insp.close": "Schließen",
    "schem.leaving_water": "Vorlauf · vor BUH", "schem.dhw_tank": "WW-SPEICHER", "schem.set": "Soll",
    "schem.heating": "HEIZUNG", "schem.pump": "PUMPE", "schem.return": "Rücklauf", "schem.room": "Raum",
    "kpi.target": "Ziel",
    "schem.est_src": (s) => "gesch. · " + s, "schem.no_ct": "kein Stromsensor",
    "wifi.title": "WLAN-Konfiguration", "wifi.ssid": "WLAN-Netzwerk (SSID)", "wifi.pass": "WLAN-Passwort",
    "wifi.err_ssid": "SSID darf höchstens 32 Zeichen haben",
    "wifi.err_pass": "Passwort muss leer (offenes Netz) oder 8–63 Zeichen lang sein",
    "wifi.hint": "SSID ist erforderlich. Scheitert die Verbindung zum neuen Netz, setzt das Gerät auf die alten WLAN-Einstellungen zurück.",
    "mqtt.title": "MQTT-Broker", "mqtt.hostport": "Host : Port", "mqtt.user": "Benutzername · optional",
    "mqtt.pass": "Passwort · optional", "mqtt.clear": "Gespeicherte Zugangsdaten entfernen — anonym verbinden",
    "mqtt.hint": "Zugangsdaten erfordern einen TLS-Broker — mqtts://-URL verwenden (z. B. mqtts://host:8883). Leerer Host deaktiviert MQTT.",
    "syslog.title": "Syslog-Server", "syslog.hostport": "Host : Port",
    "syslog.hint": "IP-Adresse oder Hostname und Port des Syslog-Servers. Leerer Host deaktiviert Syslog.",
    "ntp.title": "NTP-Server", "ntp.server": "Server",
    "ntp.hint": "Hostname oder IP des NTP-Servers, mit dem das Gerät seine Uhr synchronisiert. Leer setzt auf den Firmware-Standard zurück.",
    "board.title": "Board-Hardware", "board.ledtype": "Status-LED", "board.none": "Keine",
    "board.led_gpio": "Einfache LED (GPIO)", "board.led_ws2812": "Adressierbare RGB-LED (WS2812)",
    "board.ledpin": "LED-Pin", "board.btnpin": "Reset-Taster-Pin",
    "board.ledinv": "Active low (LED leuchtet, wenn der Pin auf LOW liegt)",
    "board.btninv": "Active low (Taster zieht den Pin auf GND)",
    "board.hint": "Den Reset-Taster 5 Sekunden zu halten LÖSCHT alle gespeicherten Einstellungen (WLAN, MQTT, Syslog/NTP) und startet ins Setup-Portal neu — die LED blinkt rot, solange der Vorgang scharf ist, und leuchtet dann weiß, während gelöscht wird. Den Taster auf „Keine“ lassen, solange keiner verdrahtet ist: ein offener Pin kann floaten und ihn auslösen.",
    "card.hardware": "Hardware", "card.hw_off": "Keine",
    "card.hw_led": (pin, kind) => `GPIO${pin} · ${kind}`, "card.hw_btn": (pin) => `GPIO${pin}`,
  },
};
function t(k, ...a) {
  const v = (I18N[LANG] && I18N[LANG][k] != null) ? I18N[LANG][k] : I18N.en[k];
  if (v == null) return k;
  return typeof v === "function" ? v(...a) : v;
}
// Localise the static markup in index.html: elements tagged data-i18n get their text set from the
// dictionary. Runs once at boot (the static DOM is never rebuilt). SVG <text>/<tspan> nodes work the
// same as HTML here (textContent). Value units (°C, kW, bar, rps, l/min, K) carry no data-i18n — they
// are language-neutral and left verbatim.
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

// ── App state ────────────────────────────────────────────────────────────
const S = {
  // Which screen is showing (a key of VIEW below). The app opens on "dashboard" and the header gear
  // is the only way off it; every other screen sits under Settings and walks back up through PARENT.
  stage: "dashboard",
  status: null,
  busy: false,
  // Labels of value rows whose description accordion is currently expanded. Kept in app state (not
  // the DOM) because #valueGroups is rebuilt on every poll (renderCards) — a purely-DOM open state
  // would collapse ~1×/s. valueGroupsHtml re-emits the `open` class from this set, so an expanded
  // row survives the rebuild; the click handler only toggles the live element (so the CSS slide
  // animates) and updates this set for the next rebuild to honour.
  descOpen: new Set(),
  // Schematic inspector: which hit target (INSPECT key) is selected, and the last liveData() the
  // poll produced. The panel re-renders from S.live on every poll, so an open explainer keeps
  // showing the CURRENT reading rather than the one that was on screen when it was tapped.
  insp: null,
  live: null,
  inspSig: "",
  // OTA: the version a check found (drives the header version's tooltip), and whether a check or
  // download is running. Separate from S.busy — S.busy is the "a config write is landing" lock the
  // OTA flow also takes, otaBusy is what keeps a second tap from starting a parallel check.
  otaAvail: null,
  otaBusy: false,
};

// ── Navigation (dashboard ⇄ Settings) ────────────────────────────────────
// Two screens, both in the DOM; only .active shows. Deliberately FLAT — the gear opens the whole
// configuration at once, with no menu level in between: there is little enough of it that a menu
// would be a list of one or two entries whose only job is to hide a card behind a second tap.
// PARENT still maps the way back, so the header chevron and Esc walk the same path. There is no
// URL/history integration on purpose — the page is served from the device with no paths, and a hash
// route would survive a reload into a screen the user did not ask for.
const VIEW = { dashboard: "viewDash", settings: "viewSettings" };
const PARENT = { settings: "dashboard" };
const TITLE = { settings: () => t("nav.settings") };
// Every overlay that owns the Esc key; the navigation Esc stands down while one of them is open.
const MODALS = ["wifiModal", "mqttModal", "syslogModal", "ntpModal", "boardModal"];

function go(stage) {
  S.stage = stage;
  for (const [st, id] of Object.entries(VIEW)) $(id).classList.toggle("active", st === stage);
  renderHeader();
  window.scrollTo(0, 0);
}
function goBack() { go(PARENT[S.stage] || "dashboard"); }
// Write innerHTML only when the markup actually changed. Both containers this guards hold buttons
// the user taps, and a push arrives ~1×/s: a rebuild landing between mousedown and mouseup destroys
// the element under the finger and the click never fires. (The banners guard the same way with
// their own render keys; the cache is kept here rather than in a data- attribute so the markup
// isn't held twice.)
const _html = {};
function setHtml(id, html) {
  if (_html[id] === html) return;
  _html[id] = html;
  $(id).innerHTML = html;
}
// The dashboard header (identity + gear) and the back header (chevron + screen title) are the same
// slot: exactly one shows. The title is re-read from TITLE on every switch rather than stored, so it
// follows the UI language like every other string.
function renderHeader() {
  const dash = S.stage === "dashboard";
  $("hdrDash").hidden = !dash;
  $("hdrBack").hidden = dash;
  if (!dash) $("backTitle").textContent = (TITLE[S.stage] || (() => ""))();
}

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

// ── Status (drives every screen) ─────────────────────────────────────────
async function refreshStatus() {
  let s;
  try { s = await j("/status"); } catch { markUnreachable(); return; }
  S.status = s;
  renderApp();
}
function markUnreachable() {
  sysSet(t("sys.unreachable"), t("sys.unreachable_sub"), "err");
}

// Re-render EVERY screen from the current /status + /values, not just the visible one: the screens
// are all in the DOM (only .active shows), a push arrives ~1×/s regardless of where the user is, and
// rendering the hidden ones costs a few string builds — far cheaper than a per-screen refresh
// scheme that has to remember to run when a view is switched to.
function renderApp() {
  renderRecoveryBanner();
  renderRollbackBanner();
  renderCrashBanner();
  const s = S.status || {}, hp = s.hp || {};
  // Header is a fixed product title ("daikin-altherma-esp32", set in index.html) — the detected
  // model name lives in the Model card (statusCardsHtml), not the header.

  // The schematic's own status block: operation mode + fault state. Prefer the hydronic I/U mode
  // (conv 315 — Stop/Heating/Cooling/DHW/…) over the outdoor unit's Operation Mode: during a DHW run
  // the outdoor unit still reports "Heating" (it IS heating — the tank), but the user-relevant answer
  // is what the water side is doing. Plain first-match sorted the outdoor row first.
  const mode = pickValue(/i\/u operation mode/i) || pickValue(/operation mode|^mode$/i);
  const fault = faultValue();
  const faulted = fault && !FAULT_OK.test(String(fault).trim());
  // Decode the readings ONCE, here: the status block and the drawing must not disagree about what
  // the plant is doing, and they did — the headline was written from the link state alone while the
  // pills beneath it were written from the values.
  S.live = hp.connected && (S._values || []).length > 0 ? liveData() : null;
  if (!hp.connected) {
    sysSet(t("sys.nodata"), t("sys.waiting"), "dim");
  } else if (faulted) {
    sysSet(mode || t("sys.fault"), t("sys.fault_line", fault), "err");
  } else {
    // The drawing shows leaving water and outdoor itself, so the status line doesn't repeat them — it
    // only adds the poll age when there is no leaving-water pill to prove freshness (vLwt, the same
    // measurement picker the schematic uses; a plain /leaving water/ match could hit a setpoint).
    const stale = vLwt() == null && hp.last_ok_s != null ? " · " + t("sys.polled", hp.last_ok_s) : "";
    const p = plantState(S.live);
    sysSet(mode || t("sys.online"), t(p.key) + stale, p.tone);
  }
  renderHeaderMeta();
  renderSettings();
  renderLive();
  renderCards();
}
// Header identity line: the IP address (or the mDNS hostname while offline/unknown — whatever the
// browser is actually reached at) and the running firmware version, under the fixed product name.
// The IP moved out of the WiFi row (connectionsHtml) since it is board identity, not a WiFi *link*
// fact; the version moved up out of the ESP32 card, so the one line the user reads first answers
// both "which box is this" and "which firmware is on it" (DESIGN.md §5.4).
//
// This runs on EVERY status frame (~1/s), so it writes only the two fields it owns — #otaStat
// belongs to the OTA flow below and must survive a re-render mid-download, or the percentage would
// blink out once a second.
function renderHeaderMeta() {
  const w = S.status?.wifi || {};
  $("hdrIp").textContent = w.ip || location.hostname;
  const vl = $("verLink");
  vl.textContent = "v" + (S.status?.version || "?");
  vl.title = S.otaAvail ? t("ota.title_avail", S.otaAvail) : t("ota.title_check");
}
// The status block INSIDE the schematic (#scStatus): the operation mode is the drawing's headline —
// or the offline state, when there is no mode to report — over one status line, with a state dot.
// `tone` is "" (running), "err" (fault) or "dim" (no data / unreachable); it colours the line and the
// dot, but the words always say the state too, so colour is never the only carrier (DESIGN.md §9).
const TONE_FILL = { err: "var(--err)", dim: "var(--muted)", idle: "var(--muted)", "": "var(--ok)" };
// What the plant is actually DOING, read off the machine rather than off the fact that the X10A bus
// answers. "Operating" used to be printed unconditionally whenever the link was up, so an idle unit
// — compressor stopped, pump at 0 %, no flow — was announced as running, in green, directly above
// pills that all read zero. It also made the headline mode ("DHW") look like an active charge while
// the 3-way valve right below it said "→ heating"; a parked plant reports its LAST mode, and only
// the activity words can tell that apart from a live one.
// `idle` mutes the DOT but not the text — distinct from `dim` (no data at all), which mutes both.
const PLANT_RUNNING = { key: "sys.operating", tone: "" };
const PLANT_DEFROST = { key: "sys.defrosting", tone: "" };
const PLANT_CIRC = { key: "sys.circulating", tone: "" };
const PLANT_STANDBY = { key: "sys.standby", tone: "idle" };
function plantState(d) {
  if (!d) return PLANT_STANDBY;
  if (d.defrost === true) return PLANT_DEFROST;
  if ((d.rps ?? 0) > 0) return PLANT_RUNNING;
  // Compressor off but water still moving: pump overrun, or the backup heater carrying the load on
  // its own. Something IS happening — it just isn't the heat pump, which is the point of saying so.
  if (d.pumpOn ?? (d.flow != null && d.flow > 1)) return PLANT_CIRC;
  return PLANT_STANDBY;
}
function sysSet(mode, status, tone) {
  setTxt("svMode", mode);
  setTxt("svStatus", status);
  $("svStatus").setAttribute("class", "sc-status" + (tone ? " " + tone : ""));
  $("svDot").setAttribute("fill", TONE_FILL[tone || ""]);
}
function pickValue(re) {
  const v = (S._values || []).find((x) => re.test(x.label || ""));
  return v ? (v.value == null ? null : String(v.value)) : null;
}
// A "no fault" reading (also the empty/absent case). Shared by the status header + faultValue.
const FAULT_OK = /^(none|no fault|normal|ok|0|—|-)?$/i;
// The unit fault to surface in the status header. Prefer the specific *code* (conv 204, labelled "… Code" →
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
// recovery controls (behind the gear: the RX/TX pins on the ESP32 card, the WiFi/MQTT modals) stay fully usable.
function renderRecoveryBanner() {
  const el = $("recoveryBanner");
  if (!el) return;
  if (!(S.status?.sys?.safe_mode)) { el.hidden = true; return; }
  if (!el.hidden && el.dataset.on === "1") return;   // already shown — don't thrash the DOM
  el.dataset.on = "1";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${esc(t("recovery.title"))}</div>` +
    `<div class="crash-meta">${esc(t("recovery.meta"))}</div></div></div>`;
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
    `<div class="crash-txt"><div class="crash-title">${esc(t("rollback.title"))}</div>` +
    `<div class="crash-meta">${t("rollback.meta", back)}</div></div></div>`;
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
  const bits = [`${esc(t("crash.reset"))}: <b>${esc(c.reason)}</b>`];
  if (c.task) bits.push(`${esc(t("crash.task"))} <span class="mono">${esc(c.task)}</span>`);
  if (s.version) bits.push(`${esc(t("crash.fw"))} v${esc(s.version)}`);
  if (s.app_elf_sha256) bits.push(`${esc(t("crash.elf"))} <span class="mono">${esc(s.app_elf_sha256.slice(0, 12))}…</span>`);
  const btHtml = bt.length
    ? `<div class="crash-bt mono">${esc(bt.join(" "))}${c.corrupted ? " (" + esc(t("crash.corrupted")) + ")" : ""}</div>` : "";
  const dl = c.coredump
    ? `<a class="btn secondary sm" href="/coredump" download="coredump.bin">${esc(t("crash.download"))}</a>` : "";
  const title = c.fault ? t("crash.title_fault") : t("crash.title_orphan");
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${esc(title)}</div>` +
    `<div class="crash-meta">${bits.join(" · ")}</div>${btHtml}</div></div>` +
    `<div class="crash-actions">${dl}` +
    `<button class="btn secondary sm" type="button" data-cact="copy">${esc(t("crash.copy"))}</button>` +
    `<button class="btn ghost sm" type="button" data-cact="dismiss">${esc(t("crash.dismiss"))}</button></div>`;
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
  if (await copyText(lines.join("\n"))) toast(t("crash.copied"), "ok");
  else toast(t("crash.copy_fail"), "err");
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
  renderApp();
}
// Dashboard cards: the detected unit (Model) first, then the heat-pump value groups — all one
// continuous card grid, each block styled like OPERATION. The board (ESP32) card and the
// WiFi/MQTT/Syslog/NTP rows are NOT here: both moved behind the gear onto Settings (renderSettings).
function renderCards() {
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

// ESP32 board status card (on the Settings screen — renderSettings): chip / uptime, the X10A link +
// protocol, and the RX/TX pins. (The firmware version is NOT here — it sits in the dashboard's
// header meta line beside the IP, where tapping it runs the OTA check; DESIGN.md §5.4.) Pins are
// auto-detected: once the bus answers on a pair they show read-only; until then a dropdown of the
// board's wire-able GPIOs lets the user point the firmware at their wiring. A brief timeout doesn't
// flip back to the dropdown (last_ok_s grace).
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
    ? vrow(t("card.lastreset"), sys.reset_reason, { cls: FAULT_RESETS.includes(sys.reset_reason) ? "warn" : "" })
    : "";
  const heapRow = sys.free_heap != null ? vrow(t("card.freeheap"), fmtBytes(sys.free_heap)) : "";
  const rows =
    vrow("Chip", s.platform || "—", { cls: "mono" }) +
    vrow(t("card.uptime"), fmtUptime(s.uptime_s)) +
    resetRow +
    heapRow +
    vrow(t("card.hplink"), hp.connected ? t("card.online") : t("card.offline"), { cls: hp.connected ? "ok" : "err" }) +
    vrow(t("card.protocol"), hp.connected ? proto : "—") +
    pinRow(t("card.rxpin"), "e32Rx", hp.rx, hp.tx) +
    pinRow(t("card.txpin"), "e32Tx", hp.tx, hp.rx) +
    boardRow();
  return vcard("ESP32", rows);
}

// The board's own onboard parts — status indicator + recovery button — as ONE summary row that
// opens the editor. They are runtime settings (one firmware image serves boards with different
// onboard hardware), but they are also set once per board and never touched again, so they get a
// single collapsed row rather than the permanent real estate the X10A pins have.
function boardRow() {
  const b = S.status?.board || {};
  const led = b.led_gpio == null || b.led_gpio < 0
    ? t("card.hw_off")
    : t("card.hw_led", b.led_gpio, b.led_type === 1 ? "WS2812" : "LED");
  const btn = b.btn_gpio == null || b.btn_gpio < 0 ? t("card.hw_off") : t("card.hw_btn", b.btn_gpio);
  return `<button class="vrow vrow-btn" type="button" data-act="board" aria-label="${esc(t("board.title"))}">` +
    `<span class="vrow-label">${esc(t("card.hardware"))}</span>` +
    `<span class="vrow-val mono">${esc(led)} · ${esc(btn)}</span></button>`;
}

// The dashboard's Model card, from /status.detect (the detected unit). The ESP32 card that used to
// sit above it is on the Settings screen now (renderSettings), as are the WiFi/MQTT/Syslog/NTP rows
// (connectionsHtml) — what the plant IS stays on the dashboard, what the board is SET TO moved.
function statusCardsHtml() {
  const hp = S.status?.hp || {}, d = S.status?.detect || {};
  // Outdoor unit as a full-width heading — model names are long and don't fit a label→value row.
  // The X10A link + protocol live on the ESP32 card (they're about the board's bus), not here.
  // Identity is bus-derived: the model name degrades to the brand offline (hpModelName), and capacity
  // (from the cached fingerprint) is shown ONLY while connected — never a stale value read as live.
  // No "Detection: auto/manual" row: detection is fully automatic, an internal detail.
  let model = `<div class="vname">${esc(hpModelName())}</div>`;
  if (hp.connected && d.capacity_kw != null) model += vrow(t("card.capacity"), String(d.capacity_kw), { unit: "kW" });

  // Model identity is only meaningful while the bus answers — hide the card entirely when the
  // heat-pump link is down instead of naming a unit (or showing a stale capacity) that isn't live.
  return hp.connected ? vcard(t("card.model"), model) : "";
}

// ── Connections tile (Settings — WiFi · MQTT · Syslog · NTP) ─────────────────────────────────
// One tappable row per link: label, colour-coded value (green connected/synced, yellow reconnecting/
// syncing, red down — the same ok/warn/err semantics the rest of the app uses), a trailing
// pencil that opens that link's existing edit modal (§5.1 in docs/DESIGN.md). MAC/BSSID are dropped
// entirely (bus-level detail nobody edits from here) and the IP address lives in the dashboard
// header (renderHeaderMeta) — it is board identity, not a per-row WiFi fact.
//
// connLinks() derives the four rows' state ONCE and both consumers read it: the rows themselves and
// the Settings menu entry + header dot that summarise them a level up. Re-deriving "is this link
// healthy" for the summary is exactly how a menu ends up claiming everything is fine while the row
// behind it is red.
function connLinks() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, sy = S.status?.syslog || {}, nt = S.status?.ntp || {};
  const links = [];

  // WiFi has no "connecting" state in /status (just connected: true/false), so it is a two-state
  // ok/err row — signal bars keep their own strength-based tone regardless.
  if (w.connected && (w.rssi != null || w.ssid)) {
    links.push({ edit: "wifi", label: w.std || "Wi-Fi", cls: "ok",
      value: (w.rssi != null ? signalBars(w.rssi) : "") +
        (w.rssi != null ? ` <span class="conn-dbm">${w.rssi} dBm</span>` : "") +
        (w.ssid ? ` <span class="conn-name">${esc(w.ssid)}</span>` : ""),
      state: w.ssid ? t("conn.connected_to", w.ssid) : t("conn.connected") });
  } else {
    links.push({ edit: "wifi", label: w.std || "Wi-Fi", cls: "err",
      value: t("conn.offline"), state: t("conn.offline") });
  }

  if (!m.configured) {
    links.push({ edit: "mqtt", label: "MQTT", cls: "", value: t("conn.disabled"), state: t("conn.disabled") });
  } else {
    links.push({ edit: "mqtt", label: "MQTT",
      cls: m.connected ? "ok" : m.error ? "err" : "warn",
      // No TLS padlock marker: an mqtts:// broker already carries its own scheme in the URL, so the
      // icon only restated what the string says. A schemeless/mqtt:// broker is plaintext and shows none.
      value: esc(m.broker || "—"),
      state: m.connected ? t("conn.connected") : m.error ? t("conn.error", m.error) : t("conn.connecting") });
  }

  if (!sy.configured) {
    links.push({ edit: "syslog", label: "Syslog", cls: "", value: t("conn.disabled"), state: t("conn.disabled") });
  } else {
    // Delivery is gated on DNS only (resolved); reachability is an advisory ping hint — green once
    // resolving, yellow (still forwarding) when the host doesn't answer the probe or resolution is
    // still pending, red on a DNS error.
    links.push({ edit: "syslog", label: "Syslog",
      cls: sy.error ? "err" : sy.resolved ? (sy.reachable ? "ok" : "warn") : "warn",
      value: esc(sy.host ? `${sy.host}:${sy.port || 514}` : "—"),
      state: sy.error ? sy.error : sy.resolved ? (sy.reachable ? t("conn.enabled") : t("conn.enabled_noping")) : t("conn.resolving") });
  }

  // NTP has no "disabled" or error state (unlike MQTT/Syslog) — it always has a server, so it is a
  // two-state ok/warn row keyed on whether the first sync of this boot has landed.
  links.push({ edit: "ntp", label: "NTP", cls: nt.synced ? "ok" : "warn",
    value: esc(nt.server || "—"), state: nt.synced ? t("conn.synced") : t("conn.syncing") });

  return links;
}
// The row conveys state by colour alone (the value IS the address/name, just tinted) — DESIGN.md
// §9's "status never conveyed by colour alone" would otherwise be broken for colourblind users and
// screen readers, so `state` (a plain-text status word, never shown visually) goes into the row's
// aria-label instead of the generic "Edit X" every other edit affordance in this app uses.
function connRow(l) {
  return `<button class="conn-row" type="button" data-edit="${esc(l.edit)}" aria-label="${esc(t("conn.aria", l.label, l.state))}">` +
    `<span class="conn-label">${esc(l.label)}</span>` +
    `<span class="conn-val ${l.cls || ""}">${l.value}</span>` +
    `${editIcon}</button>`;
}
function connectionsHtml() {
  return `<div class="section-label">${esc(t("conn.title"))}</div>` + connLinks().map(connRow).join("");
}
// The links the gear should call out as broken: `err` only. `warn` is the transient half of the
// vocabulary (MQTT still connecting, NTP not yet synced, a syslog host that ignores ping) and every
// boot passes through it, so raising the alarm on warn would leave the gear permanently marked and
// the marker would stop meaning anything. A disabled link (neutral, no class) is a choice, not a fault.
const connDown = () => connLinks().filter((l) => l.cls === "err");

// ── Settings screen (behind the header gear) ─────────────────────────────────────────────────
// The whole configuration on one screen, no menu level in between: the Connections tile and the
// ESP32 board card, rendered by the same builders that used to place them on the dashboard.
function renderSettings() {
  // Both containers are rebuilt on every poll (uptime alone changes each second). The ESP32 card's
  // RX/TX pin dropdown is interactive, so skip the rebuild while it is focused/open — otherwise the
  // poll would collapse it mid-pick. It resumes once focus leaves (onPinPick blurs it after
  // applying). setHtml keeps the rest from thrashing rows the user is tapping.
  const a = document.activeElement;
  if (!(a && a.classList && a.classList.contains("pin-sel"))) {
    setHtml("connTile", connectionsHtml());
    setHtml("settingsCards", esp32CardHtml());
  }
  $("settingsVer").textContent = "daikin-altherma-esp32 · v" + (S.status?.version || "?");
  renderSettingsDot();
}
// The gear's attention marker. The connection rows live behind it now, so a broker that stopped
// answering would otherwise be invisible from the dashboard — the screen the user is on all day.
// The dot is never the sole carrier of the fact: the button's accessible name spells it out, which
// is also what a screen reader announces (DESIGN.md §9).
function renderSettingsDot() {
  const n = connDown().length;
  $("settingsDot").hidden = n === 0;
  $("btnSettings").setAttribute("aria-label", n ? t("nav.settings_alert", n) : t("nav.settings"));
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
    normal: "usually 45–55 °C. Higher leans on the electric backup heater and costs more; a weekly ≥60 °C cycle is the normal anti-legionella boost.",
    de: { what: "Zieltemperatur für den Warmwasserspeicher. Das Gerät läuft im Warmwasser-Modus, bis der Speicherfühler sie erreicht, dann stoppt es.",
          normal: "meist 45–55 °C. Höher belastet den elektrischen Zusatzheizer und kostet mehr; ein wöchentlicher Zyklus auf ≥60 °C ist die normale Legionellen-Aufheizung." } },
  { re: /2nd domestic hot water/i,
    what: "A second temperature sensor in the hot-water tank (used on tanks with two sensors, e.g. top and bottom).",
    de: { what: "Ein zweiter Temperaturfühler im Warmwasserspeicher (bei Speichern mit zwei Fühlern, z. B. oben und unten)." } },
  { re: /dhw tank temp|dhw tank/i,
    what: "The water temperature actually measured inside the hot-water tank (sensor R5T).",
    normal: "sits below the DHW setpoint and climbs during a DHW cycle. Staying far below setpoint with the tank idle means it's simply been used up, or a sensor/heating fault.",
    de: { what: "Die tatsächlich im Warmwasserspeicher gemessene Wassertemperatur (Fühler R5T).",
          normal: "liegt unter dem Warmwasser-Sollwert und steigt während eines Warmwasser-Zyklus. Bleibt sie im Ruhezustand weit unter dem Sollwert, ist der Speicher schlicht verbraucht — oder es liegt ein Fühler-/Heizfehler vor." } },
  { re: /powerful dhw/i,
    what: "A one-off boost that heats the tank to the setpoint as fast as possible, calling in the backup heater if needed.",
    normal: "OFF in day-to-day use; ON only while you've triggered a manual boost.",
    de: { what: "Eine einmalige Schnellaufheizung, die den Speicher so schnell wie möglich auf den Sollwert bringt und bei Bedarf den Zusatzheizer zuschaltet.",
          normal: "im Alltag AUS; nur EIN, während du eine manuelle Aufheizung ausgelöst hast." } },
  { re: /tank preheat/i,
    what: "The tank is being warmed ahead of an expected draw (from the schedule or weather forecast) so hot water is ready in time.",
    normal: "briefly ON around scheduled/anticipated demand, OFF otherwise.",
    de: { what: "Der Speicher wird vor einer erwarteten Entnahme (nach Zeitplan oder Wetterprognose) vorgewärmt, damit rechtzeitig Warmwasser bereitsteht.",
          normal: "kurz EIN rund um geplanten/erwarteten Bedarf, sonst AUS." } },
  { re: /reheat on/i,
    what: "The tank is being topped back up to its comfort temperature between scheduled heating slots.",
    normal: "ON in short bursts to hold the tank warm; OFF most of the time.",
    de: { what: "Der Speicher wird zwischen geplanten Heizzeiten wieder auf seine Komforttemperatur nachgeladen.",
          normal: "EIN in kurzen Schüben, um den Speicher warm zu halten; die meiste Zeit AUS." } },
  { re: /storage (eco|comfort)/i,
    what: "Which stored-hot-water target is active: Comfort keeps the tank fuller/hotter, ECO holds a lower reserve to save energy.",
    de: { what: "Welches Warmwasser-Speicherziel aktiv ist: Komfort hält den Speicher voller/heißer, ECO hält eine niedrigere Reserve, um Energie zu sparen." } },
  { re: /boiler dhw demand/i,
    what: "On a hybrid (heat-pump + gas boiler) system: the boiler has been asked to make the hot water instead of the heat pump.",
    normal: "OFF on a heat-pump-only system; on a hybrid it comes ON when the boiler is cheaper/faster than the heat pump for DHW.",
    de: { what: "Bei einem Hybridsystem (Wärmepumpe + Gaskessel): Der Kessel wurde angefordert, das Warmwasser statt der Wärmepumpe zu erzeugen.",
          normal: "AUS bei reinem Wärmepumpenbetrieb; im Hybridsystem EIN, wenn der Kessel für Warmwasser günstiger/schneller ist als die Wärmepumpe." } },

  // ── Valves ──
  { re: /3.?way valve/i,
    what: "The diverter valve that sends heated water either to the DHW tank (ON = DHW) or to the space-heating circuit (OFF = heating). It can only feed one at a time.",
    normal: "ON only during a hot-water cycle; OFF (feeding heating) the rest of the time.",
    de: { what: "Das Umschaltventil, das erwärmtes Wasser entweder zum Warmwasserspeicher (EIN = WW) oder in den Heizkreis (AUS = Heizung) leitet. Es kann immer nur eines versorgen.",
          normal: "nur während eines Warmwasser-Zyklus EIN; sonst AUS (versorgt die Heizung)." } },
  { re: /2.?way valve/i,
    what: "Selects the water path for the current mode — ON in heating, OFF in cooling (per the label).",
    de: { what: "Wählt den Wasserweg für den aktuellen Modus — EIN im Heizbetrieb, AUS im Kühlbetrieb (laut Bezeichnung)." } },
  { re: /mix valve position|bizone kit mix valve/i,
    what: "Opening of the bizone mixing valve, blending hot flow with cooler return to hold a lower temperature for a second (e.g. underfloor) zone.",
    normal: "modulates between fully closed and fully open to hold that zone's target.",
    de: { what: "Öffnung des Bizone-Mischventils, das heißen Vorlauf mit kühlerem Rücklauf mischt, um für eine zweite Zone (z. B. Fußbodenheizung) eine niedrigere Temperatur zu halten.",
          normal: "regelt zwischen ganz geschlossen und ganz offen, um das Ziel dieser Zone zu halten." } },

  // ── Leaving / return / mixed water ──
  { re: /(leaving water|lw) set ?point/i,
    what: "The target flow (leaving-water) temperature the controller is aiming for — usually set automatically by weather compensation, warmer when it's colder outside.",
    normal: "tracks the outdoor temperature: higher on cold days, lower on mild ones.",
    de: { what: "Die Ziel-Vorlauftemperatur, die der Regler anstrebt — meist automatisch über die Witterungsführung gesetzt, wärmer wenn es draußen kälter ist.",
          normal: "folgt der Außentemperatur: höher an kalten, niedriger an milden Tagen." } },
  { re: /mixed (leaving|water)/i,
    what: "Blended flow temperature of a mixed heating zone (after its mixing valve) — typically a cooler underfloor loop fed off a hotter primary circuit.",
    de: { what: "Gemischte Vorlauftemperatur einer gemischten Heizzone (nach ihrem Mischventil) — typisch ein kühlerer Fußbodenkreis, gespeist aus einem heißeren Primärkreis." } },
  { re: /after buh|outlet water buh|after buffer|tvbh/i,
    what: "Water temperature after the electric backup heater (sensor R2T) — the temperature that actually reaches your radiators/underfloor.",
    normal: "equal to the before-BUH temperature when the backup heater is off (the usual case); higher only while the BUH is firing.",
    de: { what: "Wassertemperatur nach dem elektrischen Zusatzheizer (Fühler R2T) — die Temperatur, die tatsächlich an Heizkörper/Fußbodenheizung ankommt.",
          normal: "gleich der Temperatur vor dem BUH, wenn der Zusatzheizer aus ist (der Normalfall); höher nur, während der BUH heizt." } },
  { re: /before buh|after phe|outlet water heat exch|leaving water.*\(?r1t\)?|tv inflow|outlet water heat exchanger/i,
    what: "Water temperature leaving the heat pump's own heat exchanger, before the backup heater (sensor R1T) — the true heat-pump output temperature and the one used for ΔT / heat-output / COP.",
    normal: "space heating ~30–45 °C (underfloor lower, radiators higher); up to ~55 °C on a DHW run. Much higher than the target usually means the backup heater is contributing.",
    de: { what: "Wassertemperatur, die den Wärmetauscher der Wärmepumpe verlässt, vor dem Zusatzheizer (Fühler R1T) — die eigentliche Vorlauftemperatur der Wärmepumpe und die Basis für ΔT / Wärmeleistung / COP.",
          normal: "Raumheizung ~30–45 °C (Fußboden niedriger, Heizkörper höher); bis ~55 °C bei einem Warmwasser-Lauf. Deutlich über dem Ziel heißt meist, dass der Zusatzheizer mitwirkt." } },
  { re: /inlet water|return water|tr return/i,
    what: "Water returning from the house back into the unit (sensor R4T). Leaving-water minus this is the ΔT across the system.",
    normal: "a few degrees below the leaving-water temperature; a healthy heating ΔT is around 5 K.",
    de: { what: "Wasser, das aus dem Haus zurück ins Gerät strömt (Fühler R4T). Vorlauf minus dieser Wert ergibt das ΔT über die Anlage.",
          normal: "einige Grad unter der Vorlauftemperatur; ein gesundes Heiz-ΔT liegt bei etwa 5 K." } },

  // ── Flow / pressure / pump ──
  { re: /flow (sensor|rate)|flow rate/i,
    what: "How fast water is circulating through the heating/DHW circuit.",
    normal: "typically ~10–30 l/min depending on unit size and pump speed. Too low can trip a flow fault and stop the compressor — suspect air, a closed valve or a dirty filter.",
    de: { what: "Wie schnell das Wasser durch den Heiz-/Warmwasserkreis zirkuliert.",
          normal: "typisch ~10–30 l/min je nach Gerätegröße und Pumpendrehzahl. Zu wenig kann einen Durchfluss-Fehler auslösen und den Verdichter stoppen — Verdacht: Luft, ein geschlossenes Ventil oder ein verschmutzter Filter." } },
  { re: /water pressure/i,
    what: "Water pressure in the sealed heating circuit.",
    normal: "roughly 1.0–2.0 bar when cold. Below ~0.5 bar needs topping up; a persistent low reading can stop the pump.",
    de: { what: "Wasserdruck im geschlossenen Heizkreis.",
          normal: "kalt etwa 1,0–2,0 bar. Unter ~0,5 bar muss nachgefüllt werden; ein dauerhaft niedriger Wert kann die Pumpe stoppen." } },
  { re: /water pump signal/i,
    what: "The speed command sent to the circulation pump. Note it is inverted — 0 means full speed, 100 means stopped (per the label).",
    normal: "a low number (fast pump) while heating or making DHW; 100 (stopped) when idle.",
    de: { what: "Der Drehzahlbefehl an die Umwälzpumpe. Beachte: invertiert — 0 bedeutet volle Drehzahl, 100 bedeutet gestoppt (laut Bezeichnung).",
          normal: "eine niedrige Zahl (schnelle Pumpe) beim Heizen oder Warmwasserbereiten; 100 (gestoppt) im Leerlauf." } },
  { re: /water pump operation|circulation pump|solar pump|main pump|add pump|pump speed/i,
    what: "The circulation pump that moves water between the unit and the tank/emitters — whether it's running (or how hard, for a speed reading).",
    normal: "running while heating, cooling or making hot water; may keep going briefly afterwards or periodically to anti-seize.",
    de: { what: "Die Umwälzpumpe, die Wasser zwischen Gerät und Speicher/Heizflächen bewegt — ob sie läuft (oder wie stark, bei einem Drehzahlwert).",
          normal: "läuft beim Heizen, Kühlen oder Warmwasserbereiten; läuft evtl. kurz nach oder periodisch zum Schutz vor Festsitzen." } },
  { re: /water flow switch/i,
    what: "A safety switch that confirms water is genuinely flowing before the compressor or backup heater are allowed to run — protecting the heat exchanger from running dry.",
    normal: "ON (flow proven) whenever the pump is running.",
    de: { what: "Ein Sicherheitsschalter, der bestätigt, dass tatsächlich Wasser fließt, bevor Verdichter oder Zusatzheizer laufen dürfen — schützt den Wärmetauscher vor Trockenlauf.",
          normal: "EIN (Durchfluss bestätigt), sobald die Pumpe läuft." } },

  // ── Operation / mode / fault ──
  { re: /i\/u operation mode/i,
    what: "What the water (indoor) side is doing right now: Stop, Heating, Cooling, Domestic Hot Water, or a heating+DHW combination.",
    normal: "reflects the current job. During a hot-water cycle it reads DHW even though the outdoor unit still shows Heating.",
    de: { what: "Was die Wasserseite (Inneneinheit) gerade tut: Stopp, Heizen, Kühlen, Warmwasser oder eine Kombination aus Heizen+Warmwasser.",
          normal: "spiegelt die aktuelle Aufgabe wider. Während eines Warmwasser-Zyklus steht hier WW, obwohl die Außeneinheit weiterhin Heizen anzeigt." } },
  { re: /operation mode|operation \/ fault|^operation$/i,
    what: "The outdoor unit's thermodynamic mode (Heating, Cooling, …). While it heats the tank it still reports Heating — it is heating, just the water in the tank rather than the house.",
    de: { what: "Der thermodynamische Modus der Außeneinheit (Heizen, Kühlen, …). Während sie den Speicher aufheizt, meldet sie weiterhin Heizen — sie heizt ja, nur das Wasser im Speicher statt das Haus." } },
  { re: /defrost/i,
    what: "The unit is melting frost off the outdoor coil by briefly running its cycle in reverse. Heating output pauses and steam may rise from the outdoor unit.",
    normal: "normal and self-clearing in cold, damp weather; a few minutes every so often. Constant defrosting suggests low refrigerant or poor airflow.",
    de: { what: "Das Gerät taut Reif von der Außeneinheit ab, indem es den Kreislauf kurz umkehrt. Die Heizleistung pausiert, und aus der Außeneinheit kann Dampf aufsteigen.",
          normal: "normal und selbstbeendend bei kaltem, feuchtem Wetter; ab und zu ein paar Minuten. Ständiges Abtauen deutet auf zu wenig Kältemittel oder schlechten Luftstrom hin." } },
  { re: /error type/i,
    what: "The severity class of any active fault: Normal, Error, Warning or Caution.",
    normal: "Normal. Anything else points to an active fault or advisory — check the fault code.",
    de: { what: "Die Schwereklasse einer aktiven Störung: Normal, Fehler, Warnung oder Hinweis.",
          normal: "Normal. Alles andere weist auf eine aktive Störung oder einen Hinweis hin — den Fehlercode prüfen." } },
  { re: /error code|fault code/i,
    what: "The Daikin fault code (e.g. U4, H3). Blank or 0 means no fault. If the unit stops, note this code — it identifies the problem for a service tech.",
    normal: "blank / no fault. A code present with the unit stopped means it has shut down on that fault.",
    de: { what: "Der Daikin-Fehlercode (z. B. U4, H3). Leer oder 0 bedeutet keine Störung. Stoppt das Gerät, notiere diesen Code — er benennt das Problem für den Servicetechniker.",
          normal: "leer / keine Störung. Ein vorhandener Code bei gestopptem Gerät bedeutet, dass es sich wegen dieser Störung abgeschaltet hat." } },
  { re: /emergency/i,
    what: "Emergency operation: the system is running in a fallback mode (often backup-heater only) after a fault, to keep some heat/hot water until it's serviced.",
    de: { what: "Notbetrieb: Die Anlage läuft nach einer Störung in einem Ersatzbetrieb (oft nur Zusatzheizer), um bis zur Wartung etwas Wärme/Warmwasser zu liefern." } },
  { re: /alarm output/i,
    what: "The unit's alarm relay — switched ON to signal a fault to any external alarm/monitoring wired to it.",
    de: { what: "Das Alarmrelais des Geräts — schaltet EIN, um eine Störung an eine angeschlossene externe Alarm-/Überwachungseinrichtung zu melden." } },

  // ── Room / thermostat ──
  { re: /thermostat/i,
    what: "Whether the room or zone is currently calling for heat. ON = there is demand and the unit may run; OFF = the room is up to temperature.",
    normal: "cycles ON and OFF as the room drifts around its target.",
    de: { what: "Ob der Raum bzw. die Zone gerade Wärme anfordert. EIN = Bedarf vorhanden, das Gerät darf laufen; AUS = der Raum ist auf Temperatur.",
          normal: "schaltet EIN und AUS, während der Raum um sein Ziel pendelt." } },
  { re: /space heating operation|space h operation/i,
    what: "Whether space heating (as opposed to hot-water production) is currently active or being called for.",
    de: { what: "Ob die Raumheizung (im Unterschied zur Warmwasserbereitung) gerade aktiv ist oder angefordert wird." } },
  { re: /rt set ?point/i,
    what: "The target room temperature you've set for the zone the unit's own room sensor controls.",
    de: { what: "Die von dir eingestellte Ziel-Raumtemperatur für die Zone, die der eigene Raumfühler des Geräts regelt." } },
  { re: /\brt temp|indoor ambient|ext\. indoor ambient/i,   // \b so "po(rt temp)erature" doesn't hit this
    what: "The room temperature measured by the unit's built-in or wired room sensor.",
    normal: "sits near the room setpoint once the zone is satisfied.",
    de: { what: "Die vom eingebauten oder verdrahteten Raumfühler des Geräts gemessene Raumtemperatur.",
          normal: "liegt nahe am Raum-Sollwert, sobald die Zone zufrieden ist." } },

  // ── Outdoor / refrigerant circuit ──
  { re: /outdoor air|outdoor ambient|r1t-outdoor|^outdoor/i,
    what: "The outside air temperature measured at the unit — the source it draws heat from.",
    normal: "the colder it is outside, the lower the efficiency (COP) and the more the backup heater may help out.",
    de: { what: "Die am Gerät gemessene Außenlufttemperatur — die Quelle, aus der es Wärme bezieht.",
          normal: "je kälter es draußen ist, desto geringer die Effizienz (COP) und desto eher hilft der Zusatzheizer mit." } },
  { re: /water heat exchanger (inlet|outlet)/i,
    what: "Raw water temperatures at the inlet/outlet of the plate heat exchanger that transfers heat between the refrigerant and the water.",
    de: { what: "Rohe Wassertemperaturen am Ein-/Austritt des Plattenwärmetauschers, der Wärme zwischen Kältemittel und Wasser überträgt." } },
  { re: /o\/u heat exch|outdoor heat exchanger|heat exchanger mid-?temp|heat exch\. (mid-?)?temp/i,
    what: "Temperature of the outdoor coil, where refrigerant boils off (heating) or condenses (cooling) by exchanging heat with the outside air.",
    normal: "near or below freezing in cold-weather heating — that frost build-up is what triggers the periodic defrost.",
    de: { what: "Temperatur der Außeneinheit-Wärmetauscherlamellen, wo das Kältemittel verdampft (Heizen) oder kondensiert (Kühlen) und dabei Wärme mit der Außenluft tauscht.",
          normal: "beim Heizen im Kalten nahe oder unter dem Gefrierpunkt — diese Reifbildung löst das periodische Abtauen aus." } },
  { re: /discharge pipe|compressor outlet|inv discharge/i,
    what: "Temperature of the hot compressed refrigerant gas leaving the compressor.",
    normal: "the hottest point in the circuit, well above the condensing temperature. A very high value makes the unit throttle back to protect the compressor.",
    de: { what: "Temperatur des heißen, verdichteten Kältemittelgases, das den Verdichter verlässt.",
          normal: "der heißeste Punkt im Kreislauf, deutlich über der Kondensationstemperatur. Ein sehr hoher Wert lässt das Gerät zurückregeln, um den Verdichter zu schützen." } },
  { re: /suction (pipe )?temp|suction temp/i,
    what: "Temperature of the cool low-pressure refrigerant gas returning to the compressor.",
    de: { what: "Temperatur des kühlen Kältemittelgases mit niedrigem Druck, das zum Verdichter zurückströmt." } },
  { re: /liquid (pipe )?temp|liquid temperature|refrig\. temp\. liquid/i,
    what: "Refrigerant temperature on the liquid line between the heat exchangers.",
    de: { what: "Kältemitteltemperatur in der Flüssigkeitsleitung zwischen den Wärmetauschern." } },
  { re: /refrig\. temp\. evap/i,
    what: "Refrigerant temperature entering/leaving the evaporator (the heat exchanger absorbing heat).",
    de: { what: "Kältemitteltemperatur beim Ein-/Austritt des Verdampfers (der Wärme aufnehmende Wärmetauscher)." } },
  { re: /injection tube|2 phase thermistor|r4t-deicer/i,
    what: "Temperature of a vapour/liquid-injection or de-icer sensor used by the compressor's internal control.",
    de: { what: "Temperatur eines Dampf-/Flüssigkeits-Einspritz- oder Enteiser-Fühlers, den die interne Verdichterregelung nutzt." } },
  { re: /(high|low) pressure ?\(?(sat|t)/i,
    what: "The high/low refrigerant pressure expressed as a saturation temperature — the temperature the refrigerant boils/condenses at for that pressure. Easier to sanity-check than raw bar.",
    de: { what: "Der Hoch-/Niederdruck des Kältemittels ausgedrückt als Sättigungstemperatur — die Temperatur, bei der das Kältemittel bei diesem Druck siedet/kondensiert. Leichter einzuschätzen als reine bar." } },
  { re: /(high|low) pressure/i,
    what: "Refrigerant pressure on the high (compressor discharge) or low (compressor suction) side. The gap between them is what the compressor works against, and it drives efficiency.",
    normal: "varies with outdoor temperature and load; steady during stable running.",
    de: { what: "Kältemitteldruck auf der Hochdruck- (Verdichter-Druckseite) bzw. Niederdruckseite (Verdichter-Saugseite). Die Differenz dazwischen ist es, wogegen der Verdichter arbeitet, und sie bestimmt die Effizienz.",
          normal: "variiert mit Außentemperatur und Last; im stabilen Betrieb gleichmäßig." } },
  { re: /compressor speed|inv frequency|frequency \(rps\)/i,
    what: "How fast the inverter-driven compressor is spinning, in revolutions per second. This is the unit's main output control.",
    normal: "modulates from 0 up to ~100+ rps to match demand — higher when there's more to heat, 0 when idle.",
    de: { what: "Wie schnell der invertergeregelte Verdichter dreht, in Umdrehungen pro Sekunde. Das ist die wichtigste Leistungsstellgröße des Geräts.",
          normal: "moduliert von 0 bis ~100+ rps je nach Bedarf — höher, wenn mehr zu heizen ist, 0 im Leerlauf." } },
  { re: /expansion valve/i,
    what: "Opening of the electronic expansion valve, in steps/pulses. It meters exactly how much refrigerant flows into the evaporator.",
    normal: "continuously adjusts while running to keep the refrigerant cycle in its sweet spot.",
    de: { what: "Öffnung des elektronischen Expansionsventils, in Schritten/Impulsen. Es dosiert genau, wie viel Kältemittel in den Verdampfer strömt.",
          normal: "regelt im Betrieb ständig nach, um den Kältekreis im optimalen Bereich zu halten." } },
  { re: /fan\d? fin temp|fan \d fin/i,
    what: "Temperature of the outdoor fan motor's driver electronics.",
    de: { what: "Temperatur der Leistungselektronik des Außenlüftermotors." } },
  { re: /^fan ?\d|fan \d \(/i,
    what: "Outdoor fan speed, as a step or in rpm. The fan pulls outside air across the coil.",
    normal: "ramps up with compressor load; drops to 0 when idle and during parts of a defrost.",
    de: { what: "Drehzahl des Außenlüfters, als Stufe oder in U/min. Der Lüfter zieht Außenluft über die Lamellen.",
          normal: "steigt mit der Verdichterlast; fällt im Leerlauf und in Teilen eines Abtauvorgangs auf 0." } },
  { re: /target (evap|cond)/i,
    what: "An internal control target the unit is steering the refrigerant circuit toward (target evaporating/condensing temperature) — not a value you set.",
    de: { what: "Eine interne Regelvorgabe, auf die das Gerät den Kältekreis steuert (Ziel-Verdampfungs-/Kondensationstemperatur) — kein von dir eingestellter Wert." } },
  { re: /target (discharge|port)/i,
    what: "An internal control target for the compressor discharge/port temperature — used by the unit's own protection logic.",
    de: { what: "Eine interne Regelvorgabe für die Verdichter-Druckgas-/Anschlusstemperatur — genutzt von der eigenen Schutzlogik des Geräts." } },
  { re: /target delta t/i,
    what: "The target temperature difference (ΔT) between leaving and returning water the controller aims to maintain across the circuit.",
    normal: "commonly around 5 K for heating; the pump speed is trimmed to hold it.",
    de: { what: "Die Ziel-Temperaturdifferenz (ΔT) zwischen Vor- und Rücklauf, die der Regler über den Kreis halten will.",
          normal: "beim Heizen üblich um 5 K; die Pumpendrehzahl wird nachgeregelt, um sie zu halten." } },
  { re: /refrigerant type/i,
    what: "The refrigerant this unit is charged with (e.g. R32 or R410A). It sets the pressure↔temperature curve used for the saturation-temperature readings.",
    de: { what: "Das Kältemittel, mit dem dieses Gerät gefüllt ist (z. B. R32 oder R410A). Es legt die Druck-Temperatur-Kurve für die Sättigungstemperatur-Werte fest." } },
  { re: /compressor port/i,
    what: "Temperature measured at a compressor port — part of the unit's internal protection monitoring.",
    de: { what: "An einem Verdichteranschluss gemessene Temperatur — Teil der internen Schutzüberwachung des Geräts." } },
  { re: /refrigerant pressure|pressure/i,
    what: "A refrigerant-circuit pressure reading from the outdoor unit.",
    de: { what: "Ein Druckwert aus dem Kältekreis der Außeneinheit." } },

  // ── Electrical ──
  { re: /ct sensor|current measured by ct/i,
    what: "Mains current on one phase (L1/L2/L3), measured by a clamp (CT) sensor. Combined, these estimate the electrical power the unit is drawing.",
    normal: "rises with compressor and backup-heater load; near zero when idle.",
    de: { what: "Netzstrom einer Phase (L1/L2/L3), gemessen mit einem Stromwandler (CT). Zusammen schätzen sie die elektrische Leistungsaufnahme des Geräts.",
          normal: "steigt mit Verdichter- und Zusatzheizer-Last; nahe null im Leerlauf." } },
  { re: /inv (primary|secondary|compressor) current|inv .*current \(a\)/i,
    what: "Current drawn by the compressor inverter — a proxy for how hard the compressor is working.",
    de: { what: "Vom Verdichter-Inverter aufgenommener Strom — ein Maß dafür, wie stark der Verdichter arbeitet." } },
  { re: /inv fin temp|fin temp|heat sink temp/i,
    what: "Temperature of the inverter/power-electronics heatsink in the outdoor unit.",
    normal: "warm under load; a very high value makes the unit throttle to protect the electronics.",
    de: { what: "Temperatur des Kühlkörpers der Inverter-/Leistungselektronik in der Außeneinheit.",
          normal: "unter Last warm; ein sehr hoher Wert lässt das Gerät zurückregeln, um die Elektronik zu schützen." } },

  // ── Backup / booster heater ──
  { re: /buh output capacity/i,
    what: "Which stage(s) of the electric backup heater are engaged, as a capacity step.",
    normal: "0 when the heat pump covers the load alone; higher only in very cold weather or a fast DHW boost.",
    de: { what: "Welche Stufe(n) des elektrischen Zusatzheizers aktiv sind, als Leistungsstufe.",
          normal: "0, wenn die Wärmepumpe die Last allein deckt; höher nur bei sehr kaltem Wetter oder einer schnellen Warmwasser-Aufheizung." } },
  { re: /buh step/i,
    what: "An electric backup-heater stage. These use resistive electricity (efficiency ≈ 1, unlike the heat pump), so they add heat when the heat pump can't keep up.",
    normal: "OFF most of the time. Frequent use noticeably raises running cost — expected only in a cold snap or during a boost.",
    de: { what: "Eine Stufe des elektrischen Zusatzheizers. Diese nutzen Widerstandsstrom (Wirkungsgrad ≈ 1, anders als die Wärmepumpe) und ergänzen Wärme, wenn die Wärmepumpe nicht nachkommt.",
          normal: "die meiste Zeit AUS. Häufiger Einsatz erhöht die Betriebskosten spürbar — erwartbar nur bei Kälteeinbruch oder während einer Aufheizung." } },
  { re: /\bbsh\b|thermal protector/i,
    what: "The booster/backup heater for the hot-water tank, or its thermal cut-out protection.",
    normal: "the thermal protector should read normal/closed; it trips only on an over-temperature fault.",
    de: { what: "Der Zusatz-/Boosterheizer für den Warmwasserspeicher bzw. dessen thermische Schutzabschaltung.",
          normal: "der Thermoschutz sollte normal/geschlossen anzeigen; er löst nur bei Übertemperatur aus." } },
  { re: /freeze protection/i,
    what: "Anti-freeze protection: the unit runs the pump (and if needed the heater) to stop water in the pipes freezing while it's otherwise idle in the cold.",
    normal: "ON only in freezing conditions when the system is idle.",
    de: { what: "Frostschutz: Das Gerät lässt die Pumpe (und bei Bedarf den Heizer) laufen, damit das Wasser in den Leitungen im Kalten nicht einfriert, während sonst Ruhe herrscht.",
          normal: "nur bei Frost und ruhender Anlage EIN." } },

  // ── Geothermal / brine ──
  { re: /brine (inlet|outlet|temp|pump)|entering brine|leaving brine/i,
    what: "Ground-loop (brine) circuit reading on a geothermal unit — the fluid that carries heat to/from the ground, and its pump.",
    normal: "brine temperatures stay in a narrow band set by the ground; a slow seasonal drift is normal, a sharp drop is not.",
    de: { what: "Messwert des Solekreises (Erdreich) bei einer Erdwärmepumpe — die Flüssigkeit, die Wärme aus dem/ins Erdreich trägt, sowie ihre Pumpe.",
          normal: "Sole-Temperaturen bleiben in einem engen, vom Erdreich bestimmten Band; eine langsame saisonale Drift ist normal, ein plötzlicher Einbruch nicht." } },

  // ── Hybrid / second source / smart grid ──
  { re: /hybrid (op|heating)/i,
    what: "On a hybrid heat-pump + boiler system: which source the controller has chosen (heat pump only, hybrid, or boiler only) and its target.",
    de: { what: "Bei einem Hybridsystem aus Wärmepumpe + Kessel: welche Quelle der Regler gewählt hat (nur Wärmepumpe, Hybrid oder nur Kessel) und deren Zielwert." } },
  { re: /bivalent|boiler operation|boiler heating target/i,
    what: "A second heat source (typically a boiler) being called in a bivalent/hybrid setup when the heat pump alone isn't enough or isn't the cheaper option.",
    de: { what: "Eine zweite Wärmequelle (meist ein Kessel), die in einem bivalenten/Hybrid-Aufbau zugeschaltet wird, wenn die Wärmepumpe allein nicht ausreicht oder nicht die günstigere Wahl ist." } },
  { re: /be_cop|^cop\b/i,
    what: "The unit's own live estimate of its coefficient of performance — heat delivered ÷ electricity used. Higher is more efficient (3 means 3 kW of heat per 1 kW of power).",
    normal: "typically ~3–5 in mild heating; lower in hard frost or during DHW, and drops toward 1 whenever the backup heater runs.",
    de: { what: "Die geräteeigene Live-Schätzung der Leistungszahl — gelieferte Wärme ÷ aufgenommener Strom. Höher ist effizienter (3 bedeutet 3 kW Wärme je 1 kW Strom).",
          normal: "typisch ~3–5 bei milder Heizung; niedriger bei strengem Frost oder Warmwasser und fällt Richtung 1, sobald der Zusatzheizer läuft." } },
  { re: /benefit kwh|smartgrid|smart grid|solar input/i,
    what: "An external utility/smart-grid or solar signal input — e.g. a cheap-tariff or surplus-PV window telling the unit it's a good time to store extra heat.",
    normal: "ON only while that external signal is active.",
    de: { what: "Ein externes Versorger-/Smart-Grid- oder Solar-Signal — z. B. ein Niedrigtarif- oder PV-Überschuss-Fenster, das dem Gerät signalisiert, dass es günstig ist, zusätzliche Wärme zu speichern.",
          normal: "nur EIN, solange dieses externe Signal aktiv ist." } },

  // ── Capacity / identity (put after BUH-capacity above) ──
  { re: /capacity/i,
    what: "The nominal rated capacity/size class of the unit (indoor or outdoor), in kW or as a code. It's a fixed property of the model, not a live measurement.",
    de: { what: "Die nominale Leistungs-/Größenklasse des Geräts (Innen- oder Außeneinheit), in kW oder als Code. Eine feste Eigenschaft des Modells, kein Live-Messwert." } },
  { re: /silent mode|low noise/i,
    what: "Low-noise / quiet mode: caps fan and compressor speed to run more quietly, at the cost of some heating output.",
    normal: "ON during any scheduled quiet hours you've set; OFF otherwise.",
    de: { what: "Geräuscharm-/Leise-Modus: begrenzt Lüfter- und Verdichterdrehzahl für leiseren Betrieb, auf Kosten etwas Heizleistung.",
          normal: "EIN während eingestellter Ruhezeiten; sonst AUS." } },
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
  const b = (LANG === "de" && d.de) ? d.de : d;   // German copy when present, else the English row
  let h = esc(b.what);
  if (b.normal) h += ` <span class="vdesc-n">${esc(t("normal.label"))}</span> ${esc(b.normal)}`;
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
  if (!vals.length) return `<div class="vgroup"><div class="card"><span class="empty">${esc(t("values.waiting"))}</span></div></div>`;
  const order = [...GROUPS.map((g) => g[0]), "Other values"];
  const buckets = new Map();
  for (const v of vals) { const g = groupOf(v); (buckets.get(g) || buckets.set(g, []).get(g)).push(v); }
  const grouped = buckets.size > 1;
  const rowsOf = (rows) => rows.map((v) => vDescRow(v)).join("");
  // Group headings are translated; a firmware-supplied custom group (not in the dictionary) keeps its
  // own name. Bucket KEYS stay the English group name (groupOf) — only the display label is localised.
  const groupLabel = (name) => (I18N.en["group." + name] != null ? t("group." + name) : name);
  let html = ""; const done = new Set();
  const emit = (name, rows) => { html += vcard(grouped ? groupLabel(name) : t("group.Values"), rowsOf(rows)); };
  for (const name of order) if (buckets.has(name)) { emit(name, buckets.get(name)); done.add(name); }
  for (const [name, rows] of buckets) if (!done.has(name)) emit(name, rows); // firmware-supplied custom groups
  return html;
}

// ── Live system section (the interactive schematic) ──────────────────────────────────────────
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
const lwtRow = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l) && l.includes("r1t"); });
  if (!r) r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l); });
  return r || null;
};
const vLwt = () => {
  const r = lwtRow();
  if (!r) return null;
  const n = parseFloat(r.value);
  return Number.isFinite(n) ? n : null;
};
const fmt1 = (n) => (n == null ? "—" : n.toFixed(1));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const setTxt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };

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
  // The outdoor unit refreshes its OWN register pages (0x20 sensors, 0x21 inverter) only while it
  // RUNS — stopped, it answers with the LAST RUN's values (logic/ou_stale.hpp, host-tested against
  // the whole catalog). Measured on a live unit: outdoor air held exactly 19.0 °C for five hours,
  // then stepped to 25.5 at the instant the compressor started, while the hydronic pages decayed
  // smoothly throughout. Those readings must therefore not be drawn as current — DESIGN.md's
  // dead-bus rule ("an idle plant with no readings, not a stale one"), applied to one sleeping unit.
  // A held-over 19.0 °C is exactly the #35-#39 shape: well-formed, plausible, and false — and it is
  // what made an idle plant look like a running one next to a "not running" headline.
  // UNKNOWN rps (a profile with no such row) reads as CURRENT, never as held over: that is absence
  // of evidence, and blanking on a guess would cost a reading that may well be live.
  d.ouHeldOver = d.rps != null && d.rps === 0;
  // Circuit refrigerant pressure for the schematic's high-side badge. The outdoor unit's own High
  // Pressure transducer (reg 0x20) reads 0 bar while the compressor is off — but a sealed R32 circuit
  // is never at 0 bar, so "0.0 bar" paints a live-looking fault on an idle unit. Fall back to the
  // always-live Refrigerant pressure sensor (reg 0x62/15), which reports the real equalised system
  // pressure at rest (~14 bar for R32 near 20 °C). When the compressor runs, High Pressure is the true
  // discharge pressure and wins. Neither present (17 profiles carry no pressure row) → null → "—".
  // Gated on ouHeldOver too: this unit reads 0 bar at rest so the fallback already fires, but a unit
  // whose 0x20 freezes at a NON-zero pressure would otherwise show that stale bar as the live one.
  d.circP = !d.ouHeldOver && d.hp != null && d.hp > 0 ? d.hp : d.rp;
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

// Every value pill in the schematic, so a lost link can blank the whole drawing in one pass. The
// SVG now stays on screen when the bus goes quiet (it holds the status block — see renderLive), so
// leaving the last readings in place would assert values nobody is measuring any more.
const SCHEM_PILL_IDS = [
  "svOut", "svRps", "svHp", "svLp", "svDisch", "svEev", "svLwt", "svRwt", "svDt",
  "svFlow", "svWp", "svPump", "svTank", "svTankSet", "svRoom", "svRoomSet", "svPth", "svCop", "svPel",
];
function clearSchematic() {
  SCHEM_PILL_IDS.forEach((id) => setTxt(id, "—"));
  setTxt("svPelSrc", "");
  setTxt("svDtSet", "");     // an optional trailing segment, not a value — blanks to nothing, not "—"
  setTxt("svBuh", "");                 // no BUH step to report
  setTxt("svValve", "3WV");            // valve position unknown — don't claim a branch
  const sc = $("schem");
  ["fan-on", "pump-on", "buh-on", "defrost-on", "quiet-on"].forEach((c) => sc.classList.remove(c));
  sc.classList.add("no-thermo");       // no flag to show; the pill would otherwise sit stale
  $("schem").querySelectorAll(".sc-flow, .sc-rflow").forEach((el) => el.classList.remove("on", "rev"));
}

function renderLive() {
  // The readings were decoded once in renderDashboard (S.live, null when the link is down or no
  // value has arrived). The status block above and this drawing therefore render from the SAME
  // snapshot and cannot disagree about whether the plant is running. The inspector reads it too, so
  // an open explainer follows the live values.
  const d = S.live;
  // Nothing hides when the link drops: the schematic carries the status block (mode / fault /
  // "no data"), which is exactly what must survive a dead bus. Every pill blanks to "—" and every
  // animation stops instead, so the drawing shows an idle plant with no readings, not a stale one.
  if (!d) { clearSchematic(); renderInspect(); return; }

  // Bit-flag states, each drawn at the component it belongs to: the room thermostat on the heating
  // riser, the BUH step in the BUH label, low-noise mode on the outdoor unit. (Pump and defrost were
  // already drawn — rotation + "PUMP n%", the ❄ pill + the reversed refrigerant loop.)
  const pumping = d.pumpOn ?? (d.flow != null ? d.flow > 1 : null);
  setTxt("svThermo", t(d.thermo ? "chip.thermo_on" : "chip.thermo_off"));
  $("gThermo").classList.toggle("on", d.thermo === true);
  // A non-breaking space: SVG collapses ordinary leading whitespace in a tspan, which would render
  // the step glued to the label ("BUH2").
  setTxt("svBuh", d.buh2 ? "\u00A02" : d.buh1 ? "\u00A01" : "");

  // Schematic badges
  // Outdoor air + discharge come off the pages the outdoor unit stops refreshing when it stops
  // running (d.ouHeldOver): blank them rather than assert a reading from the last cycle as current.
  setTxt("svOut", d.ouHeldOver ? "—" : fmt1(d.out)); setTxt("svRps", fmt0(d.rps));
  // High-side badge shows the circuit pressure (real refrigerant sensor when the compressor's own HP
  // transducer is idle-zero — see d.circP). Low/suction side has no equivalent at-rest gauge, so show
  // "—" rather than a misleading 0.0 bar when the compressor is off.
  setTxt("svHp", fmt1(d.circP));
  setTxt("svLp", !d.ouHeldOver && d.lp != null && d.lp > 0 ? fmt1(d.lp) : "—");
  setTxt("svDisch", d.ouHeldOver ? "—" : fmt0(d.disch)); setTxt("svEev", fmt0(d.eev));
  setTxt("svLwt", fmt1(d.lwt)); setTxt("svRwt", fmt1(d.ret));
  // ΔT is a WORKING POINT across the exchanger — it needs water moving to mean anything. With the
  // pump off, R1T and R4T are two stagnant sensors cooling at different rates, and their difference
  // (measured: 14.6 K on a plant that had been idle for an hour) reads as a live working point
  // directly beside a "not running" headline. Unknown flow AND unknown pump (no rows) still prints:
  // that is not evidence of no flow. Same reasoning as the derived kW/COP, which already gate.
  const stagnant = d.pumpOn === false && d.flow != null && d.flow <= 0;
  setTxt("svDt", stagnant ? "—" : fmt1(d.dt)); setTxt("svFlow", fmt1(d.flow));
  setTxt("svWp", fmt1(d.wp)); setTxt("svPump", fmt0(d.pump));
  setTxt("svTank", fmt1(d.tank)); setTxt("svTankSet", fmt1(d.tankSet));
  setTxt("svRoom", fmt1(d.room)); setTxt("svRoomSet", fmt1(d.roomSet));
  setTxt("svPth", fmt1(d.pth));   // derived — the pill carries "≈" + an "est." sub-label
  const toDhw = d.valveDhw === true;
  setTxt("svValve", t(toDhw ? "schem.to_dhw" : "schem.to_heat"));

  // Schematic state classes drive the CSS animations (flows, fan, pump, BUH glow, defrost)
  const sc = $("schem");
  const rpsOn = (d.rps ?? 0) > 0;
  sc.classList.toggle("fan-on", rpsOn && d.defrost !== true);
  sc.classList.toggle("pump-on", pumping === true);
  sc.classList.toggle("buh-on", !!(d.buh1 || d.buh2));
  sc.classList.toggle("defrost-on", d.defrost === true);
  sc.classList.toggle("quiet-on", d.quiet === true);
  sc.classList.toggle("no-dhw", d.tank == null);
  sc.classList.toggle("no-room", d.room == null);
  sc.classList.toggle("no-pth", d.pth == null);
  sc.classList.toggle("no-thermo", d.thermo == null);
  const onCls = (id, on) => $(id).classList.toggle("on", !!on);
  onCls("fSup1", pumping); onCls("fSup2", pumping); onCls("fSup3", pumping); onCls("fRet", pumping);
  onCls("fTank", pumping && toDhw); onCls("fCoil", pumping && toDhw); onCls("fTankRet", pumping && toDhw);
  onCls("fHeat", pumping && !toDhw); onCls("fHeatRet", pumping && !toDhw);
  onCls("rfHot", rpsOn); onCls("rfCold", rpsOn);
  $("rfHot").classList.toggle("rev", d.defrost === true);   // defrost reverses the refrigerant loop
  $("rfCold").classList.toggle("rev", d.defrost === true);

  // The derived figures that used to live in KPI tiles below the drawing, now at their place in it:
  // the target ΔT beside the measured one, COP beside the heat output it is computed from, and the
  // electrical input on the outdoor unit where the power actually goes in.
  // The target ΔT is a HEATING setpoint (the spec lists a separate cooling one), and no shipped
  // profile currently carries either — so it is an optional trailing segment, not a fixed half of
  // the pill: absent, or not heating, and it simply is not claimed.
  const heating = /heat/i.test(pickValue(/i\/u operation mode/i) || "");
  setTxt("svDtSet", d.dtSet != null && heating ? ` · ${t("kpi.target")} ${fmt1(d.dtSet)} K` : "");
  setTxt("svCop", d.cop == null ? "—" : d.cop.toFixed(1));
  setTxt("svPel", fmt1(d.pel));
  // The source is part of the reading, not trivia: CT clamps measure the whole unit, the inverter
  // current only the compressor — so an INV-based estimate misses the backup heater entirely.
  setTxt("svPelSrc", d.pel != null ? t("schem.est_src", d.pelSrc) : t("schem.no_ct"));

  renderInspect();     // keep an open explainer's reading/state sentence current
}

// ── Schematic inspector: tap a pill or a component → what it is, what's normal, what it's doing ──
// The point of the diagram is to be explorable: every hit target in the SVG (data-insp) maps to one
// INSPECT entry here. Two kinds of entry, one renderer:
//   • a VALUE (a pill) — `re` finds its live /values row for the reading and the source label, and
//     `sample` (a canonical register label) resolves the explainer text out of DESCRIPTIONS. The
//     explainer copy therefore has ONE source: the same table the value list below the diagram uses.
//     `sample` is matched instead of the live label on purpose — the pill draws a CONCEPT, and a
//     profile's own spelling of it could match a neighbouring DESCRIPTIONS entry.
//   • a COMPONENT (outdoor unit, PHE, heating circuit, …) — carries its own `what` (nothing in
//     DESCRIPTIONS describes an assembly) plus `now(d)`, a sentence built from the live values that
//     says what the part is doing right now, and `rows`, the readings that belong to it.
// Copy is bilingual like DESCRIPTIONS ({en, de}); `now` returns the same shape.
const tx = (o) => (o == null ? "" : typeof o === "string" ? o : (LANG === "de" && o.de) ? o.de : o.en);
const degC = (n) => (n == null ? "—" : fmt1(n) + " °C");

const INSPECT = {
  status: {
    t: { en: "Operating mode", de: "Betriebsart" },
    re: /i\/u operation mode/i, sample: "I/U Operation Mode",
    rows: [/i\/u operation mode/i, /(error|fault) code/i],
  },
  ou: {
    t: { en: "Outdoor unit", de: "Außeneinheit" },
    what: {
      en: "The outdoor half of the heat pump: a fan pulls outside air over the evaporator, where the refrigerant boils and picks up heat even well below 0 °C, and the compressor raises that heat to a useful temperature before it crosses to the water side. Everything here is refrigerant, not water.",
      de: "Die Außenhälfte der Wärmepumpe: Ein Ventilator saugt Außenluft über den Verdampfer, in dem das Kältemittel verdampft und dabei selbst deutlich unter 0 °C Wärme aufnimmt; der Verdichter hebt diese Wärme auf ein nutzbares Temperaturniveau, bevor sie auf die Wasserseite übergeht. Hier fließt Kältemittel, kein Wasser.",
    },
    now: (d) => d.defrost
      ? { en: "Defrosting — the circuit is running in reverse to melt ice off the evaporator, so heat is briefly taken back out of the heating water.",
          de: "Abtauen — der Kreis läuft rückwärts, um den Verdampfer abzutauen; dabei wird dem Heizwasser kurzzeitig wieder Wärme entzogen." }
      : (d.rps ?? 0) > 0
        ? { en: `Running — compressor at ${fmt0(d.rps)} rps${d.quiet ? ", capped by quiet mode" : ""}.`,
            de: `Läuft — Verdichter mit ${fmt0(d.rps)} rps${d.quiet ? ", durch den Leise-Modus begrenzt" : ""}.` }
        // Says why the outdoor pills read "—" at rest: the unit stops refreshing its own registers
        // when it stops, so those readings would be the LAST run's (logic/ou_stale.hpp). This is the
        // discoverable half of the fix — the pill can only blank, it cannot explain itself.
        : { en: "Idle — the compressor is stopped, so no heat is being produced. The outdoor unit also stops refreshing its own sensors while it rests, so outdoor air and discharge temperature read \"—\" rather than repeat the last run's values.",
            de: "Standby — der Verdichter steht, es wird gerade keine Wärme erzeugt. Die Außeneinheit aktualisiert im Stillstand auch ihre eigenen Sensoren nicht mehr; Außenluft und Heißgastemperatur zeigen daher „—\" statt die Werte des letzten Laufs zu wiederholen." },
    rows: [/outdoor air/i, /inv frequency/i, /^high pressure$/i, /discharge pipe temp/i, /expansion valve ?1/i, /defrost operation/i],
  },
  comp: {
    t: { en: "Compressor", de: "Verdichter" },
    re: /inv frequency/i, sample: "INV frequency (rps)",
    rows: [/inv frequency/i, /inv primary current/i, /discharge pipe temp/i],
  },
  out: { t: { en: "Outdoor air", de: "Außentemperatur" }, re: /outdoor air/i, sample: "Outdoor Air Temp. (R1T)" },
  disch: {
    t: { en: "High side (discharge)", de: "Hochdruckseite" },
    re: /^high pressure$/i, sample: "High pressure",
    rows: [/^high pressure$/i, /discharge pipe temp/i, /^refrigerant pressure sensor$/i],
  },
  // Both readings on this pill belong to the OUTDOOR unit, not to the liquid line they are drawn on:
  // the expansion valve is fitted there, and the low pressure is what exists downstream of it. The
  // pill sits at this end of the pipe because that is where the valve is — naming it "suction side"
  // implied the pipe itself was the suction leg, which it is not (see rcold).
  suction: {
    t: { en: "Low side & expansion valve", de: "Niederdruck & Expansionsventil" },
    what: {
      en: "Both belong to the outdoor unit at the far end of this pipe: the electronic expansion valve meters how much refrigerant is let through, and the low pressure is what the circuit drops to once past it. A low-pressure reading is not available on every model — the outdoor unit here has a high-pressure switch but no low-pressure transducer, so this half often stays \"—\".",
      de: "Beides gehört zum Außengerät am fernen Ende dieser Leitung: Das elektronische Expansionsventil dosiert, wie viel Kältemittel durchgelassen wird, und der Niederdruck ist der Druck, auf den der Kreis dahinter abfällt. Nicht jedes Modell liefert einen Niederdruckwert — das Außengerät hier hat einen Hochdruckschalter, aber keinen Niederdruckgeber, daher bleibt diese Hälfte oft \"—\".",
    },
    re: /^low pressure$/i, sample: "Low pressure",
    rows: [/^low pressure$/i, /expansion valve ?1/i],
  },
  phe: {
    t: { en: "Plate heat exchanger", de: "Plattenwärmetauscher" },
    what: {
      en: "Where the refrigerant hands its heat over to the heating water. The two never mix — they flow through alternating thin plates. Everything to its left is refrigerant, everything to its right is water; the heat crossing it is flow × ΔT, which is the estimate shown here.",
      de: "Hier gibt das Kältemittel seine Wärme an das Heizwasser ab. Beide vermischen sich nie — sie strömen durch abwechselnde dünne Platten. Links davon ist Kältemittel, rechts Wasser; die übertragene Wärme ist Durchfluss × ΔT, also die hier gezeigte Schätzung.",
    },
    now: (d) => d.pth == null
      ? { en: "No estimate — flow rate or ΔT is missing on this model.",
          de: "Keine Schätzung — Durchfluss oder ΔT fehlt bei diesem Modell." }
      : { en: `About ${fmt1(d.pth)} kW crossing into the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Rund ${fmt1(d.pth)} kW gehen ins Wasser über (${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K).` },
    rows: [lwtRow, /inlet water/i, /flow sensor/i],
  },
  lwt: {
    t: { en: "Leaving water (pre-BUH, R1T)", de: "Vorlauf (vor BUH, R1T)" },
    pick: lwtRow,
    sample: "Leaving Water Temp. before BUH (R1T)",
  },
  rwt: { t: { en: "Return water", de: "Rücklauf" }, re: /inlet water/i, sample: "Inlet Water Temp. (R4T)" },
  dt: {
    t: { en: "ΔT across the system", de: "ΔT über die Anlage" },
    what: {
      en: "Leaving water minus return water — how much heat the house actually pulled out of the circuit. Not a register: it is computed from the two temperatures. The controller varies pump speed to hold its target ΔT.",
      de: "Vorlauf minus Rücklauf — wie viel Wärme das Haus dem Kreis tatsächlich entzogen hat. Kein Registerwert, sondern aus den beiden Temperaturen berechnet. Der Regler variiert die Pumpendrehzahl, um sein Ziel-ΔT zu halten.",
    },
    head: (d) => (d.dt == null ? "—" : fmt1(d.dt) + " K"),
    now: (d) => d.dt == null ? null
      : { en: `${fmt1(d.dt)} K${d.dtSet != null ? ` against a ${fmt1(d.dtSet)} K heating target` : ""}. Around 5 K is a healthy heating ΔT; a negative value means heat is flowing back out (a defrost).`,
          de: `${fmt1(d.dt)} K${d.dtSet != null ? ` bei ${fmt1(d.dtSet)} K Heiz-Ziel` : ""}. Rund 5 K sind ein gesundes Heiz-ΔT; ein negativer Wert heißt, dass Wärme zurückfließt (Abtauung).` },
    rows: [lwtRow, /inlet water/i, /target delta t heating/i],
  },
  pth: {
    t: { en: "Heat output (estimated)", de: "Wärmeleistung (geschätzt)" },
    what: {
      en: "An ESTIMATE, not a measurement — the bus carries no energy register. It is computed from flow rate and ΔT with the heat capacity of water (4.186 kJ/kg·K), so it is only as good as the flow sensor and the two water temperatures, and it counts only heat from the heat pump's own exchanger (the backup heater sits after it). During a defrost it goes negative, which is real: heat is being taken back out of the water.",
      de: "Eine SCHÄTZUNG, keine Messung — auf dem Bus gibt es kein Energieregister. Berechnet aus Durchflussmenge und ΔT über die Wärmekapazität von Wasser (4,186 kJ/kg·K), also nur so genau wie der Durchflusssensor und die beiden Wassertemperaturen; gezählt wird nur die Wärme aus dem Wärmetauscher der Wärmepumpe (der Zusatzheizer sitzt dahinter). Beim Abtauen wird der Wert negativ — das ist echt: dem Wasser wird Wärme entzogen.",
    },
    head: (d) => (d.pth == null ? "—" : "≈ " + fmt1(d.pth) + " kW"),
    now: (d) => d.pth == null ? null
      : { en: `≈ ${fmt1(d.pth)} kW${d.cop != null ? `, about ${d.cop.toFixed(1)} kW of heat per kW of electricity (COP)` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW${d.cop != null ? `, etwa ${d.cop.toFixed(1)} kW Wärme je kW Strom (COP)` : ""}.` },
    rows: [/flow sensor/i, /target delta t heating/i, /current measured by ct/i, /inv primary current/i],
  },
  buh: {
    t: { en: "Backup heater (BUH)", de: "Zusatzheizer (BUH)" },
    re: /buh step ?1/i, sample: "BUH step 1",
    now: (d) => (d.buh1 == null && d.buh2 == null) ? null
      : d.buh2 ? { en: "Step 2 — both stages firing.", de: "Stufe 2 — beide Stufen heizen." }
      : d.buh1 ? { en: "Step 1 — one stage firing.", de: "Stufe 1 — eine Stufe heizt." }
      : { en: "Off — the heat pump is covering the load on its own.", de: "Aus — die Wärmepumpe deckt die Last allein." },
    rows: [/buh step ?1/i, /buh step ?2/i, /buh output capacity/i],
  },
  valve: {
    t: { en: "3-way valve", de: "3-Wege-Ventil" },
    re: /3.?way valve/i, sample: "3-way valve (On:DHW/Off:Space)",
    now: (d) => d.valveDhw == null ? null
      : d.valveDhw ? { en: "Diverted to the hot-water tank — space heating is paused meanwhile.",
                       de: "Auf den Warmwasserspeicher geschaltet — die Raumheizung pausiert solange." }
                   : { en: "Diverted to the heating circuit.", de: "Auf den Heizkreis geschaltet." },
  },
  tank: {
    t: { en: "DHW tank", de: "Warmwasserspeicher" },
    re: /dhw tank temp/i, sample: "DHW Tank Temp. (R5T)",
    now: (d) => d.tank == null ? null
      : { en: `${degC(d.tank)} in the tank${d.tankSet != null ? `, target ${degC(d.tankSet)}` : ""}.`,
          de: `${degC(d.tank)} im Speicher${d.tankSet != null ? `, Ziel ${degC(d.tankSet)}` : ""}.` },
    rows: [/dhw tank temp/i, /dhw setpoint/i, /3.?way valve/i],
  },
  heat: {
    t: { en: "Heating circuit", de: "Heizkreis" },
    what: {
      en: "The radiators or underfloor loops in the house. They are fed only while the 3-way valve points here — a hot-water cycle takes priority and pauses them. How fast they give heat off depends on flow temperature and emitter size, which is why underfloor runs cooler than radiators.",
      de: "Die Heizkörper bzw. Fußbodenkreise im Haus. Sie werden nur versorgt, solange das 3-Wege-Ventil hierher zeigt — eine Warmwasserladung hat Vorrang und pausiert sie. Wie schnell sie Wärme abgeben, hängt von Vorlauftemperatur und Heizflächengröße ab; deshalb läuft eine Fußbodenheizung kühler als Heizkörper.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "Paused — the valve is feeding the hot-water tank right now.",
          de: "Pausiert — das Ventil versorgt gerade den Warmwasserspeicher." }
      : (d.pumpOn ?? (d.flow != null && d.flow > 1))
        ? { en: `Being fed at ${degC(d.lwt)} flow${d.thermo === false ? ", though the thermostat is satisfied" : ""}.`,
            de: `Wird mit ${degC(d.lwt)} Vorlauf versorgt${d.thermo === false ? ", obwohl der Thermostat zufrieden ist" : ""}.` }
        : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [/^indoor ambient temp/i, /^rt setpoint/i, /thermostat on/i],
  },
  thermo: { t: { en: "Room thermostat", de: "Raumthermostat" }, re: /thermostat on/i, sample: "Thermostat ON/OFF" },
  room: {
    t: { en: "Room temperature", de: "Raumtemperatur" },
    re: /^indoor ambient temp/i, sample: "Indoor Ambient Temp. (R1T)",
    rows: [/^indoor ambient temp/i, /^rt setpoint/i],
  },
  pump: {
    t: { en: "Circulation pump", de: "Umwälzpumpe" },
    what: {
      en: "Drives the water round the whole circuit. It sits on the supply side, after the plate exchanger and after the backup heater, and is the last part the water passes before it leaves the unit for the 3-way valve. Its speed is modulated to hold the target ΔT: the harder the house pulls heat out, the faster it runs.",
      de: "Treibt das Wasser durch den gesamten Kreis. Sie sitzt im Vorlauf, nach dem Plattenwärmetauscher und nach dem Zusatzheizer, und ist das letzte Bauteil, das das Wasser durchläuft, bevor es das Gerät zum 3-Wege-Ventil verlässt. Ihre Drehzahl wird geregelt, um das Ziel-ΔT zu halten: Je mehr Wärme das Haus entnimmt, desto schneller läuft sie.",
    },
    re: /water pump operation/i, sample: "Water pump operation",
    // 0 % is a stopped pump, not a pump "running at 0 %" — the old wording asserted circulation on
    // an idle plant, next to a flow pill reading 0.0 l/min.
    now: (d) => d.pump == null ? null
      : d.pump > 0
        ? { en: `Running at ${fmt0(d.pump)} % of full speed, moving ${fmt1(d.flow)} l/min.`,
            de: `Läuft mit ${fmt0(d.pump)} % der vollen Drehzahl und fördert ${fmt1(d.flow)} l/min.` }
        : { en: "Stopped — no water is circulating.", de: "Steht — es zirkuliert kein Wasser." },
    rows: [/water pump signal/i, /flow sensor/i, /^water pressure$/i],
  },
  pel: {
    t: { en: "Electrical input (estimated)", de: "Stromaufnahme (geschätzt)" },
    what: {
      en: "What the unit is drawing from the mains, and the divisor of the COP. Also an ESTIMATE: it is measured current × an assumed 230 V, so it ignores power factor. Which current matters — CT clamps see the whole unit including the backup heater, the inverter current sees only the compressor, so an INV-based figure understates consumption whenever the backup heater is firing (and the COP shown is then too flattering).",
      de: "Was das Gerät aus dem Netz zieht, und der Nenner des COP. Ebenfalls eine SCHÄTZUNG: gemessener Strom × angenommene 230 V, der Leistungsfaktor bleibt also unberücksichtigt. Welcher Strom, ist entscheidend — Stromwandler (CT) erfassen das ganze Gerät inklusive Zusatzheizer, der Inverterstrom nur den Verdichter; ein INV-Wert unterschätzt den Verbrauch also, sobald der Zusatzheizer heizt (und der gezeigte COP ist dann zu schön).",
    },
    head: (d) => (d.pel == null ? "—" : "≈ " + fmt1(d.pel) + " kW"),
    now: (d) => d.pel == null
      ? { en: "No current reading on this profile, so no COP can be derived either.",
          de: "Dieses Profil liefert keinen Strommesswert, daher lässt sich auch kein COP ableiten." }
      : { en: `From ${d.pelSrc === "CT" ? "the CT clamps (whole unit)" : "the inverter current (compressor only)"}.`,
          de: `Aus ${d.pelSrc === "CT" ? "den Stromwandlern (ganzes Gerät)" : "dem Inverterstrom (nur Verdichter)"}.` },
    rows: [/current measured by ct/i, /inv primary current/i],
  },
  defrost: {
    t: { en: "Defrost", de: "Abtauen" },
    re: /defrost operation/i, sample: "Defrost Operation",
  },
  quiet: {
    t: { en: "Quiet mode", de: "Leise-Modus" },
    re: /low noise control|silent mode/i, sample: "Low noise control",
  },

  // ── Pipe runs. Each says what is IN it, which way it goes, and whether anything is moving now —
  //    the questions a schematic invites and that no value row answers.
  // The two interconnecting pipes are named for what they CARRY, which is fixed, not for the role
  // they play, which flips with the mode: this is the gas line and the one below is the liquid line
  // in both directions of the cycle. Calling the lower one a "suction line" was wrong in heating —
  // there it holds warm condensed liquid on the HIGH-pressure side, because the expansion valve sits
  // in the outdoor unit at its far end. The suction leg proper never leaves the outdoor unit.
  rhot: {
    t: { en: "Gas line (hot gas in heating)", de: "Gasleitung (Heißgas im Heizbetrieb)" },
    what: {
      en: "The thick pipe between the units. In heating, refrigerant leaves the compressor here as a hot, high-pressure gas and carries the heat to the plate exchanger, where it condenses and gives that heat to the water — the hottest point in the machine, and the discharge temperature beside it is measured right at the compressor outlet. In cooling the flow reverses and this same pipe returns cool gas from the exchanger to the compressor.",
      de: "Die dicke Leitung zwischen den Geräten. Im Heizbetrieb verlässt das Kältemittel den Verdichter hier als heißes Gas unter hohem Druck und trägt die Wärme zum Plattenwärmetauscher, wo es kondensiert und die Wärme ans Wasser abgibt — der heißeste Punkt der Maschine; die Heißgastemperatur daneben wird direkt am Verdichteraustritt gemessen. Im Kühlbetrieb kehrt sich die Richtung um und dieselbe Leitung führt kühles Gas vom Wärmetauscher zurück zum Verdichter.",
    },
    now: (d) => (d.rps ?? 0) > 0
      ? { en: `Flowing — ${fmt1(d.circP)} bar at ${fmt0(d.disch)} °C.`,
          de: `Durchströmt — ${fmt1(d.circP)} bar bei ${fmt0(d.disch)} °C.` }
      : { en: "Still — the compressor is stopped, so the circuit is at rest and simply equalised.",
          de: "Steht — der Verdichter ist aus, der Kreis ruht und ist einfach ausgeglichen." },
    rows: [/^high pressure$/i, /discharge pipe temp/i],
  },
  rcold: {
    t: { en: "Liquid line", de: "Flüssigkeitsleitung" },
    what: {
      en: "The thin pipe between the units. In heating it carries the refrigerant back as a warm liquid, still under high pressure: it condensed in the plate exchanger and gave its heat to the water, but it has not expanded yet — the expansion valve sits in the outdoor unit at the far end of this pipe. Only past that valve does it turn cold and low-pressure, and only then does it pick up heat from the outside air in the outdoor coil, which is why that coil frosts up and needs defrosting.",
      de: "Die dünne Leitung zwischen den Geräten. Im Heizbetrieb führt sie das Kältemittel als warme Flüssigkeit zurück, weiterhin unter hohem Druck: Es ist im Plattenwärmetauscher kondensiert und hat seine Wärme ans Wasser abgegeben, aber es ist noch nicht entspannt — das Expansionsventil sitzt im Außengerät am fernen Ende dieser Leitung. Erst hinter diesem Ventil wird es kalt und niederdruckseitig, und erst dann nimmt es im Außenwärmetauscher Wärme aus der Luft auf; deshalb bereift dieser und muss abgetaut werden.",
    },
    now: (d) => (d.rps ?? 0) > 0
      ? { en: `Flowing — expansion valve at ${fmt0(d.eev)} pulses.`,
          de: `Durchströmt — Expansionsventil bei ${fmt0(d.eev)} Impulsen.` }
      : { en: "Still — the compressor is stopped.", de: "Steht — der Verdichter ist aus." },
    rows: [/^low pressure$/i, /expansion valve ?1/i],
  },
  wsup: {
    t: { en: "Flow pipe", de: "Vorlaufleitung" },
    what: {
      en: "Heated water on its way from the plate exchanger, past the electric backup heater and through the circulation pump, to the 3-way valve that decides whether it goes to the tank or to the house. Nothing heats it between the exchanger and the valve unless the backup heater is firing — which is why the temperature shown before the heater is the one the heat pump itself produced.",
      de: "Erwärmtes Wasser auf dem Weg vom Plattenwärmetauscher, am elektrischen Zusatzheizer vorbei und durch die Umwälzpumpe, zum 3-Wege-Ventil, das entscheidet, ob es zum Speicher oder ins Haus geht. Zwischen Wärmetauscher und Ventil erwärmt es nichts weiter — außer der Zusatzheizer heizt gerade; deshalb ist die vor dem Heizer gezeigte Temperatur die, die die Wärmepumpe selbst erzeugt hat.",
    },
    now: (d) => (d.pumpOn ?? (d.flow != null && d.flow > 1))
      ? { en: `Carrying ${degC(d.lwt)} at ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? ", reheated by the backup heater" : ""}.`,
          de: `Führt ${degC(d.lwt)} bei ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? ", vom Zusatzheizer nachgeheizt" : ""}.` }
      : { en: "No circulation — the pump is stopped, so this water is standing still.",
          de: "Keine Zirkulation — die Pumpe steht, dieses Wasser steht still." },
    rows: [lwtRow, /flow sensor/i],
  },
  wtank: {
    t: { en: "Tank circuit", de: "Speicherkreis" },
    what: {
      en: "The branch to the hot-water tank. The water does not enter the tank — it runs through a coil inside it and warms the stored water from the outside, then returns. It only flows while the 3-way valve points here, and a tank cycle pauses space heating for its duration.",
      de: "Der Abzweig zum Warmwasserspeicher. Das Wasser gelangt nicht in den Speicher — es läuft durch eine Wendel darin und erwärmt das gespeicherte Wasser von außen, dann kehrt es zurück. Es fließt nur, solange das 3-Wege-Ventil hierher zeigt; eine Speicherladung pausiert währenddessen die Raumheizung.",
    },
    now: (d) => d.valveDhw === true
      ? { en: `Charging the tank — ${degC(d.lwt)} in, tank at ${degC(d.tank)}.`,
          de: `Lädt den Speicher — ${degC(d.lwt)} hinein, Speicher bei ${degC(d.tank)}.` }
      : { en: "Closed — the valve is feeding the heating circuit instead.",
          de: "Geschlossen — das Ventil versorgt stattdessen den Heizkreis." },
    rows: [/dhw tank temp/i, /dhw setpoint/i, /3.?way valve/i],
  },
  wheat: {
    t: { en: "Heating flow branch", de: "Heizungs-Vorlauf" },
    what: {
      en: "The branch that feeds the radiators or underfloor loops. What comes back down the return line is cooler by exactly the heat the house took — that difference is the ΔT shown at the exchanger.",
      de: "Der Abzweig, der die Heizkörper bzw. Fußbodenkreise versorgt. Was über die Rücklaufleitung zurückkommt, ist genau um die vom Haus entnommene Wärme kühler — dieser Unterschied ist das am Wärmetauscher gezeigte ΔT.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "Paused — the valve is diverted to the hot-water tank.",
          de: "Pausiert — das Ventil ist auf den Warmwasserspeicher umgeschaltet." }
      : (d.pumpOn ?? (d.flow != null && d.flow > 1))
        ? { en: `${degC(d.lwt)} out, ${degC(d.ret)} back — ΔT ${fmt1(d.dt)} K.`,
            de: `${degC(d.lwt)} hin, ${degC(d.ret)} zurück — ΔT ${fmt1(d.dt)} K.` }
        : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [lwtRow, /inlet water/i, /thermostat on/i],
  },
  wret: {
    t: { en: "Return pipe", de: "Rücklaufleitung" },
    what: {
      en: "Cooled water coming back from the house and the tank, past the dirt filter and the flow and pressure sensors, into the plate exchanger to be warmed again. Its temperature is the honest measure of how much heat the building actually absorbed. The pump is not in this line — it sits on the supply side, after the backup heater.",
      de: "Abgekühltes Wasser, das aus Haus und Speicher zurückkommt, am Schmutzfilter und den Durchfluss- und Drucksensoren vorbei in den Plattenwärmetauscher läuft und dort wieder erwärmt wird. Seine Temperatur ist das ehrliche Maß dafür, wie viel Wärme das Gebäude tatsächlich aufgenommen hat. Die Pumpe sitzt nicht in dieser Leitung, sondern im Vorlauf hinter dem Zusatzheizer.",
    },
    now: (d) => (d.pumpOn ?? (d.flow != null && d.flow > 1))
      ? { en: `Returning at ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.`,
          de: `Kommt mit ${degC(d.ret)} zurück, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` }
      : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [/inlet water/i, /flow sensor/i, /^water pressure$/i],
  },
  flow: {
    t: { en: "Flow & water pressure", de: "Durchfluss & Wasserdruck" },
    re: /flow sensor/i, sample: "Flow sensor",
    rows: [/flow sensor/i, /^water pressure$/i, /water pump signal/i],
  },
};

// A row selector is either a label pattern or a PICKER FUNCTION. Quantities whose selection is a
// judgement rather than a match — leaving water, where a setpoint / mixed-zone / post-BUH row must
// never be substituted for the measurement (issue #121) — name their picker, so the rule lives in
// exactly one place and stays the one CI gates through logic/lwt_select.hpp.
const pickRow = (sel) => (typeof sel === "function" ? sel() : vRow(sel));
const inspRow = (e) => (e.pick ? e.pick() : e.re ? vRow(e.re) : null);

// The reading of a /values row as one string ("42.8 °C"); "—" for an absent row.
const inspVal = (r) => (r == null ? "—" : String(r.value) + (r.unit ? " " + r.unit : ""));

// Everything the panel would draw, as one string — the change key for the render guard above. It
// covers the selection, the headline, the live sentence and every member reading, so a value moving
// still repaints while an idle second does not.
function inspectSig(e) {
  if (!e) return "";
  const d = S.live;
  const row = d ? inspRow(e) : null;
  const rows = (d && e.rows ? e.rows.map((sel) => inspVal(pickRow(sel))) : []).join(",");
  return [S.insp, inspVal(row), d && e.head ? e.head(d) : "", d && e.now ? tx(e.now(d)) : "", rows].join("|");
}

function renderInspect() {
  const e = S.insp ? INSPECT[S.insp] : null;
  // This runs on EVERY poll so an open explainer tracks the live values — but writing innerHTML each
  // second would collapse a text selection the user is mid-read of. Diff the rendered result first
  // and touch the DOM only when something actually changed.
  const sig = inspectSig(e);
  if (sig === S.inspSig) return;
  S.inspSig = sig;
  $("inspHint").hidden = !!e;
  $("inspCard").hidden = !e;
  document.querySelectorAll("#schem .sc-hit").forEach((el) => el.classList.toggle("sel", el.dataset.insp === S.insp));
  if (!e) return;
  const d = S.live;                       // null while the X10A link is down → readings show "—"
  const row = d ? inspRow(e) : null;
  setTxt("inspTitle", tx(e.t));
  // The source line names the /values row this pill is drawn from, so a number in the picture can be
  // traced to the register list below. Falls back to the canonical label when the row is absent.
  setTxt("inspSrc", row ? row.label : (e.sample || ""));
  $("inspSrc").hidden = !(row || e.sample);
  // Headline = the ONE compact reading this target stands for (its row, or a derived `head` for the
  // computed pills). An assembly like the outdoor unit has no single number, so it gets no headline
  // at all rather than a "—" that would read as a missing value.
  const hasHead = !!(e.re || e.pick || e.head);
  $("inspNow").hidden = !hasHead;
  if (hasHead) setTxt("inspNow", row ? inspVal(row) : (d && e.head ? e.head(d) : "—"));
  // `now` is always prose — the live "what is it doing" sentence — so it opens the body in bold,
  // ahead of the timeless explainer. Never the headline: a sentence in a 19px number slot reads as
  // a broken value.
  const sentence = d && e.now ? tx(e.now(d)) : null;
  const desc = e.sample ? descFor(e.sample) : null;
  const what = e.what ? esc(tx(e.what)) : (desc ? descBodyHtml(desc) : "");
  $("inspBody").innerHTML = (sentence ? `<b>${esc(sentence)}</b> ` : "") + what;
  $("inspRows").innerHTML = !d || !e.rows ? "" : e.rows
    .map((sel) => pickRow(sel))
    .filter((r, i, a) => r && a.indexOf(r) === i)     // a regex may hit a row an earlier one took
    .map((r) => `<div class="inspect-row"><span>${esc(r.label)}</span><span>${esc(inspVal(r))}</span></div>`)
    .join("");
}

// Name every schematic hit target from its INSPECT entry. An SVG <title> is BOTH the native hover
// tooltip and the element's accessible name, so pointer users, keyboard users and screen readers all
// get the same wording out of the one copy source — and the markup carries no duplicated English.
function labelSchematicHits() {
  const SVGNS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("#schem [data-insp]").forEach((el) => {
    const e = INSPECT[el.dataset.insp];
    if (!e) return;
    const name = tx(e.t);
    el.setAttribute("aria-label", name);
    const ttl = document.createElementNS(SVGNS, "title");
    ttl.textContent = name;
    el.insertBefore(ttl, el.firstChild);
  });
  $("inspClose").setAttribute("aria-label", t("insp.close"));
}

// Tap a hit target: select it, or close it when it is already open (tapping the same thing twice is
// the natural "done reading" gesture, and there is no other close on touch besides the ✕).
function inspectPick(key) {
  const opening = S.insp !== key;
  S.insp = opening ? key : null;
  renderInspect();
  if (opening) $("inspCard").scrollIntoView({ block: "nearest", inline: "nearest" });
}

// ── WiFi (edit modal) ──────────────────────────────────────────────────────
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

// ── MQTT (edit modal) ─────────────────────────────────────────────────────
// The MQTT broker is edited in a modal opened from the Connections tile's MQTT row pencil. Only
// the broker prefills (user/pass aren't exposed by /status); a Save reboots to apply (saveReboot),
// Cancel/backdrop/Esc dismiss without a write.
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

// ── Syslog (edit modal) ────────────────────────────────────────────────────
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

// ── NTP (edit modal) ───────────────────────────────────────────────────────
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

// ── Board hardware (dashboard edit modal) ───────────────────────────────────
// Fills the two pin dropdowns from /status.board.pins_local — a WIDER list than the RX/TX picker's
// pins_avail, because an onboard LED or button legitimately sits on a dedicated-JTAG pad that the
// X10A picker withholds (logic/board_pins.hpp). The pin currently in use is always offered even if
// it has dropped off the list (e.g. a build that switched to Octal flash), so the modal can always
// show what the device is actually doing.
function boardPinOptions(sel, cur, withNone) {
  const pins = Array.isArray(S.status?.board?.pins_local) ? S.status.board.pins_local : [];
  const list = (cur != null && cur >= 0 && !pins.includes(cur)) ? [cur, ...pins].sort((a, b) => a - b) : pins;
  sel.innerHTML = (withNone ? `<option value="-1">${esc(t("board.none"))}</option>` : "") +
    list.map((p) => `<option value="${p}">${p}</option>`).join("");
  sel.value = String(cur != null && cur >= 0 ? cur : -1);
}
// "None" for the LED is expressed as led_gpio = -1, but the TYPE select is what the user picks from
// (None / plain / WS2812) — the pin row and the polarity checkbox only make sense once a type is
// chosen, and "active low" is meaningless for a WS2812 (it encodes "off" as the zero colour, so
// there is no drive level to invert).
function syncBoardFields() {
  const type = +$("bdLedType").value;
  $("bdLedPinRow").hidden = type < 0;
  $("bdLedInvRow").hidden = type !== 0;
  $("bdBtnInvRow").hidden = +$("bdBtnPin").value < 0;
}
function fillBoard() {
  const b = S.status?.board || {};
  const hasLed = b.led_gpio != null && b.led_gpio >= 0;
  $("bdLedType").value = hasLed ? String(b.led_type ?? 0) : "-1";
  boardPinOptions($("bdLedPin"), hasLed ? b.led_gpio : -1, false);
  $("bdLedInv").checked = !!b.led_inverted;
  boardPinOptions($("bdBtnPin"), b.btn_gpio, true);
  $("bdBtnInv").checked = b.btn_active_low !== false;
  syncBoardFields();
}
function openBoard() {
  fillBoard();
  $("bdError").hidden = true;
  $("boardModal").hidden = false;
}
function closeBoard() { $("boardModal").hidden = true; }
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
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || t("toast.rejected"), "err"); return false; }
    if (okMsg) toast(okMsg, "ok");
    return true;
  } catch { toast(t("toast.unreachable"), "err"); return false; }
}

// Picking RX/TX from the dropdown points auto-detection at those pins: reset to "auto" so the next
// poll cycle re-sweeps the chosen pair (+ its swap), then refresh a few times to catch the connect —
// on success the card flips the pins to read-only.
async function onPinPick() {
  const rx = +$("e32Rx").value, tx = +$("e32Tx").value;
  $("e32Rx").blur(); $("e32Tx").blur();
  if (!(await applyLive({ profile: "auto", rx, tx }, t("toast.trying_pins")))) return;
  let n = 0;
  const iv = setInterval(async () => { await refreshStatus(); if (++n >= 5 || S.status?.hp?.connected) clearInterval(iv); }, 1500);
}

// ── Firmware / OTA ───────────────────────────────────────────────────────
// Tapping the version in the header meta line checks for an OTA update, and offers to install one:
// the full /ota/check -> /ota/status -> /ota/update flow is wired below against the device-side
// implementation in ota_update.cpp (manifest check, two-point downgrade gate, signed install, health
// gate). What the device can actually FIND depends on a served manifest.json — CI stages one and
// publishes it to GitHub Pages, gated on the repo being public (docs/FEATURES.md §2); against no feed
// the check honestly reports "up to date" rather than failing.
//
// The whole flow reports INLINE next to that version (#otaStat) rather than through toasts. A
// download takes tens of seconds and ticks a percentage the entire time, which as toasts meant a
// growing stack of near-identical "Downloading… 78%" cards covering the dashboard, each outliving
// the number it carried. Inline, the progress replaces itself in place, next to the version it is
// about, and the page stays readable underneath.

// A ring sized for the 12.5px meta line: 13px, 2px stroke. `indet` (no percentage yet) draws a
// spinning quarter-arc, otherwise the arc is the download's progress. Colour is inherited
// (currentColor), so the .err class recolours the ring and the text together.
function otaRing(pct, indet) {
  const sz = 13, r = 5.2, c = 2 * Math.PI * r, cx = sz / 2;
  const circle = (cls, extra) =>
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="currentColor" stroke-width="2" ${extra}/>`;
  if (indet) {
    return `<svg class="otaspin" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">` +
      circle("", `opacity=".25"`) +
      circle("", `stroke-linecap="round" stroke-dasharray="${(c * 0.25).toFixed(2)} ${c.toFixed(2)}"`) +
      `</svg>`;
  }
  const p = Math.max(0, Math.min(100, +pct || 0));
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" style="transform:rotate(-90deg)">` +
    circle("", `opacity=".25"`) +
    circle("", `stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(2)} ${c.toFixed(2)}"`) +
    `</svg>`;
}

// Write the inline readout. `text` is always plain text set via textContent — the only innerHTML is
// our own ring markup, so a device-supplied /ota/status.message can never reach the DOM as markup.
// Every write bumps otaSeq, which is what makes the delayed clear below safe.
let otaSeq = 0;
function otaInline(text, { ring = false, pct = null, cls = "" } = {}) {
  const el = $("otaStat");
  if (!el) return;
  otaSeq++;
  el.className = "otastat" + (cls ? " " + cls : "");
  el.innerHTML = ring ? otaRing(pct, pct == null) : "";
  if (text) {
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
  }
}
// Clear the readout after a terminal message has had time to be read — but ONLY if nothing has been
// written since. Tapping the version twice inside the linger window (up to date → tap again) would
// otherwise let the FIRST run's pending timer wipe the second run's message a fraction of a second
// after it appeared: a check that looks like it silently did nothing. Sequence-guarded rather than
// otaBusy-guarded, because a terminal message is by definition written after the flow released.
function otaInlineClear(delay = 3500) {
  const mine = otaSeq;
  setTimeout(() => { if (otaSeq === mine) otaInline(""); }, delay);
}

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

// Terminal inline failure: show it, let it linger a beat longer than a success, and release the flow.
function otaFail(text) {
  S.otaBusy = false;
  otaInline(text, { cls: "err" });
  otaInlineClear(6000);
}

async function checkFirmwareUpdate() {
  if (S.otaBusy) return;                                       // a check/download is already running
  if (S.busy) { otaInline(t("ota.busy")); otaInlineClear(); return; }
  S.busy = true; S.otaBusy = true;
  // rebootPoll() clears S.busy itself, asynchronously, once the device answers again — so the exit
  // path must hand ownership over rather than clear the flag on the way out. Clearing it here after
  // starting the poll would re-enable the UI while the device is still rebooting.
  let handedOff = false;
  try {
    otaInline("", { ring: true });                             // checking: spinner only, no label
    try { await j("/ota/check?ms=" + Date.now()); }
    catch { otaFail(t("ota.unreachable")); return; }

    const s = await otaPoll(["checking"], 30);
    if (!s)                  { otaFail(t("ota.timeout")); return; }
    if (s.state === "error") { otaFail(s.message || t("ota.check_failed")); return; }
    if (!s.update_available) {
      S.otaAvail = null; renderHeaderMeta();
      S.otaBusy = false;
      otaInline(t("ota.uptodate")); otaInlineClear();
      return;
    }

    // A version is on offer: record it so the version's tooltip says so, and clear the readout while
    // the modal dialog is up (confirm() blocks, and a stale spinner behind it explains nothing).
    S.otaAvail = s.available || null; renderHeaderMeta();
    otaInline("");
    // The device re-fetches the manifest and re-runs the downgrade gate before downloading, so this
    // prompt is a courtesy, not the safety check — declining here changes nothing on the device.
    if (!confirm(t("ota.confirm", s.current, s.available))) {
      S.otaBusy = false;
      otaInline(t("ota.cancelled")); otaInlineClear();
      return;
    }

    otaInline(t("ota.starting"), { ring: true });
    // fetch resolves for ANY answered status, so a 503 from the shared OOM guard arrives as a
    // perfectly successful promise. Left unchecked it would fall through into the poll below and
    // surface 5 minutes later as "Update timed out" — the wrong diagnosis for a retryable refusal.
    let r;
    try { r = await post("/ota/update", {}); }
    catch { otaFail(t("ota.failed")); return; }
    if (r.status === 503) { otaFail(t("ota.busy")); return; }
    if (!r.ok) { otaFail(await errorOf(r, t("ota.failed"))); return; }

    const done = await otaWatch();
    if (!done)                  { otaFail(t("ota.timeout")); return; }
    if (done.state === "error") { otaFail(done.message || t("ota.failed")); return; }

    // state === "done": the device reboots ~600 ms after reporting it. Wait for it in the background
    // and RELOAD the page — see otaWaitReboot.
    otaInline(t("ota.rebooting"), { ring: true, pct: 100 });
    otaWaitReboot();
    handedOff = true;
  } finally {
    if (!handedOff) S.busy = false;
    if (!handedOff && S.otaBusy) S.otaBusy = false;
  }
}

// Watch a running download to its end, ticking the percentage into the header. Split out of
// checkFirmwareUpdate() so resumeOta() can join a download already in flight — e.g. after a page
// reload mid-update, where otherwise the header would sit silent while the device was busy.
function otaWatch() {
  return otaPoll(["checking", "updating"], 300, (st) => {
    if (st.state === "updating") otaInline(t("ota.pct", st.progress ?? 0), { ring: true, pct: st.progress ?? 0 });
  });
}

// On page load, adopt an update that is already running on the device (a reload during a download,
// or a second browser tab). Silent when nothing is happening — a plain GET that finds `idle` leaves
// the header exactly as it was.
async function resumeOta() {
  let s;
  try { s = await j("/ota/status"); } catch { return; }
  if (!s || (s.state !== "updating" && s.state !== "done")) return;
  if (S.otaBusy) return;
  S.busy = true; S.otaBusy = true;
  let handedOff = false;
  try {
    if (s.state === "updating") otaInline(t("ota.pct", s.progress ?? 0), { ring: true, pct: s.progress ?? 0 });
    const done = s.state === "done" ? s : await otaWatch();
    if (!done)                  { otaFail(t("ota.timeout")); return; }
    if (done.state === "error") { otaFail(done.message || t("ota.failed")); return; }
    otaInline(t("ota.rebooting"), { ring: true, pct: 100 });
    otaWaitReboot();
    handedOff = true;
  } finally {
    if (!handedOff) S.busy = false;
    if (!handedOff && S.otaBusy) S.otaBusy = false;
  }
}

// After "done" the device reboots ~600 ms later — and the page in the browser was served by the OLD
// image, so the UI itself is stale until it is re-fetched. Wait for the board to come back, then
// RELOAD. This is why the OTA path does NOT use rebootPoll() like the config saves do: that one
// re-renders from a fresh /status, which is right when only the DATA changed, and wrong here, where
// the HTML, CSS and this very script are what the update replaced.
//
// Three independent "it rebooted" signals, because no single one is reliable:
//   · version changed — the obvious one, but a same-version reinstall and a health-gate ROLLBACK
//     both come back on the version we started from;
//   · uptime went BACKWARDS — survives both of those, and is the only signal for them;
//   · we saw it go down and come back — misses the case where the first probe lands after the board
//     is already up again.
// Any one of them is enough.
const OTA_REBOOT_WAIT_MS = 120000;   // covers a slow boot AND a health-gate rollback cycle
function otaWaitReboot() {
  const preVer = S.status?.version || "";
  const preUp = typeof S.status?.uptime_s === "number" ? S.status.uptime_s : null;
  const started = Date.now();
  let sawDown = false;

  const probe = async () => {
    // Per-request abort: a socket to a rebooting board can hang for the browser's own (much longer)
    // timeout, which would stall the poll exactly while the interesting transition happens.
    const ctl = "AbortController" in window ? new AbortController() : null;
    const to = ctl ? setTimeout(() => ctl.abort(), 3000) : null;
    let s = null;
    try {
      const r = await fetch("/status?ms=" + Date.now(), { cache: "no-store", signal: ctl?.signal });
      if (!r.ok) throw new Error(r.status);
      s = await r.json();
    } catch {
      sawDown = true;          // unreachable or mid-reboot: expected here, not a failure
    } finally {
      if (to) clearTimeout(to);
    }

    if (s) {
      const rebooted = (preVer && s.version && s.version !== preVer) ||
                       (preUp != null && typeof s.uptime_s === "number" && s.uptime_s < preUp) ||
                       sawDown;
      if (rebooted) { location.reload(); return; }
    }
    if (Date.now() - started <= OTA_REBOOT_WAIT_MS) { setTimeout(probe, 1000); return; }

    // Out of patience. Answering but showing no sign of a reboot: reload anyway — it is harmless and
    // settles the question either way. Never answered at all: a reload would replace the one status
    // line the user has with a browser error page, so keep the message and let them choose when.
    if (s) { location.reload(); return; }
    S.busy = false; S.otaBusy = false;
    otaInline(t("ota.reload_hint"), { cls: "err" });   // no auto-clear: it asks the user to act
  };
  probe();
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
    b.innerHTML = `<span class="spin"></span>${esc(t("btn.saving"))}`;
  } else {
    b.textContent = b.dataset.label || t("btn.save");
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
      toast(t("toast.saved"), "ok");
      then();
    } catch {
      if (tries > 14) { clearInterval(poll); S.busy = false; toast(t("toast.rebooted"), "info"); }
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
  if (S.busy) { toast(t("toast.applying"), "info"); return; }
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
    reject(t("toast.unreachable"));
    return;
  }
  // 503 is the device out of contiguous heap, not a bad field: nothing was written and the same save
  // is worth retrying verbatim, so it gets a toast and no inline field error blaming the input.
  if (r.status === 503) { idle(); toast(t("toast.busy_retry"), "err"); return; }
  if (!r.ok) { reject(await errorOf(r, t("toast.rejected"))); return; }
  const res = await r.json().catch(() => ({}));
  setBusy(btn, false);
  close();
  if (res.reboot === false) { S.busy = false; toast(t("toast.no_changes"), "info"); return; }   // /set_mqtt: unchanged
  toast(t("toast.reboot"), "info");
  rebootPoll(then);   // stays busy until the device answers again (or the poll gives up)
}

// ── Boot ─────────────────────────────────────────────────────────────────
function wire() {
  // Navigation: the gear opens Settings, the back chevron returns to the dashboard.
  $("btnSettings").onclick = () => go("settings");
  $("btnBack").onclick = goBack;
  $("btnBack").setAttribute("aria-label", t("nav.back"));   // the gear's own label is set by renderSettingsDot
  // Esc leaves the same way the chevron does — but only when nothing else has claimed it:
  // every modal and the schematic inspector install their own Esc handler, and one key closing a
  // dialog AND leaving the screen behind it would be a single gesture doing two things.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || S.stage === "dashboard") return;
    if (S.insp || MODALS.some((id) => !$(id).hidden)) return;
    goBack();
  });

  // The firmware version in the header is static DOM (renderHeaderMeta only rewrites its text), so
  // it takes a direct handler rather than the delegation the rebuilt cards need.
  const vl = $("verLink");
  vl.setAttribute("aria-label", t("aria.ota"));
  vl.onclick = checkFirmwareUpdate;

  // The dashboard card grid (#valueGroups) is rebuilt on every poll, so its one interactive control
  // is wired by delegation: tapping a value row (that has a description) expands/collapses its
  // explainer accordion.
  $("valueGroups").addEventListener("click", (e) => {
    const desc = e.target.closest("[data-desc]");
    if (desc) toggleDesc(desc);
  });
  // Schematic inspector: the SVG hit targets are <g> elements, so Enter/Space need handling by hand
  // (a <g role="button"> gets no native activation). Delegated, because the SVG is static DOM.
  $("schem").addEventListener("click", (e) => {
    const hit = e.target.closest("[data-insp]");
    if (hit) inspectPick(hit.dataset.insp);
  });
  $("schem").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = e.target.closest("[data-insp]");
    if (!hit) return;
    e.preventDefault();          // Space would otherwise scroll the page
    inspectPick(hit.dataset.insp);
  });
  $("inspClose").onclick = () => { S.insp = null; renderInspect(); };

  // The ESP32 card (#settingsCards) is rebuilt every poll too, so its controls are delegated as
  // well: the Hardware row opens the board modal, and the RX/TX dropdowns re-run pin auto-detection
  // on change. (The OTA check is not here — it hangs off the version in the dashboard header.)
  $("settingsCards").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "board") openBoard();
  });
  $("settingsCards").addEventListener("change", (e) => {
    if (e.target.id === "e32Rx" || e.target.id === "e32Tx") onPinPick();
  });
  // The Connections tile (#connTile) is rebuilt every poll too — each row's pencil opens its own
  // edit modal (WiFi/MQTT/Syslog/NTP), delegated the same way.
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.insp) { S.insp = null; renderInspect(); } });
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
    if (!valid) { toast(t("toast.check_wifi"), "err"); return; }
    saveReboot("/set_wifi", { ssid, pass }, {
      btn: "wfBtn",
      showError: wifiFieldError,
      close: closeWifi,
      then: renderApp,
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
      $("mqError").textContent = t("mq.err_format");
      $("mqError").hidden = false;
      toast(t("toast.check_broker"), "err");
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
      then: renderApp,
      busyMsg: t("toast.verifying_mqtt"),   // the endpoint pre-flights the broker (DNS→TCP→CONNECT)
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
          $("slError").textContent = t("sl.err_port");
          $("slError").hidden = false;
          toast(t("toast.check_syslog_port"), "err");
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
      then: renderApp,
      busyMsg: t("toast.saving_syslog"),
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
      then: renderApp,
      busyMsg: t("toast.saving_ntp"),
    });
  });

  $("bdCancel").onclick = closeBoard;
  $("boardBackdrop").onclick = closeBoard;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("boardModal").hidden) closeBoard(); });
  $("bdLedType").addEventListener("change", syncBoardFields);
  $("bdBtnPin").addEventListener("change", syncBoardFields);
  $("boardForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = +$("bdLedType").value;
    saveReboot("/set_board", {
      // Type "None" is the wire's led_gpio = -1; the pin select keeps its last value so re-enabling
      // the indicator doesn't make the user find their pin again.
      led_gpio: type < 0 ? -1 : +$("bdLedPin").value,
      led_type: type < 0 ? 0 : type,
      led_inverted: $("bdLedInv").checked,
      btn_gpio: +$("bdBtnPin").value,
      btn_active_low: $("bdBtnInv").checked,
    }, {
      btn: "bdBtn",
      showError: (msg) => { $("bdError").textContent = msg; $("bdError").hidden = false; },
      close: closeBoard,
      then: renderApp,
      busyMsg: t("toast.saving_board"),
    });
  });
}

async function boot() {
  applyStaticI18n();       // localise the static index.html markup (data-i18n) before the first render
  labelSchematicHits();    // name the clickable schematic parts from the INSPECT table
  wire();
  go("dashboard");         // the app always opens on the dashboard (and this syncs the header to it)
  resumeOta();             // adopt a download already running (reload mid-update / second tab)

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
            renderApp();
          } else if (r.type === "values") {
            S._values = r.values;
            renderApp();
          } else if (Array.isArray(r.values)) {
            // Defensive only: every frame the firmware sends today is typed (http_status.cpp sends
            // "status"/"values" for both the live pushes and the "sub" snapshot), so this branch is
            // for a future/renamed frame that still carries a values array. The old fallback was
            // `r.values || r || []`, which assigned the frame OBJECT itself for anything without a
            // values key — every later pickValue()/faultValue() then ran .find/.filter on a non-array
            // and threw. Accept only an actual values array; drop unknown frames and keep the last
            // good values on screen.
            S._values = r.values;
            renderApp();
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
