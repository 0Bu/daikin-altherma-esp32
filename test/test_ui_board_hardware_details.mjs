// Board Hardware must explain every firmware LED phase in language suited to the selected LED
// backend, and the Settings card must explain the selected board/pin assignment in the same
// permanent tongue used elsewhere. This test binds both UI surfaces to the production state table.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const ledPatternSource = fs.readFileSync(new URL("../main/logic/led_pattern.hpp", import.meta.url), "utf8");
const i18nSource = readAppFragments(["i18n.js"]);

const i18nSandbox = vm.createContext({
  navigator: { language: "en-GB" },
  localStorage: { getItem() { return null; }, setItem() {} },
});
vm.runInContext(`${i18nSource}\nthis.__I18N = I18N;`, i18nSandbox,
  { filename: "main/www/js/i18n.js" });
const I18N = i18nSandbox.__I18N;

const firmwarePattern = (phase) => {
  const match = ledPatternSource.match(new RegExp(`case LedPhase::${phase}:[\\s\\S]{0,100}?return \\{([^}]+)\\};`));
  assert.ok(match, `missing firmware LED phase ${phase}`);
  return match[1].split(",").map((part) => Number(part.trim()));
};

const patterns = [
  ["Off", [0, 0, 0, 0, 0, 0, 1000], "off",
    "Off — no Wi-Fi mode active.", "Aus — kein WLAN-Modus aktiv.",
    "Off — no Wi-Fi mode active.", "Aus — kein WLAN-Modus aktiv."],
  ["SetupPortal", [0, 0, 255, 1, 1000, 1000, 0], "setup",
    "Blue, blinking slowly — setup portal active.", "Blau, langsam blinkend — Setup-Portal aktiv.",
    "Blinking slowly — setup portal active.", "Langsam blinkend — Setup-Portal aktiv."],
  ["Connecting", [255, 160, 0, 1, 100, 100, 0], "connecting",
    "Yellow, blinking quickly — connecting to Wi-Fi.", "Gelb, schnell blinkend — WLAN wird verbunden.",
    "Blinking quickly — connecting to Wi-Fi.", "Schnell blinkend — WLAN wird verbunden."],
  ["Healthy", [0, 255, 0, 1, 500, 0, 0], "healthy",
    "Green, solid — all configured connections ready.", "Grün, dauerhaft — alle konfigurierten Verbindungen bereit.",
    "Solid — all configured connections ready.", "Dauerlicht — alle konfigurierten Verbindungen bereit."],
  ["BusDown", [255, 0, 0, 2, 120, 150, 1000], "bus_down",
    "Red, double flash — X10A disconnected.", "Rot, Doppelblitz — X10A getrennt.",
    "Double flash — X10A disconnected.", "Doppelblitz — X10A getrennt."],
  ["MqttDown", [255, 90, 0, 1, 300, 300, 0], "mqtt_down",
    "Orange, blinking — X10A connected, MQTT disconnected.", "Orange, blinkend — X10A verbunden, MQTT getrennt.",
    "Blinking at medium speed — X10A connected, MQTT disconnected.", "Mittelschnell blinkend — X10A verbunden, MQTT getrennt."],
  ["WipeArmed", [255, 0, 0, 1, 60, 60, 0], "wipe_armed",
    "Red, blinking very quickly — erase armed; release to abort.", "Rot, sehr schnell blinkend — Löschen vorgemerkt; Loslassen bricht ab.",
    "Blinking very quickly — erase armed; release to abort.", "Sehr schnell blinkend — Löschen vorgemerkt; Loslassen bricht ab."],
  ["Wiping", [255, 255, 255, 1, 500, 0, 0], "wiping",
    "White, solid — erasing settings; do not disconnect power.", "Weiß, dauerhaft — Einstellungen werden gelöscht; Strom nicht trennen.",
    "Solid after very rapid blinking — erasing settings; do not disconnect power.", "Dauerlicht nach sehr schnellem Blinken — Einstellungen werden gelöscht; Strom nicht trennen."],
];

