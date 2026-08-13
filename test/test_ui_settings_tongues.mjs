// Dynamic-control rows use the real production renderer. Every label owns a collapsible information
// tongue, while only the compact room/weather values on the right open editors. This guards the
// split-action contract, source status presentation and all configured/unconfigured use-cases.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js"]);
const labels = {
  "dyn.state": "Status",
  "dyn.state_recording": "Zeichnet auf",
  "dyn.state_recording_nowx": "Zeichnet auf · ohne Prognose",
  "dyn.state_waiting": "Wartet auf Heizbetrieb",
  "dyn.state_room": "Raumeingang fehlt",
  "dyn.state_x10a": "X10A offline",
  "dyn.state_homehub": "HomeHub offline",
  "dyn.state_gate": "Anlagenzustand unbekannt",
  "dyn.state_clock": "Uhrzeit nicht gesetzt",
  "dyn.state_blocked": "Zeichnet nicht auf",
  "dyn.state_help_recording": "Aufzeichnung laeuft",
  "dyn.state_help_waiting": "Anlage heizt nicht",
  "dyn.state_help_blocked": "Eingang fehlt",
  "dyn.room_source": "Raumtemperaturquelle",
  "dyn.weather": "Wetterprognose",
  "dyn.strategy": "Verfahren",
  "dyn.shadow_strategy": "Rohe Raumabweichung · 30 min",
  "dyn.inactive": "Nicht aktiv",
  "dyn.strategy_help": "Raum-Sollwert minus Ist-Raumtemperatur: positiv bedeutet zu kalt.",
  "dyn.card": "Heizkurven-Diagnose",
  "dyn.not_configured": "Nicht konfiguriert",
  "dyn.outdoor": "Gemessene Außenluft",
  "dyn.outdoor_detail_status": "Status",
  "dyn.outdoor_detail_now": "Aktueller Messwert",
  "dyn.outdoor_detail_sample": "Beim letzten aufgezeichneten Ereignis",
  "dyn.outdoor_status_live": "{0}-Messwert aktuell, wird mitaufgezeichnet.",
  "dyn.outdoor_status_unavailable": "{0} eingerichtet, aber kein aktueller Messwert erreicht die Aufzeichnung.",
  "dyn.outdoor_status_absent": "{0} nicht eingerichtet. Ereignisse werden ohne Außenwert aufgezeichnet.",
  "dyn.outdoor_sample_none": "Ohne Außenwert aufgezeichnet",
  "dyn.outdoor_help_axis": "Aussenachse macht die Raumabweichung lesbar.",
  "dyn.outdoor_help_placement": "Was der Sensor dort misst, wo er haengt.",
  "dyn.outdoor_help_setup": "Ein M5Stack ENV III am Grove-Port kann diesen Wert liefern.",
  "dyn.plant_outdoor": "Außenluft der Anlage",
  "dyn.plant_outdoor_help": "HomeHub-Eingang 44 bleibt von ENV III getrennt und ändert keine Aufzeichnung.",
  "board.title": "Board-Hardware",
  "dyn.input_error": "Eingabefehler",
  "ref.title": "Raumtemperaturquelle",
  "ref.ago": "vor {0} s",
  "ref.now": "jetzt",
  "ref.waiting": "Warte auf Daten",
  "ref.stale": "veraltet",
  "ref.error": "Fehler",
  "ref.broker_off": "MQTT-Broker deaktiviert",
  "ref.retained": "vom Broker gespeichert",
  "ref.time_untrusted": "Retained-Wert ohne vertrauenswürdige Messzeit",
  "ref.clock_unsynced": "Geräteuhr nicht synchronisiert",
  "ref.age_unknown": "unbekannt",
  "ref.detail.status_label": "Status:",
  "ref.status.not_configured": "Nicht eingerichtet",
  "ref.status.usable": "Verwendbar",
  "ref.status.unusable": "Nicht verwendbar",
  "ref.status.error": "Fehler",
  "ref.status.stale": "Veraltet",
  "ref.status.waiting": "Wartet",
  "ref.status.unavailable": "Nicht verfügbar",
  "ref.detail.setup": "MQTT-Quelle über den Stift hinzufügen",
  "ref.detail.stale": "Messwert ist älter als zulässig",
  "ref.detail.waiting": "Noch keinen MQTT-Messwert empfangen",
  "ref.detail.error": "MQTT-Nachricht verworfen: bad payload",
  "ref.detail.temperature_label": "Raumtemperatur:",
  "ref.detail.temperature": "{0} °C",
  "ref.detail.setpoint_label": "Solltemperatur:",
  "ref.detail.setpoint": "{0} °C",
  "ref.detail.last_measurement_label": "Letzter Messwert:",
  "ref.detail.last_measurement": "{0}",
  "ref.detail.last_measurement_stale": "{0} · zulässig: höchstens {1} s",
  "ref.detail.purpose": "Die Diagnose vergleicht Raum- und Solltemperatur, um langfristig zu erkennen, ob die Heizkurve zu hoch oder zu niedrig liegt. Die Wärmepumpe wird nicht gesteuert.",
  "wx.title": "Wetterprognose",
  "wx.fetching": "Wird geladen",
  "wx.waiting": "Warte auf Daten",
  "wx.error": "Fehler",
  "wx.detail.status": "Status:",
  "wx.status.fresh": "Aktuell",
  "wx.status.fetching": "Aktualisierung läuft",
  "wx.status.stale": "Veraltet",
  "wx.status.unavailable": "Nicht verfügbar",
  "wx.status.waiting": "Wartet",
  "wx.detail.fresh": "Die Prognose wurde erfolgreich abgerufen.",
  "wx.detail.fetching": "Der ESP32 ruft gerade neue Prognosedaten ab.",
  "wx.detail.stale": "Der letzte erfolgreiche Abruf ist zu alt; die Werte werden nur zur Diagnose angezeigt.",
  "wx.detail.unavailable": "Der letzte Abruf ist fehlgeschlagen; ein älterer Wert wird, falls vorhanden, nur zur Diagnose angezeigt.",
  "wx.detail.waiting": "Es wurde noch keine Prognose empfangen.",
  "wx.detail.temperature_label": "Temperatur:",
  "wx.detail.temperature": "{0} °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden.",
  "wx.detail.solar_label": "Globalstrahlung:",
  "wx.detail.solar": "{0} Wh/m² ist die prognostizierte Globalstrahlung auf eine horizontale Fläche im selben Zweistundenzeitraum.",
  "wx.detail.source_label": "Quelle:",
  "wx.detail.source": "Open-Meteo · DWD ICON Seamless. Nur Beobachtung; die Prognose verändert die Wärmepumpensteuerung nicht.",
  "wx.hint.configured": "Wetter-Konfiguration",
  "wx.hint.setup": "Wetter-Einrichtung",
  "env.title": "Außensensor",
  "env.collecting": "Messwerte werden erfasst",
  "env.unavailable": "Sensor nicht erreichbar",
  "card.proto_title": "Protokoll",
  "card.fw_title": "Firmware",
  "card.hplink": "Wärmepumpen-Verbindung",
  "card.online": "Online",
  "card.offline": "Offline",
  "card.protocol": "Protokoll",
  "card.rxpin": "RX-Pin",
  "card.txpin": "TX-Pin",
  "card.firmware": "Version",
  "card.channel": "Update-Kanal",
  "card.language": "Sprache",
  "card.hplink_help": "Verbindungs-Erklärung",
  "card.protocol_help": "Protokoll-Erklärung",
  "card.rxpin_help": "RX-Erklärung",
  "card.txpin_help": "TX-Erklärung",
  "card.firmware_help": "Firmware-Erklärung",
  "card.channel_help": "Kanal-Erklärung",
  "card.language_help": "Sprach-Erklärung",
  "card.hardware": "Hardware",
  "card.uptime": "Laufzeit",
  "card.freeheap": "Freier Speicher",
  "card.maxalloc": "Größter Block",
  "chan.release": "Release",
  "chan.dev": "Development",
  "lang.auto": "Browser",
  "lang.de": "Deutsch",
  "lang.en": "English",
  "dyn.card_help": "Diagnose-Erklärung",
  "dyn.state_help_setup": "Einrichtungs-Erklärung",
  "dyn.state_setup_homehub": "HomeHub nicht eingerichtet",
  "dyn.state_help_setup_homehub": "HomeHub-Erklärung",
  "dyn.state_setup_both": "Noch nicht eingerichtet",
  "dyn.state_setup_room": "Raumquelle einrichten",
  "dyn.state_setup_weather": "Standort einrichten",
  "dyn.room_off": "Raumthermostat ausgeschaltet",
  "dyn.room_invalid_payload": "Ungültige MQTT-Nachricht",
  "dyn.state_help_room": "Raumblock-Erklärung",
  "aria.ota": "Nach Firmware-Updates suchen",
  "ota.title_check": "Nach Updates suchen",
  "settings.diagnostics": "Anlagendiagnose",
  "circ.title": "Quelle der Zirkulationspumpe",
  "circ.row": "Warmwasser-Zirkulationspumpe",
  "circ.not_configured": "Nicht konfiguriert",
  "circ.unavailable": "Nicht verfügbar",
  "circ.running": "Läuft",
  "circ.stopped": "Steht",
  "circ.checking": "Prüft",
  "circ.stale": "Veraltet",
  "circ.waiting": "Warte auf Nachricht",
  "circ.detail.source": "Quelle",
  "circ.detail.power": "Wirkleistung",
  "circ.detail.state": "Erkannter Zustand",
  "circ.detail.age": "Alter des Messwerts",
  "circ.settings_help": "Nur lesende Pumpendiagnose.",
};
const t = (key, ...args) => (labels[key] || key).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const S = { status: {}, descOpen: new Set() };
const descNoteHtml = (lead, text) =>
  `<div class="vdesc-p"><span class="vdesc-n">${esc(lead)}</span> ${esc(text)}</div>`;
