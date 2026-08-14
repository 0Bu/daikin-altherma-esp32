// Contract test for the modular device UI: every host-side tool and the firmware build consume the
// same ordered source manifest, whose concatenation must remain one valid classic script.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appSourceFiles, readAppFragments, readAppSource } from "../tools/ui/read_app_source.mjs";

const files = appSourceFiles();
assert.ok(files.length > 1, "the UI must remain split into multiple source files");
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  assert.ok(source.endsWith("\n"), `${file} must end with a newline so adjacent fragments cannot fuse`);
  assert.doesNotMatch(source, /\/\*@@INLINE:style\.css@@\*\/|\/\/@@INLINE:app\.js@@/,
    `${file} must not contain an inline-asset marker`);
  assert.doesNotThrow(() => new vm.Script(source, { filename: file }),
    `${file} must remain a complete, independently parseable source fragment`);
}

const app = readAppSource();
assert.match(app, /^\/\/ Web UI for daikin-altherma-esp32/);
assert.match(app, /\n"use strict";/);
assert.match(app, /\nasync function boot\(\)/);
assert.match(app, /\nboot\(\);\s*$/);
assert.doesNotThrow(() => new vm.Script(app, { filename: "main/www/app.sources" }),
  "the ordered source fragments must parse as one classic script");
assert.match(app, /async function refreshStatus\(paint = true\)[\s\S]*if \(paint\) renderApp\(\)/,
  "status refresh must allow the poller to defer its full render");
assert.match(app, /async function refreshValues\(paint = true\)[\s\S]*if \(paint\) renderApp\(\)/,
  "values refresh must allow the poller to defer its full render");
assert.match(app, /ok = await refreshStatus\(false\)[\s\S]*deferredPaint = ok[\s\S]*refreshValues\(!deferredPaint\)[\s\S]*if \(deferredPaint\) renderApp\(\)/,
  "a status+values poll must paint the complete frame exactly once");

// HomeHub discovery has one invisible fresh-device boot attempt, never a user-selectable mode. The
// same editable field accepts an automatically found or manual address, and saving it empty is the
// deliberate persistent disabled state.
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const httpConfig = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const httpStatus = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const boardPresets = fs.readFileSync(new URL("../main/logic/board_presets.hpp", import.meta.url), "utf8");
const mqttHa = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const referenceLogic = fs.readFileSync(new URL("../main/logic/reference_temperature.hpp", import.meta.url), "utf8");
const dialogs = [...html.matchAll(/<[^>]+class="modal-card"[^>]+role="dialog"[^>]*>/g)].map((m) => m[0]);
assert.equal(dialogs.length, 10, "every custom popup must remain identifiable as a dialog");
for (const dialog of dialogs)
  assert.match(dialog, /tabindex="-1"/, "popup focus must land on the dialog container, not an input");
assert.match(app, /function openPopup\(id\)[\s\S]*modal\.hidden = false;[\s\S]*querySelector\?\.\('\[role="dialog"\]'\)[\s\S]*focus\?\.\(\{ preventScroll: true \}\)/,
  "opening a popup must focus only its container without scrolling");
assert.match(app, /function syncModalScrollLock\(\)[\s\S]*MODALS\.some[\s\S]*document\.documentElement\.classList\.toggle\("modal-open", open\)[\s\S]*document\.body\.classList\.toggle\("modal-open", open\)/,
  "modal lifecycle must lock both possible document scrollers");
assert.match(app, /function closePopup\(id\)[\s\S]*hidden = true;[\s\S]*syncModalScrollLock\(\)/,
  "all popup close paths must also release the shared scroll lock");
for (const opener of ["openWifi", "openMqtt", "openRefTemp", "openCirculation", "openWeather", "openSyslog", "openNtp", "openHomehub", "openBoard", "openBug"])
  assert.match(app, new RegExp(`function ${opener}\\(\\)[\\s\\S]*?openPopup\\(\\"[^\\"]+\\"\\);`),
    `${opener} must use the no-field-autofocus popup path`);
assert.match(html, /id="gPth"[\s\S]*id="svPth"[\s\S]*id="svCop"/,
  "the PHE must keep heat-output and COP placeholders in the schematic");
assert.doesNotMatch(style, /\.no-pth\s+#gPth/,
  "an idle working point must show PHE placeholders rather than hide supported figures");