for (const [phase, expectedPattern, suffix, rgbEnglish, rgbGerman, gpioEnglish, gpioGerman] of patterns) {
  assert.deepEqual(firmwarePattern(phase), expectedPattern,
    `${phase} firmware pattern changed; review both visible legends deliberately`);
  for (const [kind, english, german] of [["rgb", rgbEnglish, rgbGerman], ["gpio", gpioEnglish, gpioGerman]]) {
    const key = `board.led_${kind}_${suffix}`;
    assert.equal(I18N.en[key], english, `${phase} English ${kind} legend must be concise and accurate`);
    assert.equal(I18N.de[key], german, `${phase} German ${kind} legend must be concise and accurate`);
    assert.doesNotMatch(`${english} ${german}`, /\b\d+\s*(?:ms|s)\b|×/,
      `${phase} legend must not expose technical timing values`);
  }
}
assert.doesNotMatch(style, /led-(?:single-blink|double-flash)|\.led-swatch[^}]*animation/,
  "infobox status points must stay static; the adjacent wording describes the blink pattern");
assert.doesNotMatch(html, /id="bdLedLegend|data-i18n="board\.hint"|data-i18n="env\.pins_hint"/,
  "LED, reset and I2C explanations must not remain inside the Board Hardware editor");
assert.match(html, /class="pin-grid board-pin-grid"[\s\S]*id="bdLedPinRow"[\s\S]*id="bdBtnPin"/,
  "LED and reset-button pin selectors must share one two-column row");
assert.match(style, /\.pin-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "the shared board and ENV pin row must remain a real two-column grid");
assert.match(style, /\.led-swatch\s*\{[^}]*align-self:\s*start;[^}]*margin-top:\s*calc\(\(1\.55em - 8px\) \/ 2\)/,
  "each LED preview must center on the first text line instead of sitting above it");
// The standard value row is 1.5em plus 9px above and below, and each of the two buttons must be
// tappable through the whole of it. That is the property; the MECHANISM moved, because the original
// one — the row owning the padding and each button reaching back through it with
// `::before { inset: -9px 0 }` — is only right while the two sit side by side. Once the row is
// allowed to WRAP (a long label above its own value, instead of crushing the value into a 63px
// column), the label's downward reach and the value's upward reach overlap in the gap between the
// two lines, and the value, painted later, takes taps meant for the explainer above it. Carrying
// the padding on the buttons themselves is the same target with none of that: each covers its own
// line and stops there, at exactly the same visible row height.
assert.match(style, /\.settings-split-row\s*\{[^}]*padding:\s*0;/,
  "the split row hands its vertical padding to its two buttons");
assert.match(style, /\.settings-split-info, \.settings-split-action\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*9px 0;/,
  "split Settings actions must carry the standard row padding as their own target, adding no height");
assert.doesNotMatch(style, /\.settings-split-(?:info|action)::before/,
  "the reach-back pseudo targets must stay gone — stacked, they steal each other's taps");
assert.match(style, /@media \(min-width: 600px\)[\s\S]*\.settings-split-info, \.settings-split-action\s*\{[^}]*padding-block:\s*11px;/,
  "the split targets must track the larger standard padding on tablet and desktop");
assert.match(style, /\.settings-split-row\s*\{[^}]*flex-wrap:\s*wrap;/,
  "a label and a value that cannot share a line must stack, not squeeze");
assert.match(style, /\.settings-split-action\s*\{[^}]*margin-left:\s*auto;/,
  "a value on its own line must stay in its right-hand column, not read as a second label");
assert.match(style, /\.settings-split-info, \.settings-split-action\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent;/,
  "iOS must not paint the enlarged split-button hit areas while they are tapped");
assert.match(style, /\.settings-split-info\s*\{[^}]*flex:\s*1 1 auto;/,
  "the explanation action must own the otherwise empty left-hand row area");
assert.match(style, /\.settings-whole-info-row\s*\{[^}]*width:\s*100%;[^}]*cursor:\s*pointer;/,
  "a Settings information row without a second action must expose one full-width button target");
assert.match(style, /\.settings-whole-info-label\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*7px;/,
  "the full-row target must keep the label and chevron grouped at the left");
assert.match(style, /\.settings-split-action\s*\{[^}]*flex:\s*0 1 auto;/,
  "the board editor action must shrink-wrap the visible board name instead of owning empty row space");
assert.match(style, /\.settings-split-row\s*\{[^}]*min-height:\s*calc\(1\.5em \+ 18px\)/,
  "split Settings rows must match the standard mobile line height plus vertical padding");