const sandbox = vm.createContext({
  S, LANG: "de", t, esc, descNoteHtml, setTimeout, clearTimeout,
  MODEL_DESCRIPTIONS: {}, hasHist: () => false, checkupDuration: (seconds) => `${seconds} s`,
  histHtml: () => `<div class="vhist vhist-state">TIMELINE</div>`,
});
vm.runInContext(`${source}\nthis.__renderDynamic = dynamicControlCardHtml; this.__renderEsp32 = esp32CardHtml; this.__renderCirculation = circulationSettingsCardHtml;`, sandbox,
  { filename: "main/www/js/dashboard.js" });

S.status = {
  mqtt: { configured: true },
  modbus: { enabled: true, connected: true },
  reference_temperature: {
    configured: true, name: "Example rm", has_value: true, temperature_c: 25.1,
    has_setpoint: true, setpoint_c: 22.0, age_s: 17, fresh: true, control_eligible: true,
  },
  weather_forecast: {
    configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
    solar_energy_2h_wh_m2: 0, fresh: true,
  },
  heating_curve: { method_version: 2, armed: true, state: "hold", reason: "plant_inactive",
    plant_outdoor_temperature_c: 9.14, plant_outdoor_source: "homehub",
    last_sample_room_error_k: 0.4, last_sample_plant_outdoor_temperature_c: 8.75,
    last_sample_plant_outdoor_source: "homehub" },
  env3: {
    supported: true, enabled: true, fresh: true,
    temperature_c: 20.2, humidity_pct: 46, pressure_hpa: 1009,
  },
  circulation_source: {
    configured: true, name: "Example pump model", has_value: true, fresh: true,
    power_w: 4.2, age_s: 17, state: "on",
  },
};
let circulationHtml = sandbox.__renderCirculation();
let circulationButton = circulationHtml.match(/<button[^>]*data-act="circulation"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(circulationButton, /<span>Example pump model<\/span>/,
  "the editable row header must identify the configured pump");
// The VISIBLE face keeps the pump's name — the status must not take its place. It is scoped to the
// span rather than the whole button on purpose: the row now states its condition in COLOUR too, and
// DESIGN.md §9 requires a colour-only face to spell that condition out in its accessible name (the
// room-source row above does exactly this). Asserting over the entire button conflated "the visible
// text was replaced" with "the screen reader was told", and only the first is the rule.
assert.doesNotMatch(circulationButton.match(/<span>[\s\S]*?<\/span>/)?.[0] || "",
  /Läuft|Steht|Prüft|Nicht verfügbar/,
  "the moment status belongs to the diagnostic tongue, not in place of the pump name");
assert.match(circulationButton, /aria-label="[^"]*Example pump model · Läuft"/,
  "a row whose face carries its condition in colour must say that condition in its accessible name");