assert.doesNotMatch(app, /classList\.toggle\("no-pth"/,
  "live rendering must not make the supported PHE figures disappear while idle");
const homehubHtml = html.slice(html.indexOf('id="homehubModal"'), html.indexOf('id="boardModal"'));
assert.match(homehubHtml, /class="input-action"[\s\S]*id="hhHost"[\s\S]*id="hhSearch"[\s\S]*data-i18n="hh.search"/,
  "the HomeHub modal must expose Search inside its editable host field");
assert.doesNotMatch(homehubHtml.slice(homehubHtml.indexOf('class="modal-actions"')), /id="hhSearch"/,
  "HomeHub Search must not return to the dialog-level Cancel/Save actions");
assert.doesNotMatch(html, /id="hhMode"|value="auto"[\s\S]*value="manual"/,
  "the HomeHub dialog must not expose the internal one-shot lifecycle as a mode picker");
assert.match(app, /post\("\/discover_homehub", \{\}\)/,
  "Search must call the dedicated request-local discovery endpoint");
assert.match(app, /applyLive\(\{ mb_host: host, mb_port: port, mb_unit_id: unit \}/,
  "Save must persist the field directly, including the explicit empty opt-out");
assert.doesNotMatch(app, /mb_mode|config_modbus_should_search/,
  "the browser bundle must carry no hidden Auto-mode contract");

// One Firmware-card master opt-in owns all optional plant diagnostics. Room input and direct
// Open-Meteo forecast are editable only in the dependent cards; board-bound ENV III remains an
// independent sensor under Board Hardware.
assert.match(app, /function dynamicControlCardHtml\(\)[\s\S]*t\("dyn\.state"\)[\s\S]*t\("dyn\.room_source"\)[\s\S]*t\("dyn\.weather"\)[\s\S]*t\("dyn\.strategy"\)/,
  "the diagnosis Settings card must keep all planned configuration domains together");
assert.doesNotMatch(app, /dynamicSourceRow\("env3"/,
  "the board-bound outdoor sensor must not remain as a separate dynamic-control setting");
// The card must NOT restate the Firmware toggle as a second mode row, and must not carry a
// constant "read-only" row: with the write path deleted (#294) neither can ever say anything else,
// and a line that cannot vary is one more thing a reader has to rule out.
assert.doesNotMatch(app, /t\("dyn\.mode"\)|t\("dyn\.safety"\)|t\("dyn\.read_only"\)|t\("dyn\.observe"\)/,
  "the diagnosis card must carry neither a duplicate mode row nor a constant read-only row");
// The state row must distinguish "the plant is not heating" from a fault: through the summer that
// is the expected reading, and styling it as a warning would train the user to ignore the row.
assert.match(app, /function dynamicStateRow\([\s\S]*"dyn\.state_waiting", cls: ""/,
  "an idle plant must be a neutral state, not a warning");
// Never resurrect the retired dynamic-LWT mode. The new control is a distinct master diagnostics
// consent and therefore has its own id/handler/route and no actuator semantics.
assert.doesNotMatch(app, /e32DynamicLwt|onDynamicLwtPick|set_dynamic_lwt/,
  "the retired heating-curve controller mode must stay absent");
assert.match(app, /function diagnosticsRow\(enabled\)[\s\S]*id="e32Diagnostics"[\s\S]*function onDiagnosticsPick\(\)[\s\S]*post\("\/set_diagnostics", \{ enabled \}\)/,
  "Firmware must own the persistent master diagnostics opt-in");
assert.doesNotMatch(app,
  /Aus ist der Standard|unvollständig oder irreführend|Off is the default|incomplete or misleading/,
  "the diagnostics explainer must stay focused on what the feature enables");
assert.match(httpConfig, /static esp_err_t set_diagnostics[\s\S]*diagnostics_next_generation[\s\S]*checkup_set_diagnostics[\s\S]*mqtt_reference_reconfigure[\s\S]*weather_forecast_reconfigure/,
  "the master route must start a fresh generation and reconfigure every dependent producer live");
assert.doesNotMatch(app, /function dynamicControlCardHtml\(\)[\s\S]{0,600}?return "";/,
  "the card itself must not invent another visibility rule");
assert.match(app, /vcard\(t\("card\.fw_title"\), fwRows\) \+[\s\S]{0,160}?diagnosticsEnabled \? circulationSettingsCardHtml\(\) \+ dynamicControlCardHtml\(\) : ""/,
  "dependent plant and heating-curve cards must render only after the Firmware opt-in");
assert.match(app, /S\.status\?\.diagnostics\?\.enabled === true && S\.status\?\.hp\?\.connected[\s\S]{0,80}?checkupCardHtml/,
  "the dashboard's 24-hour diagnosis must share the same master opt-in");
// A source that is CURRENT but cannot produce a verdict must not be the one row that looks fine
// while the state row above it reports the diagnosis blocked.
assert.match(app, /if \(!r\.control_eligible\)[\s\S]{0,180}?key: "unusable"[\s\S]{0,120}?cls: "warn"/,
  "a fresh but ineligible room source must not render as OK");
assert.match(app, /return \{ key: "usable", detail: "", cls: "ok" \}/,
  "only an overall usable room source may render as OK");
// The blocked line must name the room source's OWN reason, from one table both the state row and
// the source explanation read, so the two cannot give different accounts of one block.
assert.match(app, /const ROOM_BLOCK_LINES = \{[\s\S]*disabled:\s*"dyn\.room_off"/,
  "the room block reasons must be a single shared table");
const roomBlockTable = app.match(/const ROOM_BLOCK_LINES = \{[\s\S]*?\n\};/)?.[0] || "";
const referenceReasons = [...referenceLogic.matchAll(/case ReferenceRoomReason::\w+:\s+return "([^"]+)"/g)]
  .map((match) => match[1]).filter((reason) => !["eligible", "not_configured"].includes(reason));
for (const reason of referenceReasons)
  assert.match(roomBlockTable, new RegExp(`\\b${reason}:`),
    `room-source UI must translate the firmware reason ${reason}`);
assert.match(app, /d\.reason === "room_unavailable"[\s\S]{0,200}?ROOM_BLOCK_LINES\[room\.reason\]/,
  "a blocked diagnosis must say WHY the room source is unusable");
assert.match(app, /function roomSourceStatus\([\s\S]*key: "unusable", detail: t\(ROOM_BLOCK_LINES\[r\.reason\]/,
  "the source verdict must read the same reason table as the state row");
assert.match(app, /const sourceStatus = roomSourceStatus\(r, mqtt\);\s*const sourceCls = sourceStatus\.cls/,
  "the source colour must come from the same overall verdict as its visible status");
assert.match(app, /return vcard\(t\("dyn\.card"\), rows\);/,
  "the bottom card must render without a maturity pill");
assert.doesNotMatch(app, /"dyn\.experimental"|section-badge\.experimental/,
  "the removed experimental pill must leave no translation or styling contract behind");
assert.match(app,
  /"dyn\.strategy_help": "[^"]*inner control loop[^"]*D2 clipping share[^"]*zone actually requests heat[^"]*"/,
  "English heating-curve help must name the closed-loop masking caveat and corroborating evidence");
assert.match(app,
  /"dyn\.strategy_help": "[^"]*inneren Regelkreis[^"]*D2-Clipping-Anteil[^"]*Zone tatsächlich Wärme anfordert[^"]*"/,
  "German heating-curve help must name the closed-loop masking caveat and corroborating evidence");
const weatherModalHtml = html.match(/<div class="modal" id="weatherModal"[\s\S]*?<\/form>\s*<\/div>/)?.[0] || "";
assert.match(weatherModalHtml, /id="wxLatitude"[\s\S]*id="wxLongitude"[\s\S]*href="https:\/\/open-meteo\.com\/"[\s\S]*data-i18n="wx\.attribution"/,
  "the direct Open-Meteo source must expose coordinate entry and attribution");
assert.doesNotMatch(weatherModalHtml, /data-i18n="wx\.hint"/,
  "the weather explanation belongs in the Settings tongue, not the editor");
assert.doesNotMatch(html, /id="wxLocate"/,
  "the HTTP device UI must not offer a browser-geolocation action that requires HTTPS or localhost");
assert.match(app, /dynamicInfoRow\("weather"[\s\S]*"weather", t\("wx\.title"\)\)[\s\S]*function openWeather\(\)[\s\S]*saveReboot\("\/set_weather", \{ latitude, longitude \}/,
  "the forecast value must open latitude and longitude editing through the firmware config route");
assert.match(app, /function parseWeatherCoordinatePair\([\s\S]*function pasteWeatherCoordinates\([\s\S]*addEventListener\("paste", pasteWeatherCoordinates\)/,
  "a Google Maps coordinate pair pasted into either field must be split before save");
const weatherCopyLines = app.split("\n").filter((line) =>
  /^\s*"wx\.(?:detail\.source|hint\.(?:configured|setup))"\s*:/.test(line));
assert.equal(weatherCopyLines.length, 6,
  "weather provenance plus configured/setup guidance must exist in both languages");
for (const line of weatherCopyLines)
  assert.doesNotMatch(line, /experimental|experimentell/i,
    "weather copy must not refer to the controller's experimental Firmware switch");
const configuredGermanWeatherCopy = weatherCopyLines.find((line) => line.includes("Der ESP32 ruft")) || "";
assert.equal((configuredGermanWeatherCopy.match(/alle 45 Minuten/g) || []).length, 1,
  "configured German weather guidance must state its refresh interval exactly once");
assert.doesNotMatch(configuredGermanWeatherCopy, /Google Maps/,
  "configured weather guidance must not repeat coordinate-entry instructions");
assert.doesNotMatch(app, /navigator\.geolocation/,
  "the direct device UI must carry no unreachable browser-geolocation logic");
assert.doesNotMatch(app, /weather[^\n]{0,120}broker_off|input\/weather/,
  "the Open-Meteo forecast must not depend on the MQTT broker or an adapter topic");
assert.match(httpConfig, /static esp_err_t set_weather[\s\S]*weather_location_parse[\s\S]*weather_forecast_reconfigure/,
  "the coordinate save must validate both values and wake the firmware fetch task");
assert.doesNotMatch(app, /function statusCardsHtml\(\)[\s\S]*vcard\(t\("env\.card"\)/,
  "ENV III must not retain a standalone outdoor-climate dashboard card");
assert.match(html, /id="gEnv3"[^>]*data-insp="env3"[\s\S]*id="svEnv3Temp"[\s\S]*id="gSgRequest"/,
  "the ENV III temperature pill must sit immediately before Boost and open the shared inspector");
assert.match(app, /function renderEnv3Pill\(\)[\s\S]*env\.supported === true && env\.enabled === true[\s\S]*group\.style\.display = configured/,
  "the ENV III pill must be hidden on unsupported or disabled boards even with stale status data");
assert.doesNotMatch(html, /id="env3Modal"|id="env3Form"/,
  "ENV III must not remain in a separate popup");
const boardModalHtml = html.slice(html.indexOf('id="boardModal"'), html.indexOf('<!-- Bug report'));
assert.match(boardModalHtml, /id="bdEnvSection" hidden[\s\S]*data-i18n="env\.title"[\s\S]*id="envSensor"[\s\S]*value="" selected[\s\S]*value="env_iii"[\s\S]*id="envPinFields" hidden[\s\S]*id="envSda"[\s\S]*id="envScl"/,
  "Board Hardware must contain the M5Stack outdoor-sensor section and default it to no sensor");
assert.match(boardModalHtml, /class="pin-grid board-pin-grid"[\s\S]*id="bdLedPin"[\s\S]*id="bdBtnPin"[\s\S]*class="pin-grid" id="envPinFields" hidden/,
  "Board Hardware must lay out board and ENV pins in compact rows");
assert.doesNotMatch(boardModalHtml, /bdLedLegend|board\.led_(?:rgb|gpio)_|data-i18n="board\.hint"|data-i18n="env\.pins_hint"/,
  "the Board editor must contain controls only; LED, reset and I2C explanations belong to the Hardware tongue");
assert.doesNotMatch(boardModalHtml, /envEnabled|envPreset|env\.hint|temperature measurement range|Temperatur-Messbereich/,
  "the integrated sensor section must contain no enable checkbox, wiring preset, or technical prose");
assert.match(app, /"env\.pins_hint": "SDA = data \(yellow Grove wire\); SCL = clock \(white Grove wire\)\.[^"]*saves the working assignment automatically\."/,
  "the English Hardware tongue must explain SDA/SCL and automatic reversal");
assert.match(app, /"env\.pins_hint": "SDA = Datenleitung \(gelbe Grove-Leitung\), SCL = Taktleitung \(weiße Grove-Leitung\)\.[^"]*funktionierende Zuordnung automatisch\."/,
  "the German Hardware tongue must explain SDA/SCL and automatic reversal");
assert.match(app, /"board\.led_rgb_setup": "Blue, blinking slowly[\s\S]*"board\.led_gpio_wiping": "Solid after very rapid blinking[\s\S]*"board\.led_rgb_setup": "Blau, langsam blinkend[\s\S]*"board\.led_gpio_wiping": "Dauerlicht nach sehr schnellem Blinken/,
  "both concise status-LED legends must stay bilingual");
assert.match(style, /\.pin-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*\}[\s\S]*\.pin-grid\[hidden\]\s*\{[^}]*display:\s*none/,
  "board and ENV pin fields must stay in two-column rows without overriding their hidden state");
assert.match(app, /function boardLedLegend\(b\)[\s\S]*if \(b\.led_gpio == null \|\| b\.led_gpio < 0\) return "";[\s\S]*board\.led_\$\{kind\}_\$\{phase\}[\s\S]*function boardRow\(\)[\s\S]*boardLedLegend\(b\)[\s\S]*t\("board\.hint"\)[\s\S]*t\("env\.pins_hint"\)/,
  "the Hardware tongue must render the saved LED backend plus reset and I2C explanations");
assert.match(app, /function syncBoardFields\(\)[\s\S]*\$\("bdLedPin"\)\.disabled = type < 0;[\s\S]*\$\("bdLedInv"\)\.disabled = type !== 0;[\s\S]*\$\("bdBtnInv"\)\.disabled = !buttonEnabled/,
  "every hidden Board Hardware control must follow the selected type");
assert.match(app, /function syncEnv3Fields\(\)[\s\S]*\$\("envPinFields"\)\.hidden = !enabled;[\s\S]*disabled = !enabled/,
  "selecting no sensor must hide and disable both GPIO fields");
assert.match(app, /function boardSupportsEnv3\(\) \{ return selectedBoardPreset\(\)\?\.vendor === "m5stack"; \}[\s\S]*\$\("bdEnvSection"\)\.hidden = !supported;[\s\S]*\$\("envSensor"\)\.disabled = !supported/,
  "only a pending M5Stack identity may reveal and enable the integrated sensor section");
assert.match(app, /function env3FormPayload\(\)[\s\S]*if \(!enabled\) return \{ enabled: false \};[\s\S]*saveReboot\("\/set_board", \{[\s\S]*env3_enabled: env\.enabled[\s\S]*env3_sda:[\s\S]*env3_scl:/,
  "Board Save must submit board and sensor configuration through one atomic route");
assert.match(httpConfig, /env3_config_valid\(proposed[\s\S]*http_register_on\(s, surface, "\/set_env3"/,
  "the compatibility endpoint must retain authoritative ENV III collision validation");
assert.match(httpConfig,
  /static esp_err_t env3_save_preflight[\s\S]*env3_probe\(proposed\.env3_sda, proposed\.env3_scl\)[\s\S]*env3_probe\(proposed\.env3_scl, proposed\.env3_sda\)[\s\S]*proposed\.env3_sda = proposed\.env3_scl[\s\S]*static esp_err_t set_board[\s\S]*env3_save_preflight\(req, cur, c, env_allowed\)[\s\S]*config_save\(c\)/,
  "integrated Save must prove the requested or reversed ENV III mapping before one atomic save");
assert.ok(httpStatus.includes('j += "],\\\"env3_rows\\\":[";') &&
          httpStatus.includes("ENV3_HISTORIES") &&
          httpStatus.includes('std::strcmp(source, "env3")') &&
          httpStatus.includes("history_env3_snapshot"),
  "status and /history must expose the independent ENV III trend source");
assert.match(app, /if \(e\.env3\)[\s\S]*t\("env\.temperature"\)[\s\S]*t\("env\.humidity"\)[\s\S]*t\("env\.pressure"\)/,
  "the ENV III inspector must carry all three localized live readings");
assert.match(app, /const ENV3_COMBINED_ID = "env3_combined"[\s\S]*const ENV3_COMBINED_SERIES[\s\S]*function env3HistHtml\(\)/,
  "one combined timeline must render the three independently scaled ENV III series");
assert.match(app, /function env3SeriesClass\(source\)[\s\S]*env-temperature[\s\S]*env-humidity[\s\S]*env-pressure/,
  "the three ENV III lines must keep distinct stable style classes");
assert.match(app, /if \(e && e\.env3\)[\s\S]*ensureHist\(s\.id, "env3"\)[\s\S]*env3HistHtml\(\)/,
  "opening the ENV III pill must fetch all three rings and render their combined inspector trend");
assert.match(app, /env3_sht30_not_found:\s*"env\.err_sht30"[\s\S]*mapError:\s*env3SaveError/,
  "ENV III probe failures must stay in the dialog as localized errors");
assert.ok(httpStatus.includes("board_vendor_name(board_selected_vendor(c))"),
  "status must expose the selected board vendor");
assert.ok(httpStatus.includes('j += ",\\"preset_id\\":";') &&
          httpStatus.includes("board_preset_key(c.board_preset_id)") &&
          httpStatus.includes('j += ",\\"preset_name\\":";'),
  "status must expose the explicitly persisted board preset id and display name");
assert.match(app, /preset_id: \$\("bdPreset"\)\.value \|\| "custom"/,
  "the Board dialog must submit the selected preset id instead of only its derived pin values");
assert.match(httpConfig, /board_preset_by_key\(preset_key\)[\s\S]*board_identity_valid\(c, reason\)/,
  "the device must reject unknown board preset ids");
assert.match(boardPresets, /inline const BoardPreset\* board_selected_preset[\s\S]*return board_preset_by_id\(c\.board_preset_id\);/,
  "selected board identity must not be re-derived from configurable LED/reset values");
assert.match(httpStatus,
  /selected_board\s*\?\s*board_preset_x10a_pins_offerable\([\s\S]*:\s*board_pins_offerable\(/,
  "status must narrow X10A pins to a concrete board and retain the generic list only for Custom");
assert.match(httpConfig,
  /board_selected_preset\(c\)[\s\S]*board_preset_x10a_pin_offerable\(board, c\.rx_pin[\s\S]*board_preset_x10a_pin_offerable\(board, c\.tx_pin/,
  "the X10A request path must reject board-foreign RX/TX pins instead of relying on UI filtering");
assert.match(httpConfig,
  /const bool x10a_sent = set_hp_updates_x10a\([\s\S]*if \(x10a_sent\) \{[\s\S]*board_selected_preset\(c\)/,
  "a HomeHub-only /set_hp patch must bypass board-specific validation of untouched legacy X10A pins");
assert.match(app,
  /function boardLinkPickerValues\([\s\S]*const boardRestricted = [^;]*preset_id[\s\S]*!boardRestricted/,
  "the picker must not resurrect a stale board-foreign pin for a concrete board");
assert.match(httpStatus, /const bool env_supported = env3_board_supported\(c\);[\s\S]*j \+= env_supported \? "true" : "false";/,
  "status must expose the selected board vendor and the derived ENV III support decision");
assert.match(httpConfig, /if \(c\.env3_enabled && !env3_board_supported\(c\)\) c\.env3_enabled = false;/,
  "switching away from an M5Stack board must retire an enabled ENV III in the same save");
assert.match(mqttHa, /s_env3\s*=\s*env3_topic\(s_base\)/,
  "ENV III must use its own message topic directly below the configured MQTT base");
assert.match(mqttHa, /const bool new_sample = env\.fresh && env\.samples != s_last_env3_samples;[\s\S]*mqtt_publish\(s_env3, js\.c_str\(\), static_cast<int>\(js\.size\(\)\), 0, 1\)/,
  "every fresh ENV III sample must be published as retained telemetry, even when its values repeat");
assert.match(mqttHa, /else if \(!s_env3_disabled_cleaned\)[\s\S]*mqtt_publish\(s_env3, "", 0, 0, 1\)/,
  "disabling ENV III must retract its retained data topic");
assert.match(mqttHa, /publish_env3_discovery\(\)[\s\S]*env3_discovery_config\(s_node, s_board, s_env3, s_avail, sensor\)/,
  "enabled ENV III must announce temperature, humidity, and pressure through HA discovery");
assert.match(mqttHa, /else if \(!s_env3_disabled_cleaned\)[\s\S]*retract_env3_discovery\(\)/,
  "disabling ENV III must retract all retained HA discovery configs as well as state");

// The room-source row remains a user-configured exact MQTT mapping. Save performs the non-persistent
// Save persists intent immediately; Delete posts the explicit empty mapping that clears the source
// and captured value. Payload/path diagnostics belong to the durable subscriber.
assert.match(html, /id="refTempModal"[\s\S]*id="rtTemperatureSource"[\s\S]*id="rtTarget"[\s\S]*id="rtTimestampSource"[\s\S]*id="rtMaxAge"/,
  "the room-temperature source modal must expose current, target, source-time and freshness mappings");
assert.doesNotMatch(html, /id="rtEnabledPath"|id="rtHvacModePath"|ref\.enabled_path|ref\.hvac_mode_path/,
  "advanced eligibility mappings must not appear as optional fields in the room-source dialog");
for (const [input, help, key] of [
  ["rtTemperatureSource", "rtTemperatureSourceHelp", "ref.temperature_source_help"],
  ["rtTarget", "rtTargetHelp", "ref.target_help"],
  ["rtTimestampSource", "rtTimestampSourceHelp", "ref.timestamp_source_help"],
  ["rtMaxAge", "rtMaxAgeHelp", "ref.max_age_help"],
]) {
  assert.match(html, new RegExp(`id="${input}"[^>]*aria-describedby="${help}"[\\s\\S]*id="${help}"[^>]*data-i18n="${key.replace(".", "\\.")}"`),
    `${input} must expose its localized explanation to visual and assistive users`);
}
assert.doesNotMatch(html, /id="rtName"[^>]*aria-describedby|id="rtNameHelp"|data-i18n="ref\.name_help"/,
  "the self-explanatory room-source name must not carry redundant help text");
assert.match(html, /id="rtDeleteBtn"[^>]*data-i18n="ref\.delete"[\s\S]*id="rtBtn"[^>]*data-i18n="btn\.save"/,
  "Delete must replace the separate Test action while Save remains immediately actionable");
assert.doesNotMatch(html, /id="rtTestBtn"|id="rtTestResult"/,
  "the room-source dialog must not retain a separate Test action or stale proof result");
assert.match(html, /data-i18n="ref\.save_help"/,
  "the immediate-save/runtime-validation contract belongs briefly beside Save");
assert.doesNotMatch(app, /One MQTT source is supported|Es wird eine MQTT-Quelle unterstützt/,
  "the room-source status must not carry the former generic subscription and delete manual");
assert.doesNotMatch(app, /shelly1pmminig4-fixture00003\/status\/switch:0/,
  "an untouched profile must not carry the obsolete Shelly device-temperature preset");
assert.doesNotMatch(app, /\$\("rtEnabledPath"\)|\$\("rtHvacModePath"\)/,
  "the browser bundle must not retain DOM access to the removed optional fields");
assert.match(app, /const sameMapping = !!saved\.configured[\s\S]*enabled_path: sameMapping \? \(saved\.enabled_path \|\| ""\) : ""[\s\S]*hvac_mode_path: sameMapping \? \(saved\.hvac_mode_path \|\| ""\) : ""/,
  "editing an unchanged source must preserve existing advanced gates without exposing them in the UI");
assert.match(app, /refTempForm[^]*post\("\/set_ref_temp", input\)/,
  "Save must persist the mapping directly without waiting for a publisher");
assert.doesNotMatch(app, /\/test_ref_temp|mqtt_reference_test/,
  "the room-source UI must not retain the timed pre-save probe");
assert.match(app, /\$\("rtDeleteBtn"\)\.onclick[^]*post\("\/set_ref_temp", \{[^]*name: "", topic: "", temperature_path: "", setpoint_topic: "", setpoint_path: ""[^]*timestamp_topic: "", timestamp_path: ""/,
  "Delete must clear the saved mapping without testing the form's current field contents");
assert.match(app, /lastIndexOf\("\$"\)/,
  "topic$path parsing must preserve leading $ system topics by splitting at the last delimiter");
assert.match(app, /validRefTopic\(topic\) && path\.length <= 128/,
  "room-source paths must remain persistable until a real MQTT frame validates them");
assert.match(app, /"ref\.delete": "Delete"[^]*"ref\.delete": "Löschen"/,
  "Delete must remain explicit in both supported languages");
assert.doesNotMatch(httpConfig, /test_ref_temp|mqtt_reference_test/,
  "the room-source API must persist without a probe or proof gate");
assert.match(mqttHa, /set_reference_error[\s\S]*reference temperature payload rejected[\s\S]*decode_reference_frame/,
  "the durable subscriber must expose and log payload/path failures at runtime");
assert.doesNotMatch(mqttHa, /service_reference_probe|s_ref_probe|mqtt_reference_test/,
  "the MQTT task must not retain a separate room-source probe state machine");
assert.match(app, /r\.retained[\s\S]*ref\.retained/,
  "the captured-value UI must identify retained MQTT messages");
assert.match(app, /retained_without_timestamp: t\("ref\.time_untrusted"\)/,
  "retained values without source time must be shown as untrusted, never fresh");

// The circulation witness is a second read-only exact MQTT mapping. It consumes actual active power,
// not Shelly relay intent, and retains its separate live-test-before-persist safety boundary.
assert.match(html, /id="circulationModal"[\s\S]*id="circTopic"[\s\S]*id="circPowerPath"[\s\S]*id="circTimePath"[\s\S]*id="circOn"[\s\S]*id="circOff"[\s\S]*id="circMaxAge"[\s\S]*id="circConfirm"/,
  "circulation settings must expose the exact topic, JSON paths, freshness, hysteresis and confirmation");
assert.match(html, /id="svR2t"[\s\S]*id="svValve2"[\s\S]*id="svFlowSwitch"[\s\S]*id="svR3t"/,
  "R2T, the heating-cooling valve, flow switch and R3T must remain visible in the plant schematic");
assert.match(html, /data-insp="ouhx"[\s\S]*id="svOuHx"/,
  "the outdoor heat-exchanger R4T must remain visible inside the outdoor unit");
assert.match(app, /ouhx:[\s\S]*trend: "outdoor_heat_exchanger"/,
  "the outdoor heat-exchanger R4T inspector must expose its 24-hour history");
assert.match(app, /circulationForm[^]*post\("\/test_circulation", input\)[^]*testResult\.test_proof[^]*post\("\/set_circulation", \{ \.\.\.input, test_proof: testResult\.test_proof \}\)/,
  "circulation Save must test the exact live mapping before persisting it");
assert.match(app, /\$\("circDeleteBtn"\)\.onclick[^]*post\("\/set_circulation", \{[^]*name: "", topic: "", power_path: "", timestamp_path: ""/,
  "circulation Delete must clear the mapping without switching the plug");
assert.match(httpConfig, /mqtt_circulation_test_proof_valid\(in\.test_proof, tested\)[\s\S]*Test this MQTT mapping successfully before saving/,
  "a raw circulation-source POST must not bypass the live proof");
assert.match(mqttHa, /decode_circulation_frame[\s\S]*power_path[\s\S]*timestamp_path/,
  "the MQTT runtime must decode mapped active power and trusted source time");
assert.doesNotMatch(mqttHa, /circulation[\s\S]{0,160}(?:command|switch|output)[\s\S]{0,80}(?:publish|write)/i,
  "circulation diagnosis must not grow a Shelly actuation path");

// Broker settings are test-before-persist too, but the test is performed synchronously by /set_mqtt:
// an accepted non-empty broker must have completed MQTT CONNECT/auth. Heap pressure is retryable and
// must never downgrade that proof to DNS + an open TCP port followed by a write.
assert.match(html, /id="mqBtn"[^>]*data-i18n="btn\.save"/,
  "the idle MQTT action must retain the concise Save label");
assert.match(app, /saveReboot\("\/set_mqtt"[\s\S]*busyLabel: "btn\.verifying"/,
  "the MQTT save action must remain visibly in verification state during the pre-flight");
// heap_largest_internal_block() rather than heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT):
// the pre-flight has to weigh its TLS session against INTERNAL DRAM, which is the heap that binds.
// DEFAULT answers from PSRAM on a board that has it, and a probe waved through on megabytes of
// PSRAM headroom is the reboot this guard exists to prevent.
assert.match(httpConfig, /heap_largest_internal_block[\s\S]*503 Service Unavailable[\s\S]*Device busy; retry MQTT verification[\s\S]*esp_mqtt_client_init[\s\S]*ctx\.connected[\s\S]*config_save\(c\)/,
  "insufficient probe resources or a failed MQTT CONNECT must return before config_save");
assert.doesNotMatch(httpConfig, /skipping broker connect probe[\s\S]*saving anyway/,
  "the broker pre-flight must never persist after skipping MQTT CONNECT/auth");

// All popup text-like fields share one first-focus select-all behavior. Exercise the production
// helper and pin both states: activation selects, a later click in the active field preserves its
// native caret placement. Checkbox/radio/file interaction remains native too.
const settingsSource = readAppFragments(["settings.js"]);

// Google Maps copies "latitude, longitude" with more precision than the firmware's signed
// microdegrees. Exercise the production parser, including either-field paste and range rejection.
const weatherFields = {
  wxLatitude: { id: "wxLatitude", value: "", classList: { remove() {} } },
  wxLongitude: { id: "wxLongitude", value: "", classList: { remove() {} } },
  wxError: { hidden: false },
};
const weatherContext = vm.createContext({ S: {}, $: (id) => weatherFields[id], t: (key) => key, esc: String });
vm.runInContext(`${settingsSource}\nthis.__parseWeatherCoordinatePair = parseWeatherCoordinatePair; this.__pasteWeatherCoordinates = pasteWeatherCoordinates;`,
  weatherContext, { filename: "main/www/js/settings.js" });
const googlePair = "12.34567890123456, 23.45678901234567";
const parsedGooglePair = weatherContext.__parseWeatherCoordinatePair(googlePair);
assert.equal(parsedGooglePair.latitude, "12.345678");
assert.equal(parsedGooglePair.longitude, "23.456789");
assert.equal(weatherContext.__parseWeatherCoordinatePair("91.0, 7.0"), null,
  "latitude outside the valid range must not be accepted as a pair");
for (const target of [weatherFields.wxLatitude, weatherFields.wxLongitude]) {
  weatherFields.wxLatitude.value = "";
  weatherFields.wxLongitude.value = "";
  let prevented = false;
  weatherContext.__pasteWeatherCoordinates({
    currentTarget: target,
    clipboardData: { getData: () => googlePair },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true, "recognized coordinate-pair paste must replace native field insertion");
  assert.equal(weatherFields.wxLatitude.value, "12.345678");
  assert.equal(weatherFields.wxLongitude.value, "23.456789");
}

const selectContext = vm.createContext({ S: {}, $: () => ({}), t: (key) => key, esc: String });
vm.runInContext(`${settingsSource}\nthis.__wireModalFieldSelection = wireModalFieldSelection;`,
  selectContext, { filename: "main/www/js/settings.js" });
let selected = 0;
const selectableField = {
  matches: () => true,
  value: "host:1883",
  selectionStart: 9,
  selectionEnd: 9,
  select: () => {
    selected++;
    selectableField.selectionStart = 0;
    selectableField.selectionEnd = selectableField.value.length;
  },
  setSelectionRange: (start, end) => {
    selectableField.selectionStart = start;
    selectableField.selectionEnd = end;
  },
};
const otherField = {};
const fieldListeners = {};
const fieldDocument = {
  activeElement: otherField,
  addEventListener: (name, listener) => { fieldListeners[name] = listener; },
};
selectContext.__wireModalFieldSelection(fieldDocument);

// First tap after blur: pointerdown sees INACTIVE, focus selects, and click restores that selection
// after the browser's native caret placement.
fieldListeners.pointerdown({ target: selectableField });
fieldDocument.activeElement = selectableField;
fieldListeners.focusin({ target: selectableField });
fieldListeners.click({ target: selectableField });
assert.equal(selected, 2, "activating an inactive popup field must leave its complete content selected");

// Second tap while active: no focusin occurs and the click must not select again, so the browser can
// place or move the caret itself.
fieldListeners.pointerdown({ target: selectableField });
fieldListeners.click({ target: selectableField });
assert.equal(selected, 2, "clicking an already-active popup field must preserve native caret placement");
assert.equal(selectableField.selectionStart, selectableField.value.length,
  "the previous select-all must collapse before native caret placement on the second tap");
assert.equal(selectableField.selectionEnd, selectableField.selectionStart,
  "the second tap must leave a movable caret instead of a full selection");

// Once blurred, the next tap is a new activation and gets the one-paste shortcut again.
fieldDocument.activeElement = otherField;
fieldListeners.pointerdown({ target: selectableField });
fieldDocument.activeElement = selectableField;
fieldListeners.focusin({ target: selectableField });
fieldListeners.click({ target: selectableField });
assert.equal(selected, 4, "the first tap after a later blur must select the complete content again");
assert.match(app, /\.modal-card textarea, \.modal-card input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\)/,
  "popup select-all must exclude controls without replaceable text");
assert.match(app, /wireModalFieldSelection\(document\)/,
  "the popup selection state machine must be wired into the production UI");
assert.doesNotMatch(app, /document\.addEventListener\("click", \(e\) => \{\s*selectModalFieldContents\(e\.target\)/,
  "ordinary clicks in an active field must not unconditionally select all again");

console.log(`ui bundle: ${files.length} sources, ${Buffer.byteLength(app)} bytes — valid classic script`);