assert.match(style, /@media \(min-width: 600px\)[\s\S]*\.settings-split-row\s*\{[^}]*min-height:\s*calc\(1\.5em \+ 22px\)/,
  "split Settings rows must track the larger standard padding on tablet and desktop");

const S = { status: {}, descOpen: new Set(), histPin: new Map(), hist: new Map(), histBusy: new Set() };
const renderSandbox = vm.createContext({
  S,
  navigator: { language: "en-GB" },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout,
  clearTimeout,
});
vm.runInContext(`${readAppFragments(["i18n.js", "dashboard.js", "history.js"])}
  this.__renderBoard = (lang) => { LANG = lang; return boardRow(); };
  this.__env3Tooltip = (lang, i) => { LANG = lang; return scrubText(historyView(ENV3_COMBINED_ID), i); };
  this.__toggleDesc = toggleDesc;`, renderSandbox,
  { filename: "main/www/app.sources" });

S.status = {
  board: {
    preset_id: "m5stack_atoms3_lite", preset_name: "M5Stack AtomS3 Lite", user_set: true,
    led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true,
  },
  env3: { supported: true, enabled: true, sda: 2, scl: 1, fresh: true,
          temperature_c: 21.5, humidity_pct: 48, pressure_hpa: 1007 },
  history: { dt: 300, rows: [], modbus_rows: [], env3_rows: [
    { id: "env3_temperature", label: "ENV III temperature" },
    { id: "env3_humidity", label: "ENV III humidity" },
    { id: "env3_pressure", label: "ENV III air pressure" },
  ] },
};
const now = Date.now();
S.hist.set("env3:env3_temperature", { at: now, gen: 1, source: "env3", dt: 300, unit: "°C", b0: 1, v: [205, 210, 215] });
S.hist.set("env3:env3_humidity", { at: now, gen: 1, source: "env3", dt: 300, unit: "%", b0: 1, v: [500, 490, 480] });
S.hist.set("env3:env3_pressure", { at: now, gen: 1, source: "env3", dt: 300, unit: "hPa", b0: 1, v: [10050, 10060, 10070] });
let rendered = renderSandbox.__renderBoard("de");
assert.match(rendered, /class="vitem hardware-item"[\s\S]*class="hardware-info-toggle[^"]*"[^>]*data-desc="board:hardware"[^>]*aria-expanded="false"[^>]*aria-controls="board-hardware-detail"/,
  "Hardware on the left must be a closed explanation toggle on first render");
assert.match(rendered, /class="hardware-config-open[^"]*"[^>]*data-act="board"[^>]*aria-label="Board-Hardware: M5Stack AtomS3 Lite/,
  "the board name on the right must be the sole modal opener");
let boardButton = rendered.match(/<button class="hardware-config-open[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
assert.match(boardButton, /<span>M5Stack AtomS3 Lite<\/span>/,
  "the right action must display only the selected AtomS3 Lite board name");
assert.doesNotMatch(boardButton, /GPIO|WS2812|ENV III|Keine/,
  "pins, LED type and outdoor sensor must stay out of the right action");
assert.match(rendered, /class="vdesc-body board-hardware-tongue" id="board-hardware-detail"/,
  "the selected hardware facts must render in the standard dashboard tongue geometry");
assert.doesNotMatch(rendered, /data-trends="env3_temperature,env3_humidity,env3_pressure"/,
  "opening Hardware must no longer fetch outdoor-climate history");
assert.doesNotMatch(rendered, /ENV-III-Messwerte|data-hist="env3_combined"/,
  "live ENV III values and their chart must not be duplicated in the Hardware tongue");
assert.equal(renderSandbox.__env3Tooltip("de", 2),
  "jetzt\nTemperatur  21,5 °C\nLuftfeuchte  48,0 %\nLuftdruck  1.007,0 hPa",
  "one readable localized tooltip must report time and all three measurements together");
assert.match(style, /\.vhist-env3 \.vhist-graph\s*\{[^}]*--vhist-tip-base:\s*9\dpx;/,
  "the combined chart must reserve enough vertical room for its four-line tooltip");
assert.match(style, /\.vhist-env3 \.vhist-tip\s*\{[^}]*min-width:[^;}]+;[^}]*white-space:\s*pre;/,
  "the ENV III tooltip must retain readable lines instead of wrapping into a vertical strip");