let circulationTongue = circulationHtml.match(/id="diagnostics-circulation-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(circulationTongue, /<span class="vdesc-n">Erkannter Zustand<\/span> Läuft/);
assert.match(circulationTongue, /<div class="vhist vhist-state">TIMELINE/,
  "the current assessment and its categorical history must share the information tongue");

S.status.circulation_source = {
  configured: true, name: "Example pump model", has_value: false, error: "timeout",
};
circulationHtml = sandbox.__renderCirculation();
circulationButton = circulationHtml.match(/<button[^>]*data-act="circulation"[\s\S]*?<\/button>/)?.[0] || "";
circulationTongue = circulationHtml.match(/id="diagnostics-circulation-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.match(circulationButton, /Example pump model/,
  "an MQTT outage must not replace the configured pump identity in the row header");
assert.match(circulationTongue, /<span class="vdesc-n">Erkannter Zustand<\/span> Nicht verfügbar/,
  "an unavailable source without a power sample must still expose its current status inside");

let html = sandbox.__renderDynamic();
assert.doesNotMatch(html, /section-badge|Experimentell/,
  "the enabled bottom card must not carry an experimental pill");
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 6,
  "all six diagnosis rows must render an information tongue");
// The idle-plant state is the reading a user sees for months. It must say what it means and must
// not be styled as a fault, or the row becomes noise exactly when it is the only thing to read.
assert.match(html, /Wartet auf Heizbetrieb/,
  "an idle plant must be named, not reported as an error");
assert.ok(html.indexOf("Diagnose-Erklärung") < html.indexOf("Anlage heizt nicht"),
  "the state tongue must say what the diagnosis IS before what it is doing right now");
assert.doesNotMatch(html, /Wartet auf Heizbetrieb<\/span>[\s\S]{0,40}(warn|err)/,
  "the idle-plant state must not carry a warning class");
assert.doesNotMatch(html, /Betriebsart|Sicherheit & Ausgabe|Nur lesend/,
  "the duplicate mode row and the constant read-only row must be gone");
assert.match(html, /Raum-Sollwert minus Ist-Raumtemperatur: positiv bedeutet zu kalt/,
  "the method tongue must pin the canonical room-error sign");
