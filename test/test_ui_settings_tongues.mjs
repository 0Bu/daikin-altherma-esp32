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
  "dyn.configured": "Konfiguriert",
  "dyn.outdoor": "Gemessene Außenluft",
  "dyn.outdoor_none": "Kein Wert",
  "dyn.outdoor_detail_status": "Status",
  "dyn.outdoor_detail_sample": "Beim letzten aufgezeichneten Ereignis",
  "dyn.outdoor_status_live": "ENV-III-Messwert aktuell, wird mitaufgezeichnet.",
  "dyn.outdoor_status_unavailable": "Sensor eingerichtet, aber kein aktueller Messwert erreicht die Aufzeichnung.",
  "dyn.outdoor_status_absent": "Kein ENV-III-Sensor eingerichtet. Ereignisse werden ohne Außenwert aufgezeichnet.",
  "dyn.outdoor_sample_none": "Ohne Außenwert aufgezeichnet",
  "dyn.outdoor_help_axis": "Aussenachse macht die Raumabweichung lesbar.",
  "dyn.outdoor_help_placement": "Was der Sensor dort misst, wo er haengt.",
  "dyn.outdoor_help_setup": "Ein M5Stack ENV III am Grove-Port kann diesen Wert liefern.",
  "board.title": "Board-Hardware",
  "dyn.input_error": "Eingabefehler",
  "ref.title": "Raumtemperaturquelle",
  "ref.ago": "vor {0} s",
  "ref.now": "jetzt",
  "ref.waiting": "Warte auf Daten",
  "ref.retained": "retained",
  "ref.stale": "veraltet",
  "ref.error": "Fehler",
  "ref.hint": "Raumquellen-Erklärung",
  "ref.detail.configuration_label": "Konfiguration:",
  "ref.detail.status_label": "Status:",
  "ref.status.fresh": "Aktuell",
  "ref.status.stale": "Veraltet",
  "ref.status.waiting": "Wartet",
  "ref.status.unavailable": "Nicht verfügbar",
  "ref.status.inactive": "Aus",
  "ref.detail.fresh": "Messwert geprüft.",
  "ref.detail.stale": "Messwert wird nicht verwendet.",
  "ref.detail.waiting": "Noch kein Messwert.",
  "ref.detail.inactive": "Erfassung durch Firmware-Schalter ausgeschaltet.",
  "ref.detail.error": "Messwert verworfen.",
  "ref.detail.temperature_label": "Raumtemperatur:",
  "ref.detail.temperature": "{0} °C ist die aktuelle Raumtemperatur.",
  "ref.detail.setpoint_label": "Solltemperatur:",
  "ref.detail.setpoint": "{0} °C ist der Raumsollwert.",
  "ref.detail.age_label": "Alter:",
  "ref.detail.age": "Messwert {0} übernommen.",
  "ref.detail.source_label": "Quelle:",
  "ref.detail.source": "{0} via MQTT.",
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
  "dyn.state_help_room": "Raumblock-Erklärung",
  "ref.detail.eligibility_label": "Verwertbar:",
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
  reference_temperature: {
    configured: true, name: "Example rm", has_value: true, temperature_c: 25.1,
    has_setpoint: true, setpoint_c: 22.0, age_s: 17, fresh: true, control_eligible: true,
  },
  weather_forecast: {
    configured: true, has_value: true, outdoor_mean_2h_c: 22.6,
    solar_energy_2h_wh_m2: 0, fresh: true,
  },
  heating_curve: { method_version: 2, armed: true, state: "hold", reason: "plant_inactive" },
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
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 5,
  "all five diagnosis rows must render an information tongue");
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
// Scoped to the diagnosis row, not to data-act="board" alone: the ESP32 card's Hardware button
// carries that same action (both open the one Board Hardware modal), so a bare selector would
// silently start matching the wrong row if these renders were ever combined.
const outdoorFace = (h) => {
  const item = h.match(/data-desc="dynamic:outdoor"[\s\S]*?<\/button>[\s\S]*?<\/button>/)?.[0] || "";
  return item.match(/<button[^>]*data-act="board"[\s\S]*?<\/button>/)?.[0] || "";
};
const fixtureEnv3 = S.status.env3;
const fixtureCurve = S.status.heating_curve;
assert.match(html, /Gemessene Außenluft/,
  "the row must distinguish a MEASURED outdoor value from the forecast row beside it");
assert.notEqual(html.indexOf("Gemessene Außenluft"), html.indexOf("Wetterprognose"),
  "the measured axis and the forecast must be two distinct rows");

// (a) sensor live, but nothing has reached the recorder: warn, and the tongue explains the gap
// rather than letting the reader assume the sensor is broken.
assert.match(outdoorFace(html), /Kein Wert/);
assert.match(outdoorFace(html), /vrow-val settings-wrap warn/,
  "a CONFIGURED sensor whose value never arrives is worth a warning");
assert.match(html, /Sensor eingerichtet, aber kein aktueller Messwert erreicht die Aufzeichnung\./);

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
assert.match(outdoorFace(outdoorHtml), /−4,3\u00a0°C|-4,3\u00a0°C/,
  "the live axis prints the DIAGNOSIS value in the German locale");
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
assert.match(outdoorFace(outdoorHtml), /22,2\u00a0°C/,
  "a live axis still prints while no event has been recorded");
assert.doesNotMatch(outdoorHtml, /Beim letzten aufgezeichneten Ereignis/,
  "with no recorded event there is nothing to state about one — null must not read as 0.0 °C");
assert.doesNotMatch(outdoorHtml, /0,0\u00a0°C/,
  "an absent figure must never be rendered as a real zero reading");

S.status.env3 = fixtureEnv3;
S.status.heating_curve = fixtureCurve;