for (const text of [
  "Das M5Stack AtomS3 Lite ist ein kompaktes ESP32-S3-Board mit integrierter WS2812-RGB-Status-LED.",
  "WS2812 auf GPIO35.",
  "GPIO41, aktiv bei LOW.",
  "SDA auf GPIO2, SCL auf GPIO1.",
  I18N.de["board.ledtype"],
  I18N.de["board.reset_section"],
  I18N.de["board.env3_section"],
  I18N.de["board.ledlegend_rgb"],
  I18N.de["board.hint"],
  I18N.de["env.pins_hint"],
]) assert.ok(rendered.includes(text), `German M5Stack hardware tongue must include: ${text}`);
for (const pattern of patterns) assert.ok(rendered.includes(pattern[4]),
  `German M5Stack hardware tongue must include RGB phase: ${pattern[4]}`);
const ledSectionAt = rendered.indexOf("hardware-led-section");
const resetSectionAt = rendered.indexOf("hardware-reset-section");
const env3SectionAt = rendered.indexOf("hardware-env3-section");
assert.ok(ledSectionAt >= 0 && ledSectionAt < resetSectionAt && resetSectionAt < env3SectionAt,
  "hardware facts must be grouped in LED, reset-button, ENV III order");
const ledSection = rendered.slice(ledSectionAt, resetSectionAt);
const resetSection = rendered.slice(resetSectionAt, env3SectionAt);
const env3Section = rendered.slice(env3SectionAt);
assert.doesNotMatch(ledSection, /Reset-Taster 5 Sekunden|SDA = Datenleitung/,
  "the LED section must not contain reset-button or ENV III help");
assert.match(resetSection, /Reset-Taster 5 Sekunden/,
  "the reset instructions must stay with the reset-button assignment");
assert.doesNotMatch(resetSection, /SDA = Datenleitung/,
  "the reset-button section must not contain ENV III wiring help");
assert.match(env3Section, /SDA = Datenleitung/,
  "the ENV III wiring and automatic pin-swap explanation must stay with ENV III");

const liveItem = { classList: { names: new Set(), contains(name) { return this.names.has(name); },
  toggle(name, force) { if (force) this.names.add(name); else this.names.delete(name); } } };
const liveToggle = { dataset: { desc: "board:hardware" }, attrs: {},
  closest(selector) { return selector === ".vitem" ? liveItem : null; },
  setAttribute(name, value) { this.attrs[name] = value; } };
renderSandbox.__toggleDesc(liveToggle);
assert.equal(liveItem.classList.contains("open"), true);
assert.equal(liveToggle.attrs["aria-expanded"], "true");
assert.equal(S.descOpen.has("board:hardware"), true,
  "opening Hardware must persist across the next status-driven rebuild");
rendered = renderSandbox.__renderBoard("de");
assert.match(rendered, /class="vitem open hardware-item"[\s\S]*data-desc="board:hardware"[^>]*aria-expanded="true"/,
  "an open Hardware explanation must be re-emitted after a poll rebuild");
renderSandbox.__toggleDesc(liveToggle);
assert.equal(S.descOpen.has("board:hardware"), false);

rendered = renderSandbox.__renderBoard("en");
for (const text of [
  "M5Stack AtomS3 Lite is a compact ESP32-S3 board with an onboard WS2812 RGB status LED.",
  "WS2812 on GPIO35.",
  "GPIO41, active LOW.",
  "SDA on GPIO2, SCL on GPIO1.",
  I18N.en["board.ledtype"],
  I18N.en["board.reset_section"],
  I18N.en["board.env3_section"],
  I18N.en["board.ledlegend_rgb"],
  I18N.en["board.hint"],
  I18N.en["env.pins_hint"],
]) assert.ok(rendered.includes(text), `English M5Stack hardware tongue must include: ${text}`);
for (const pattern of patterns) assert.ok(rendered.includes(pattern[3]),
  `English M5Stack hardware tongue must include RGB phase: ${pattern[3]}`);