// The optional outdoor axis, in all three states it can be in. The number always comes from the
// DIAGNOSIS, never from /status.env3 read a second time — those disagree exactly when the sensor is
// live but the sampler is not evaluating, and a green reading beside a blocked state row is the
// mistake the room-source row already documents.
//
// The FACE names the SENSOR, like every other source row on this card, and is PASSIVE: the ENV III
// has exactly one editor (the Board Hardware modal on the ESP32 card, which saves it atomically
// beside the board identity that decides whether the Grove port exists), and this row used to be a
// second door into it — a configuration action offered from a card that reports evidence.
//
// The match runs to the TONGUE, never to the first </button>. A row that regains a configuration
// action becomes a SPLIT row whose first </button> closes the info toggle, so a face stopping there
// contains neither the value nor the `data-act` — and the no-editor guard below would pass on
// exactly the change it exists to catch.
const outdoorFace = (h) =>
  h.match(/data-desc="dynamic:outdoor"[\s\S]*?<div class="vdesc">/)?.[0] || "";
const fixtureEnv3 = S.status.env3;
const fixtureCurve = S.status.heating_curve;
assert.match(html, /Gemessene Außenluft/,
  "the row must distinguish a MEASURED outdoor value from the forecast row beside it");
assert.notEqual(html.indexOf("Gemessene Außenluft"), html.indexOf("Wetterprognose"),
  "the measured axis and the forecast must be two distinct rows");
const plantFace = (h) =>
  h.match(/data-desc="dynamic:plant-outdoor"[\s\S]*?<div class="vdesc">/)?.[0] || "";
assert.match(html, /Außenluft der Anlage/,
  "the plant axis must remain visibly separate from ENV III");
assert.match(plantFace(html), /HomeHub/,
  "the plant-axis face must name its source");
assert.match(html, /Aktueller Messwert<\/span> 9,1 °C · HomeHub/,
  "the current plant value must carry provenance inside the tongue");
assert.match(html, /Beim letzten aufgezeichneten Ereignis<\/span> 8,8 °C · HomeHub/,
  "the event-time plant value must carry independent provenance");
assert.doesNotMatch(plantFace(html), /data-act=/,
  "plant evidence is a passive row, not another HomeHub editor");

// (a) sensor live, but nothing has reached the recorder: warn, and the tongue explains the gap
// rather than letting the reader assume the sensor is broken. The face names the SENSOR in every
// set-up state — the colour carries the condition and the tongue says it in words, so the header
// stays the stable identity a reader recognises rather than flipping to "no value".
assert.match(outdoorFace(html), /ENV III/,
  "a set-up sensor is named on the face, exactly as the room source and Open-Meteo are");
assert.match(outdoorFace(html), /vrow-val settings-wrap warn/,
  "a CONFIGURED sensor whose value never arrives is worth a warning");
assert.match(html, /ENV III eingerichtet, aber kein aktueller Messwert erreicht die Aufzeichnung\./);
// The row must not be an editor. The ENV III has ONE editor, the Board Hardware modal, which saves
// it atomically beside the board identity deciding whether the Grove port exists at all.
assert.doesNotMatch(outdoorFace(html), /data-act=|dynamic-config-open/,
  "the outdoor axis must not offer a second door into the Board Hardware modal");

// (b) no sensor at all: DIM, never warn — the axis gates no sampling, so its absence is not a
// fault, the same rule that keeps the summer idle-plant state unstyled.
S.status.env3 = {};
let outdoorHtml = sandbox.__renderDynamic();
assert.match(outdoorFace(outdoorHtml), /Nicht konfiguriert/);
assert.match(outdoorFace(outdoorHtml), /vrow-val settings-wrap dim/,
  "an absent OPTIONAL axis must be dim, never warn or err");
assert.match(outdoorHtml, /Ereignisse werden ohne Außenwert aufgezeichnet\./,
  "the tongue must state that recording continues without the outdoor value");
assert.match(outdoorHtml, /Ein M5Stack ENV III am Grove-Port kann diesen Wert liefern\./,
  "an unconfigured axis must say how to supply one");

// (c) a live value, and an EVENT recorded without one. The event's own value is the durable half,
// so it is stated separately from the live reading instead of the live number standing in for it.
S.status.env3 = { supported: true, enabled: true, fresh: true, temperature_c: -4.2 };
S.status.heating_curve = {
  method_version: 2, armed: true, state: "hold", reason: "plant_inactive",
  outdoor_temperature_c: -4.25, last_sample_room_error_k: 0.4,
};
outdoorHtml = sandbox.__renderDynamic();
assert.match(outdoorHtml, /Aktueller Messwert<\/span> −4,3\u00a0°C|Aktueller Messwert<\/span> -4,3\u00a0°C/,
  "the live axis prints the DIAGNOSIS value in the German locale, inside the tongue");
assert.match(outdoorFace(outdoorHtml), /ENV III/,
  "the face keeps naming the sensor once a reading arrives; the reading is stated inside");
assert.match(outdoorFace(outdoorHtml), /vrow-val settings-wrap ok/);
assert.match(outdoorHtml, /Ohne Außenwert aufgezeichnet/,
  "an event recorded without the axis must say so rather than borrow the live reading");
S.status.heating_curve.last_sample_outdoor_temperature_c = -6.5;
outdoorHtml = sandbox.__renderDynamic();
assert.match(outdoorHtml, /Beim letzten aufgezeichneten Ereignis<\/span> −6,5\u00a0°C|Beim letzten aufgezeichneten Ereignis<\/span> -6,5\u00a0°C/,
  "the recorded event keeps its own outdoor value, distinct from the live one");
