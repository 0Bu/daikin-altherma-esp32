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
assert.doesNotMatch(html, /id="bdLedLegend|data-i18n="board\.hint"|data-i18n="env\.pins_hint"/,
  "LED, reset and I2C explanations must not remain inside the Board Hardware editor");
assert.match(html, /class="pin-grid board-pin-grid"[\s\S]*id="bdLedPinRow"[\s\S]*id="bdBtnPin"/,
  "LED and reset-button pin selectors must share one two-column row");
assert.match(style, /\.pin-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "the shared board and ENV pin row must remain a real two-column grid");
assert.match(style, /\.settings-split-info, \.settings-split-action\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*0;/,
  "split Settings actions must not add height inside the standard value row");
assert.match(style, /\.settings-split-info::before, \.settings-split-action::before\s*\{[^}]*inset:\s*-9px 0;/,
  "compact split actions must retain full-row click targets through the row padding");
assert.match(style, /\.settings-split-info\s*\{[^}]*flex:\s*1 1 auto;/,
  "the explanation action must own the otherwise empty left-hand row area");
assert.match(style, /\.settings-split-action\s*\{[^}]*flex:\s*0 1 auto;/,
  "the board editor action must shrink-wrap the visible board name instead of owning empty row space");
assert.doesNotMatch(style, /\.settings-split-row\s*\{[^}]*padding:/,
  "split Settings rows must inherit exactly the standard value-row padding");
assert.match(style, /\.settings-split-row\s*\{[^}]*min-height:\s*calc\(1\.5em \+ 18px\)/,
  "split Settings rows must match the standard mobile line height plus vertical padding");
assert.match(style, /@media \(min-width: 600px\)[\s\S]*\.settings-split-row\s*\{[^}]*min-height:\s*calc\(1\.5em \+ 22px\)/,
  "split Settings rows must track the larger standard padding on tablet and desktop");

const S = { status: {}, descOpen: new Set(), histPin: new Map() };
const renderSandbox = vm.createContext({
  S,
  navigator: { language: "en-GB" },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout,
  clearTimeout,
});
vm.runInContext(`${readAppFragments(["i18n.js", "dashboard.js", "history.js"])}
  this.__renderBoard = (lang) => { LANG = lang; return boardRow(); };
  this.__toggleDesc = toggleDesc;`, renderSandbox,
  { filename: "main/www/app.sources" });

S.status = {
  board: {
    preset_id: "m5stack_atoms3_lite", preset_name: "M5Stack AtomS3 Lite", user_set: true,
    led_gpio: 35, led_type: 1, led_inverted: false, btn_gpio: 41, btn_active_low: true,
  },
  env3: { supported: true, enabled: true, sda: 2, scl: 1 },
};
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
for (const text of [
  "Das M5Stack AtomS3 Lite ist ein kompaktes ESP32-S3-Board mit integrierter WS2812-RGB-Status-LED.",
  "Status-LED: WS2812 auf GPIO35.",
  "Reset-Taster: GPIO41, aktiv bei LOW.",
  "Außensensor: ENV III mit SDA auf GPIO2 und SCL auf GPIO1.",
  I18N.de["board.ledlegend_rgb"],
  I18N.de["board.hint"],
  I18N.de["env.pins_hint"],
]) assert.ok(rendered.includes(text), `German M5Stack hardware tongue must include: ${text}`);
for (const pattern of patterns) assert.ok(rendered.includes(pattern[4]),
  `German M5Stack hardware tongue must include RGB phase: ${pattern[4]}`);

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
  "Status LED: WS2812 on GPIO35.",
  "Reset button: GPIO41, active LOW.",
  "Outdoor sensor: ENV III with SDA on GPIO2 and SCL on GPIO1.",
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
assert.ok(rendered.includes("Status-LED: LED auf GPIO21, aktiv bei LOW."));
assert.ok(rendered.includes("Reset-Taster: nicht konfiguriert."));
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

console.log("board hardware details: concise backend-specific LED legends, pin row and tongue verified");