S.status = {
  board: {
    preset_id: "seeed_xiao_esp32s3", preset_name: "Seeed XIAO ESP32-S3", user_set: true,
    led_gpio: 21, led_type: 0, led_inverted: true, btn_gpio: -1, btn_active_low: true,
  },
  env3: { supported: false, enabled: false },
};
rendered = renderSandbox.__renderBoard("de");
boardButton = rendered.match(/<button class="hardware-config-open[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
assert.match(boardButton, /<span>Seeed XIAO ESP32-S3<\/span>/,
  "the right action must display only the selected XIAO board name");
assert.doesNotMatch(boardButton, /GPIO|LED|ENV III|Keine/,
  "XIAO pin and peripheral details must stay in the explanation tongue");
assert.ok(rendered.includes("LED auf GPIO21, aktiv bei LOW."));
assert.ok(rendered.includes("Nicht konfiguriert."));
assert.ok(rendered.includes(I18N.de["board.ledlegend_gpio"]));
assert.ok(rendered.includes(I18N.de["board.hint"]));
for (const pattern of patterns) assert.ok(rendered.includes(pattern[6]),
  `German XIAO hardware tongue must include GPIO phase: ${pattern[6]}`);
assert.doesNotMatch(rendered, /Außensensor:/,
  "a board without ENV support must not claim an outdoor-sensor assignment");
assert.ok(!rendered.includes(I18N.de["env.pins_hint"]),
  "a board without ENV support must not explain unavailable I2C fields");

S.status = {
  board: {
    preset_id: "custom", preset_name: "", user_set: true,
    led_gpio: -1, led_type: 0, led_inverted: false, btn_gpio: -1, btn_active_low: true,
  },
  env3: { supported: false, enabled: false },
};
rendered = renderSandbox.__renderBoard("de");
boardButton = rendered.match(/<button class="hardware-config-open[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
assert.match(boardButton, /<span>Benutzerdefiniert<\/span>/,
  "the right action must display only the generic/custom board name");
assert.doesNotMatch(boardButton, /GPIO|LED|ENV III|Keine/,
  "custom-board details must stay in the explanation tongue");
assert.doesNotMatch(rendered, /LED-Farben und Blinkmuster|LED-Blinkmuster/,
  "None must keep the LED explanation out of the Hardware tongue");

// The ENV III pin hint must not name a pin the picker structurally cannot offer. On the DOCUMENTED
// AtomS3 Lite wiring (docs/WIRING.md: X10A over the Grove port, RX=1/TX=2) both Grove pads carry the
// serial link, so `board_preset_i2c_pins_offerable` leaves exactly the case header — GPIO5-GPIO8 and
// GPIO38 — and the dropdown shows no GPIO1 or GPIO2. The earlier copy led with "use Grove GPIO2/1",
// i.e. it recommended the one pair that wiring can never produce, and the omission carried no reason;
// that combination was reported as a bug. The hint must lead with the header pins and state the
// condition attached to Grove. test_logic.cpp pins the pin sets this copy describes.
for (const [lang, header, grove, why] of [
  ["en", /GPIO5.{1,3}GPIO8 and GPIO38/, /Grove port \(GPIO2\/1\) appears only while the X10A link is not on it/i,
   /one pad cannot carry both the serial link and the I2C bus/i],
  ["de", /GPIO5.{1,3}GPIO8 und GPIO38/, /Grove-Port \(GPIO2\/1\) erscheint nur, solange die X10A-Verbindung nicht darauf liegt/i,
   /ein Pad kann nicht zugleich die serielle Verbindung und den I2C-Bus führen/i],
]) {
  const hint = I18N[lang]["env.atoms3_header_hint"];
  assert.match(hint, header, `${lang} ENV III hint must lead with the header pins that are offered`);
  assert.match(hint, grove, `${lang} ENV III hint must make Grove conditional, not recommended`);
  assert.match(hint, why, `${lang} ENV III hint must say why the pins cannot be shared`);
  assert.doesNotMatch(hint, /(use|verwenden)[^.]*Grove GPIO2\/1/i,
    `${lang} ENV III hint must not recommend the Grove pair outright`);
}
// The inline fallback in index.html is what a client sees before applyStaticI18n runs, so it must
// carry the same claim rather than the superseded recommendation.
const inlineHint = html.match(/data-i18n="env\.atoms3_header_hint"[^>]*>([^<]*)</)?.[1] || "";
assert.equal(inlineHint, I18N.en["env.atoms3_header_hint"],
  "the index.html fallback must match the English hint it stands in for");

console.log("board hardware details: concise backend-specific LED legends, pin row and tongue verified");