// (d) THE SHAPE THE DEVICE ACTUALLY SENDS. /status emits explicit `null` for every absent figure,
// and `Number(null)` is 0 — which `Number.isFinite` accepts. Read that way an installation with no
// recorded event yet printed "0,0 °C" as the temperature of an event that never happened. A fixture
// that merely OMITS the keys cannot see this: undefined becomes NaN and is rejected correctly.
S.status.env3 = { supported: true, enabled: true, fresh: true, temperature_c: 22.24 };
S.status.heating_curve = {
  method_version: 2, armed: true, state: "hold", reason: "plant_inactive",
  outdoor_temperature_c: 22.236, last_sample_outdoor_temperature_c: null,
  last_sample_room_error_k: null, last_sample_unix_s: null, samples: 0, sequence: 0,
};
outdoorHtml = sandbox.__renderDynamic();
assert.match(outdoorHtml, /Aktueller Messwert<\/span> 22,2\u00a0°C/,
  "a live axis still prints while no event has been recorded");
assert.match(outdoorFace(outdoorHtml), /ENV III/);
assert.doesNotMatch(outdoorHtml, /Beim letzten aufgezeichneten Ereignis/,
  "with no recorded event there is nothing to state about one — null must not read as 0.0 °C");
assert.doesNotMatch(outdoorHtml, /0,0\u00a0°C/,
  "an absent figure must never be rendered as a real zero reading");

S.status.env3 = fixtureEnv3;
S.status.heating_curve = fixtureCurve;