for (const key of ["state", "room-sources", "weather", "outdoor", "strategy"]) {
  const infoButton = html.match(new RegExp(`<button class="[^"]*(?:settings-split-info|settings-whole-info-row)[^"]*"[^>]*data-desc="dynamic:${key}"[\\s\\S]*?<\\/button>`))?.[0] || "";
  assert.match(infoButton, /aria-expanded="false"/,
    `${key} label must be a closed explanation action on first render`);
  assert.doesNotMatch(infoButton, /data-act=/,
    `${key} label must never open a configuration popup`);
}
for (const key of ["state", "strategy"]) {
  assert.match(html, new RegExp(`<button class="vrow settings-whole-info-row settings-info-row"[^>]*data-desc="dynamic:${key}"[\\s\\S]*class="settings-info-value`),
    `${key} has no second action, so its label and value must share one full-row accordion button`);
}
// A row's value is a popup action exactly when the user can CONFIGURE that value — room source,
// forecast location and the ENV III sensor each have an editor. The reported rows (state, method)
// have none and must stay passive, which is the assertion below.
assert.equal((html.match(/class="settings-split-action dynamic-config-open/g) || []).length, 3,
  "the three configurable sources may be popup actions; the reported rows may not");
assert.equal((html.match(/class="settings-info-value/g) || []).length, 2,
  "state and method values must stay passive inside their full-row accordion buttons");
assert.doesNotMatch(html, /settings-source-summary|Konfiguriert · 25,1 °C|Open-Meteo · 22,6 °C \/ 2 h/,
  "obsolete green summary lines must not duplicate values inside the tongues");
const roomTongue = html.match(/<div class="vdesc-body settings-info-tongue" id="dynamic-room-sources-detail">([\s\S]*?)<\/div><\/div><\/div><\/div>/)?.[1] || "";
assert.equal((roomTongue.match(/class="vdesc-p"/g) || []).length, 7,
  "room tongue must explain configuration state, status, current value, target, age, source and setup");
assert.match(roomTongue, /<span class="vdesc-n">Konfiguration:<\/span> Konfiguriert/,
  "the configuration state left the row header, so the tongue must state it");
assert.match(roomTongue, /<span class="vdesc-n">Raumtemperatur:<\/span> 25,1 °C ist die aktuelle Raumtemperatur\./);
assert.match(roomTongue, /<span class="vdesc-n">Solltemperatur:<\/span> 22 °C ist der Raumsollwert\./);
assert.match(roomTongue, /<span class="vdesc-n">Alter:<\/span> Messwert vor 17 s übernommen\./);
assert.match(roomTongue, /<span class="vdesc-n">Quelle:<\/span> Example rm via MQTT\./);
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
assert.match(roomButton, /aria-label="Raumtemperaturquelle: Example rm · Aktuell"/,
  "the accessible name must spell out the status the colour is carrying");
assert.doesNotMatch(html, /1 Quelle|Raumtemperaturquellen/,
  "the single room-temperature input must not be presented as a source count or plural collection");
assert.doesNotMatch(roomButton, /25,1 °C|vor 17 s/,
  "the configured reading must no longer be duplicated inside the editable header");
const weatherButton = html.match(/<button[^>]*data-act="weather"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(weatherButton, /<span>Open-Meteo<\/span>/,
  "the compact weather-provider value must be the popup action");
for (const explanation of ["Anlage heizt nicht", "Raumquellen-Erklärung", "Wetter-Konfiguration",
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
assert.equal((html.match(/class="vdesc-body settings-info-tongue"/g) || []).length, 5,
  "unconfigured sources must retain their explanation tongues");
assert.equal((html.match(/<span>Nicht konfiguriert<\/span>/g) || []).length, 3,
  "each empty editable source must expose Not configured as its popup value");
assert.ok(html.includes("Raumquellen-Erklärung") && html.includes("Wetter-Einrichtung"),
  "unconfigured sources must still explain how their inputs work");
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Konfiguration:<\/span> Nicht konfiguriert/,
  "an empty room source must state its configuration state in the tongue too");
assert.doesNotMatch(html, /Wetter-Konfiguration/,
  "unconfigured weather must show setup guidance instead of configured-source guidance");

S.status.reference_temperature = { configured: true, error: "bad payload" };
S.status.weather_forecast = { configured: true, fetching: true };
html = sandbox.__renderDynamic();
assert.match(html, /id="dynamic-weather-detail"[^]*<span class="vdesc-n">Status:<\/span> Aktualisierung läuft — Der ESP32 ruft gerade neue Prognosedaten ab\./,
  "a configured weather fetch must keep the tongue and explain the in-progress state");
assert.match(html, /id="dynamic-room-sources-detail"[^]*<span class="vdesc-n">Status:<\/span> Nicht verfügbar — Messwert verworfen\./,
  "a configured source error must be explained in its tongue");
// The name is cosmetic and may be empty. The row header still has to identify SOMETHING, and it must
// be the same word the tongue's source line uses — one fallback, not two.
assert.match(html.match(/<button[^>]*data-act="ref-temp"[\s\S]*?<\/button>/)?.[0] || "",
  /<span>MQTT<\/span>/,
  "a configured source saved without a name must fall back to the tongue's own source word");
assert.doesNotMatch(html, /data-act="env3"|dynamic-env3-status/,
  "ENV III configuration must live exclusively in Board Hardware");

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
assert.match(blockedRoomButton, /aria-label="Raumtemperaturquelle: Example rm · Raumthermostat ausgeschaltet"/,
  "a current-but-unusable source must name the block in its accessible name, not merely go orange");
assert.match(html, /<span class="vdesc-n">Verwertbar:<\/span> Raumthermostat ausgeschaltet/,
  "the source tongue must give the same reason as the state row");

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