for (const key of ["state", "room-sources", "weather", "plant-outdoor", "outdoor", "strategy"]) {
  const infoButton = html.match(new RegExp(`<button class="[^"]*(?:settings-split-info|settings-whole-info-row)[^"]*"[^>]*data-desc="dynamic:${key}"[\\s\\S]*?<\\/button>`))?.[0] || "";
  assert.match(infoButton, /aria-expanded="false"/,
    `${key} label must be a closed explanation action on first render`);
  assert.doesNotMatch(infoButton, /data-act=/,
    `${key} label must never open a configuration popup`);
}
for (const key of ["state", "plant-outdoor", "outdoor", "strategy"]) {
  assert.match(html, new RegExp(`<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="dynamic:${key}"[\\s\\S]*class="settings-info-value`),
    `${key} has no second action, so its label and value must share one full-row accordion button`);
}
// A row's value is a popup action exactly when THIS card owns the editor for it — the room source
// and the forecast location are configured here and nowhere else. The ENV III is not: its editor is
// the Board Hardware modal on the ESP32 card, which saves it atomically beside the board identity
// deciding whether the Grove port exists, so this row reports it and links nowhere. The reported
// rows (state, axis, method) all stay passive, which is the assertion below.
assert.equal((html.match(/class="settings-split-action dynamic-config-open/g) || []).length, 2,
  "only the two sources this card owns may be popup actions; the reported rows may not");
assert.equal((html.match(/class="settings-info-value/g) || []).length, 4,
  "state, both outdoor axes and method values must stay passive inside full-row accordion buttons");
assert.doesNotMatch(html, /settings-source-summary|Konfiguriert · 25,1 °C|Open-Meteo · 22,6 °C \/ 2 h/,
  "obsolete green summary lines must not duplicate values inside the tongues");
const roomTongue = html.match(/<div class="vdesc-body settings-info-tongue" id="dynamic-room-sources-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((roomTongue.match(/class="vdesc-p"/g) || []).length, 5,
  "a healthy room tongue needs its verdict, values, latest-reading time and one purpose paragraph");
assert.match(roomTongue, /<span class="vdesc-n">Status:<\/span> Verwendbar/);
assert.match(roomTongue, /<span class="vdesc-n">Raumtemperatur:<\/span> 25,1 °C/);
assert.match(roomTongue, /<span class="vdesc-n">Solltemperatur:<\/span> 22 °C/);
assert.match(roomTongue, /<span class="vdesc-n">Letzter Messwert:<\/span> vor 17 s/);
assert.match(roomTongue, /Letzter Messwert:[^]*vergleicht Raum- und Solltemperatur[^]*Heizkurve zu hoch oder zu niedrig[^]*nicht gesteuert/,
  "the purpose and no-control boundary must follow the latest reading");
assert.doesNotMatch(roomTongue, /Konfiguration:|Quelle:|via MQTT|Messwert geprüft|Plausibilitäts-/,
  "the live status must not repeat saved-form state, implementation details or validation prose");
const weatherTongue = html.match(/<div class="vdesc-body settings-info-tongue" id="dynamic-weather-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((weatherTongue.match(/class="vdesc-p"/g) || []).length, 5,
  "the healthy weather tongue must keep four live-evidence paragraphs plus its configuration help");
assert.match(weatherTongue, /<span class="vdesc-n">Status:<\/span> Aktuell — Die Prognose wurde erfolgreich abgerufen\./,
  "weather must explain its freshness instead of presenting an unexplained green line");
assert.match(weatherTongue, /<span class="vdesc-n">Temperatur:<\/span> 22,6 °C ist die mittlere prognostizierte Außenlufttemperatur für die nächsten zwei vollständigen Stunden\./,
  "weather must define the displayed two-hour temperature mean");
assert.match(weatherTongue, /<span class="vdesc-n">Globalstrahlung:<\/span> 0 Wh\/m² ist die prognostizierte Globalstrahlung auf eine horizontale Fläche im selben Zweistundenzeitraum\./,
  "weather must define the accumulated global horizontal irradiation, including a valid zero");
assert.match(weatherTongue, /<span class="vdesc-n">Quelle:<\/span> Open-Meteo · DWD ICON Seamless\. Nur Beobachtung; die Prognose verändert die Wärmepumpensteuerung nicht\./,
  "weather must state provenance and its observation-only boundary");
assert.match(weatherTongue, /Wetter-Konfiguration/,
  "configured weather guidance must remain in the tongue");
assert.doesNotMatch(weatherTongue, /Wetter-Einrichtung/,
  "configured weather must not repeat coordinate-entry guidance");
const roomButton = html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(roomButton, /<span>Example rm<\/span>/,
  "the compact room-source value must name the configured source, like the circulation row");
assert.doesNotMatch(roomButton, /<span>Konfiguriert<\/span>/,
  "the configuration state belongs in the tongue, not in place of the source name");
// DESIGN.md §9/§5.6: a row whose face is a NAME states its condition in colour, which is allowed
// only because the accessible name says it in words. Dropping the state word from BOTH would make
// this the one row a screen-reader or colourblind user cannot read the status of.
assert.match(roomButton, /aria-label="Raumtemperaturquelle: Example rm · Verwendbar"/,
  "the accessible name must spell out the status the colour is carrying");
assert.doesNotMatch(html, /1 Quelle|Raumtemperaturquellen/,
  "the single room-temperature input must not be presented as a source count or plural collection");
assert.doesNotMatch(roomButton, /25,1 °C|vor 17 s/,
  "the configured reading must no longer be duplicated inside the editable header");
const weatherButton = html.match(/<button[^>]*data-act="weather"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(weatherButton, /<span>Open-Meteo<\/span>/,
  "the compact weather-provider value must be the popup action");
for (const explanation of ["Anlage heizt nicht", "Wetter-Konfiguration",
                           "Raum-Sollwert minus Ist-Raumtemperatur: positiv bedeutet zu kalt."])
  assert.ok(html.includes(explanation), `dynamic explanation tongue must include: ${explanation}`);

S.descOpen.add("dynamic:strategy");
html = sandbox.__renderDynamic();
assert.match(html, /class="vitem open settings-info-item dynamic-info-item"[\s\S]*data-desc="dynamic:strategy"[^>]*aria-expanded="true"/,
  "an opened dynamic explanation must persist across status-driven rebuilds");
S.descOpen.clear();

S.status.reference_temperature = {};
S.status.weather_forecast = {};
S.status.env3 = {};
html = sandbox.__renderDynamic();
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 6,
  "unconfigured sources must retain their explanation tongues");
assert.equal((html.match(/<span>Nicht konfiguriert<\/span>/g) || []).length, 2,
  "each empty editable source must expose Not configured as its popup value");
assert.match(html, /data-desc="dynamic:outdoor"[\s\S]*?class="settings-info-value[^"]*">Nicht konfiguriert<\/span>/,
  "the outdoor axis says the same thing PASSIVELY — it reports the sensor, it does not edit it");
assert.ok(html.includes("Wetter-Einrichtung"),
  "the unconfigured weather source must still explain its setup");
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht eingerichtet — MQTT-Quelle über den Stift hinzufügen/,
  "an empty room source needs one actionable status line, not a generic MQTT manual");
assert.doesNotMatch(html, /Wetter-Konfiguration/,
  "unconfigured weather must show setup guidance instead of configured-source guidance");

S.status.reference_temperature = { configured: true, error: "bad payload" };
S.status.weather_forecast = { configured: true, fetching: true };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Aktualisierung läuft — Der ESP32 ruft gerade neue Prognosedaten ab\./,
  "a configured weather fetch must keep the tongue and explain the in-progress state");
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Status:<\/span> Fehler — MQTT-Nachricht verworfen: bad payload/,
  "a configured source error must be explained in its tongue");
// The name is cosmetic and may be empty. The row header still has to identify SOMETHING even though
// implementation-level source prose no longer belongs in the live status tongue.
assert.match(html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "",
  /<span>MQTT<\/span>/,
  "a configured source saved without a name must retain one stable row identity");
assert.doesNotMatch(html, /data-act="env3"|dynamic-env3-status/,
  "ENV III configuration must live exclusively in Board Hardware");

// The room-source tongue has one dominant status vocabulary. These are the reachable transport,
// arrival and freshness states around the healthy/unusable cases above; none may fall back to the
// former generic setup paragraph or claim a stale packet is current.
S.status.mqtt = { configured: false };
S.status.reference_temperature = { configured: true, name: "Example rm", has_value: false };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — MQTT-Broker deaktiviert/);
assert.match(html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "", /\berr\b/,
  "a saved MQTT source cannot be available while the broker is disabled");

S.status.mqtt = { configured: true };
S.status.reference_temperature = { configured: true, name: "Example rm", has_value: false };
html = sandbox.__renderDynamic();
assert.match(html, /Status:<\/span> Wartet — Noch keinen MQTT-Messwert empfangen/);

S.status.reference_temperature = {
  configured: true, name: "Example rm", has_value: true, temperature_c: 24,
  has_setpoint: true, setpoint_c: 22, age_s: 601, max_age_s: 600,
  fresh: false, freshness_reason: "stale", control_eligible: false, reason: "stale",
};
html = sandbox.__renderDynamic();
assert.match(html, /Status:<\/span> Veraltet — Messwert ist älter als zulässig/);
assert.match(html, /Letzter Messwert:<\/span> vor 601 s · zulässig: höchstens 600 s/,
  "only a stale reading needs its configured age limit next to the actual age");

S.status.reference_temperature = {
  configured: true, name: "Example rm", has_value: true, temperature_c: 24,
  has_setpoint: true, setpoint_c: 22, age_s: null, fresh: false,
  freshness_reason: "retained_without_timestamp", control_eligible: false,
  reason: "retained_without_timestamp",
};
html = sandbox.__renderDynamic();
assert.match(html, /Status:<\/span> Nicht verwendbar — Retained-Wert ohne vertrauenswürdige Messzeit/,
  "a retained value without source time must fail closed with its specific reason");

S.status.weather_forecast = {
  configured: true, has_value: true, outdoor_mean_2h_c: -3.2,
  solar_energy_2h_wh_m2: 18, fresh: false,
};
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Veraltet — Der letzte erfolgreiche Abruf ist zu alt;/,
  "a stale forecast must identify retained values as diagnostic rather than current");
assert.match(html, /<span class="vdesc-n">Temperatur:<\/span> -3,2 °C/,
  "a stale forecast must keep its last values visible for diagnosis");

S.status.weather_forecast = { configured: true, has_value: false, error: "timeout" };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — Der letzte Abruf ist fehlgeschlagen;/,
  "a failed forecast must explain its unavailable state");
assert.doesNotMatch(html, /<span class="vdesc-n">Temperatur:<\/span>|<span class="vdesc-n">Sonnenenergie:<\/span>/,
  "an unavailable forecast without a sample must not invent value explanations");

// UNCONFIGURED IS STILL A RENDERED CARD. This is where the required room source and the optional
// forecast are configured, so hiding it until setup would leave nowhere to configure them.
S.status.heating_curve = { method_version: 2, armed: false, state: "off", reason: "disabled" };
S.status.reference_temperature = {};
S.status.weather_forecast = {};
html = sandbox.__renderDynamic();
assert.notEqual(html, "", "the card must render even with nothing configured yet");
assert.match(html, /Raumquelle einrichten/, "an unset-up diagnosis must name its required source");
assert.doesNotMatch(html, /Raumquelle einrichten<\/span>[\s\S]{0,40}(warn|err)/,
  "a setup step must not be styled as a fault");
assert.match(html, /Einrichtungs-Erklärung/, "it must explain what to configure");
S.status.reference_temperature = { configured: true };
S.status.heating_curve = { method_version: 2, armed: true, state: "blocked", reason: "homehub_unavailable" };
html = sandbox.__renderDynamic();
assert.match(html, /HomeHub offline|HomeHub nicht eingerichtet/,
  "forecast must stay optional; after room setup the real missing plant witness is named");
assert.doesNotMatch(html, /Standort einrichten/,
  "a third-party forecast location must never be presented as required for local diagnosis");

// A ROOM SOURCE THAT IS CURRENT BUT UNUSABLE. Through v1.0.0-dev.331 this read "Raumeingang fehlt"
// while the source itself sat green and current two rows below — the state row and the source row
// disagreeing about the same source. Both now state the source's own reason.
S.status.heating_curve = { method_version: 2, armed: true, state: "blocked", reason: "room_unavailable" };
S.status.reference_temperature = {
  configured: true, name: "Example rm", has_value: true, temperature_c: 25.1,
  has_setpoint: true, setpoint_c: 22, age_s: 17, fresh: true,
  control_eligible: false, reason: "disabled",
};
S.status.weather_forecast = {
  configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
  solar_energy_2h_wh_m2: 514, fresh: true,
};
html = sandbox.__renderDynamic();
assert.doesNotMatch(html, /Raumeingang fehlt/,
  "a present, current reading must never be reported as a missing input");
assert.match(html, /Raumthermostat ausgeschaltet/,
  "the blocked state must name the room source's own reason");
const blockedRoomButton = html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(blockedRoomButton, /class="[^"]*\bwarn\b/,
  "the source that is blocking the diagnosis must not be the one row rendered as OK");
assert.match(blockedRoomButton, /aria-label="Raumtemperaturquelle: Example rm · Nicht verwendbar — Raumthermostat ausgeschaltet"/,
  "a current-but-unusable source must name the block in its accessible name, not merely go orange");
assert.match(html, /<span class="vdesc-n">Status:<\/span> Nicht verwendbar — Raumthermostat ausgeschaltet/,
  "the source tongue must give one amber-compatible verdict with the same reason as the state row");
const blockedRoomTongue = html.match(/id="dynamic-room-sources-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.doesNotMatch(blockedRoomTongue, /<span class="vdesc-n">Verwertbar:<\/span>|Aktuell —/,
  "freshness must not appear as a competing positive status on an unusable source");

// Protocol and Firmware use the same info-tongue contract while keeping their independent controls.
S.status = {
  version: "1.0.0-dev.317", pins_avail: [1, 2, 4, 5],
  hp: { connected: true, proto: "I", rx: 2, tx: 1, last_ok_s: 0 },
  ota: { channel: "dev" }, ui: { lang: "auto" }, heating_curve: { method_version: 2, armed: false, state: "off" },
  board: {}, env3: {}, sys: {}, mqtt: {}, reference_temperature: {}, weather_forecast: {},
};
S.descOpen.clear();
html = sandbox.__renderEsp32();
for (const key of ["protocol:link", "protocol:framing", "protocol:rx", "protocol:tx",
                   "firmware:version", "firmware:channel", "firmware:language"]) {
  assert.match(html, new RegExp(`data-desc="${key}"`), `${key} must expose an information tongue`);
}
for (const key of ["link", "framing", "rx", "tx"]) {
  assert.match(html, new RegExp(`<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="protocol:${key}"[\\s\\S]*class="settings-info-value`),
    `locked protocol ${key} has no second action, so tapping its value must toggle its tongue`);
}
S.status.hp = { connected: false, proto: "", rx: 2, tx: 1, last_ok_s: 31 };
html = sandbox.__renderEsp32();
assert.match(html, /<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="protocol:link"[\s\S]*<span class="settings-info-value vrow-val settings-wrap err">Offline<\/span><\/button>/,
  "the reported Offline value must live inside the full-row heat-pump-link accordion button");
for (const explanation of ["Verbindungs-Erklärung", "Protokoll-Erklärung", "RX-Erklärung", "TX-Erklärung",
                           "Firmware-Erklärung", "Kanal-Erklärung", "Sprach-Erklärung"])
  assert.ok(html.includes(explanation), `Protocol/Firmware explanation must include: ${explanation}`);

// A concrete board is authoritative for the editable X10A inventory. Old XIAO defaults may still
// be cached immediately after Atom was selected, but they must neither reappear as options nor make
// both selects fall onto the same first GPIO. The first interaction submits the distinct suggested
// board pair. Custom keeps the legacy off-list value because its physical headers are unknowable.
S.status.board = { preset_id: "m5stack_atoms3_lite" };
S.status.pins_avail = [1, 2, 5, 6, 7, 8, 38];
S.status.hp = { connected: false, proto: "", rx: 44, tx: 43, last_ok_s: 31 };
html = sandbox.__renderEsp32();
let rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
let txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.doesNotMatch(rxSelect, /value="44"|value="43"/,
  "Atom RX options must not resurrect XIAO-only cached pins");
assert.doesNotMatch(txSelect, /value="44"|value="43"/,
  "Atom TX options must not resurrect XIAO-only cached pins");
assert.match(rxSelect, /value="1" selected/, "an invalid cached pair must start at Atom GPIO1 for RX");
assert.match(txSelect, /value="2" selected/, "the suggested Atom TX must stay distinct from RX");

S.status.pins_avail = [5, 6, 7, 8, 38]; // ENV III owns Grove GPIO2/1
html = sandbox.__renderEsp32();
rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.doesNotMatch(rxSelect + txSelect, /value="[12]"/,
  "enabled ENV III pins must stay absent from both X10A selectors");
assert.match(rxSelect, /value="5" selected/);
assert.match(txSelect, /value="6" selected/);

S.status.board = { preset_id: "custom" };
S.status.pins_avail = [1, 2, 5];
html = sandbox.__renderEsp32();
rxSelect = html.match(/<select[^>]*id="e32Rx"[\s\S]*?<\/select>/)?.[0] || "";
txSelect = html.match(/<select[^>]*id="e32Tx"[\s\S]*?<\/select>/)?.[0] || "";
assert.match(rxSelect, /value="44" selected/, "Custom must retain its explicitly stored off-list RX pin");
assert.match(txSelect, /value="43" selected/, "Custom must retain its explicitly stored off-list TX pin");

assert.match(html, /id="e32Chan"[^]*<option value="dev" selected>Development<\/option>/,
  "the update selector must survive the split explanation row");
assert.match(html, /id="e32Lang"[^]*<option value="auto" selected>Browser<\/option>/,
  "the language selector must survive the split explanation row");
assert.doesNotMatch(html, /e32DynamicLwt|role="switch"/,
  "the Firmware card must carry no heating-curve switch: arming is derived from the sources");
assert.ok(html.indexOf("card.fw_title") < 0, "translated card titles must be resolved");
assert.ok(html.indexOf("<div class=\"section-label\">Firmware") <
          html.indexOf("<div class=\"section-label\">Heizkurven-Diagnose"),
  "the diagnosis card must follow Firmware at the bottom, configured or not");

console.log("settings source tongue use-cases: ok");
