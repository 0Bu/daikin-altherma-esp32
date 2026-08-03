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

// HomeHub discovery is an explicit dialog action, never a boot mode. The same editable field accepts
// a discovered or manual address, and saving it empty is the deliberate disabled state.
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const httpConfig = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const httpStatus = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const mqttHa = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const dialogs = [...html.matchAll(/<[^>]+class="modal-card"[^>]+role="dialog"[^>]*>/g)].map((m) => m[0]);
assert.equal(dialogs.length, 10, "every custom popup must remain identifiable as a dialog");
for (const dialog of dialogs)
  assert.match(dialog, /tabindex="-1"/, "popup focus must land on the dialog container, not an input");
assert.match(app, /function openPopup\(id\)[\s\S]*modal\.hidden = false;[\s\S]*querySelector\?\.\('\[role="dialog"\]'\)[\s\S]*focus\?\.\(\{ preventScroll: true \}\)/,
  "opening a popup must focus only its container without scrolling");
for (const opener of ["openWifi", "openMqtt", "openRefTemp", "openWeather", "openSyslog", "openNtp", "openHomehub", "openBoard", "openEnv3", "openBug"])
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
  "the HomeHub dialog must not reintroduce an automatic boot mode");
assert.match(app, /post\("\/discover_homehub", \{\}\)/,
  "Search must call the dedicated request-local discovery endpoint");
assert.match(app, /applyLive\(\{ mb_host: host, mb_port: port, mb_unit_id: unit \}/,
  "Save must persist the field directly, including the empty disabled value");
assert.doesNotMatch(app, /mb_mode|config_modbus_should_search/,
  "the browser bundle must carry no hidden Auto-mode contract");

// Dynamic LWT owns one permanent Settings card. Room input and direct Open-Meteo forecast are
// editable; ENV III appears only for a selected M5Stack board. Strategy and output keep explicit
// non-active/read-only homes.
assert.match(app, /function dynamicControlCardHtml\(\)[\s\S]*t\("dyn\.mode"\)[\s\S]*t\("dyn\.room_sources"\)[\s\S]*t\("dyn\.weather"\)[\s\S]*t\("dyn\.outdoor"\)[\s\S]*t\("dyn\.strategy"\)[\s\S]*t\("dyn\.safety"\)/,
  "the dynamic-LWT Settings card must keep all planned configuration domains together");
assert.match(app, /t\("dyn\.observe"\)[\s\S]*t\("dyn\.read_only"\)/,
  "the first slice must identify itself as observation-only and read-only");
assert.match(html, /id="weatherModal"[\s\S]*id="wxLatitude"[\s\S]*id="wxLongitude"[\s\S]*data-i18n="wx\.hint"[\s\S]*open-meteo\.com/,
  "the direct Open-Meteo source must expose coordinate entry, privacy, and attribution");
assert.doesNotMatch(html, /id="wxLocate"/,
  "the HTTP device UI must not offer a browser-geolocation action that requires HTTPS or localhost");
assert.match(app, /data-act="weather"[\s\S]*function openWeather\(\)[\s\S]*saveReboot\("\/set_weather", \{ latitude, longitude \}/,
  "the forecast row must edit latitude and longitude through the firmware config route");
assert.match(app, /function parseWeatherCoordinatePair\([\s\S]*function pasteWeatherCoordinates\([\s\S]*addEventListener\("paste", pasteWeatherCoordinates\)/,
  "a Google Maps coordinate pair pasted into either field must be split before save");
assert.doesNotMatch(app, /navigator\.geolocation/,
  "the direct device UI must carry no unreachable browser-geolocation logic");
assert.doesNotMatch(app, /weather[^\n]{0,120}broker_off|input\/weather/,
  "the Open-Meteo forecast must not depend on the MQTT broker or an adapter topic");
assert.match(httpConfig, /static esp_err_t set_weather[\s\S]*weather_location_parse[\s\S]*weather_forecast_reconfigure/,
  "the coordinate save must validate both values and wake the firmware fetch task");
assert.match(app, /data-act="env3"[\s\S]*function statusCardsHtml\(\)[\s\S]*t\("env\.temperature"\)[\s\S]*t\("env\.humidity"\)[\s\S]*t\("env\.pressure"\)/,
  "ENV III must be configurable from the dynamic-control card and render an independent outdoor-climate card");
assert.match(app, /if \(env\.supported\)[\s\S]*data-act="env3"/,
  "the ENV III Settings row must exist only on a supported M5Stack board");
assert.match(app, /if \(env\.supported && env\.enabled\)/,
  "the ENV III dashboard card must be hidden on unsupported boards even with stale status data");
assert.match(app, /function openEnv3\(\) \{[\s\S]*if \(!S\.status\?\.env3\?\.supported\) return;/,
  "the ENV III modal must fail closed when called outside a supported M5Stack board");
const envModalHtml = html.slice(html.indexOf('id="env3Modal"'), html.indexOf('<!-- Bug report'));
assert.match(envModalHtml, /id="envSensor"[\s\S]*value="" selected[\s\S]*value="env_iii"[\s\S]*id="envPinFields" hidden[\s\S]*id="envSda"[\s\S]*id="envScl"/,
  "the outdoor-sensor modal must default to no sensor and keep its SDA/SCL group hidden until selected");
assert.doesNotMatch(envModalHtml, /type="checkbox"|envEnabled|envPreset|env\.hint|temperature measurement range|Temperatur-Messbereich/,
  "the outdoor-sensor modal must contain no enable checkbox, wiring preset, or technical prose");
assert.match(app, /SDA carries the I²C data; SCL provides the clock\./,
  "the English modal must explain SDA and SCL in one short sentence");
assert.match(app, /SDA überträgt die I²C-Daten, SCL gibt den Takt vor\./,
  "the German modal must explain SDA and SCL in one short sentence");
assert.match(app, /function syncEnv3Fields\(\)[\s\S]*\$\("envPinFields"\)\.hidden = !enabled;[\s\S]*disabled = !enabled/,
  "selecting no sensor must hide and disable both GPIO fields");
assert.match(app, /function env3FormPayload\(\)[\s\S]*if \(!enabled\) return \{ enabled: false \};[\s\S]*saveReboot\("\/set_env3", body/,
  "disabling ENV III must submit an explicit false without stale pin fields");
assert.match(httpConfig, /env3_config_valid\(c[\s\S]*http_register_on\(s, surface, "\/set_env3"/,
  "the device must validate ENV III pin collisions before registering the config route");
assert.ok(httpStatus.includes("board_vendor_name(board_selected_vendor(c))"),
  "status must expose the selected board vendor");
assert.ok(httpStatus.includes('j += ",\\"preset_id\\":";') &&
          httpStatus.includes("board_preset_key(c.board_preset_id)") &&
          httpStatus.includes('j += ",\\"preset_name\\":";'),
  "status must expose the explicitly persisted board preset id and display name");
assert.match(app, /preset_id: \$\("bdPreset"\)\.value \|\| "custom"/,
  "the Board dialog must submit the selected preset id instead of only its derived pin values");
assert.match(httpConfig, /board_preset_by_key\(preset_key\)[\s\S]*board_identity_valid\(c, reason\)/,
  "the device must reject unknown or hardware-mismatched board preset ids");
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

// The room-source row remains a user-configured exact MQTT mapping. Test is non-persistent and Save
// starts disabled; only the proof returned after a readable fresh value may accompany the save.
assert.match(html, /id="refTempModal"[\s\S]*id="rtTopic"[\s\S]*id="rtPath"[\s\S]*id="rtTimePath"[\s\S]*id="rtMaxAge"/,
  "the room-temperature source modal must expose value, timestamp, and freshness mapping");
assert.match(html, /id="rtTestBtn"[\s\S]*id="rtBtn"[^>]*disabled/,
  "Test must be available before the initially-disabled Save action");
assert.match(style, /#refTempModal #rtTestBtn\s*\{[^}]*min-width:\s*0;[^}]*padding-inline:\s*12px;/s,
  "the room-source Test status must stay inside its flex share without pushing Save outside the modal");
assert.match(app, /"ref\.testing": "Waiting…"/);
assert.match(app, /"ref\.testing": "Warten…"/);
assert.match(app, /shelly1pmminig4-fixture00003\/status\/switch:0/,
  "the requested Shelly topic must be available as the first-open test preset");
assert.match(app, /post\("\/test_ref_temp", input\)[\s\S]*passRefTempTest\(result\.test_proof/,
  "the browser must wait for the device's test proof before enabling Save");
assert.match(app, /post\("\/set_ref_temp", \{ \.\.\.input, test_proof: refTempTestProof \}\)/,
  "the reference-temperature save must present the exact mapping's test proof");
assert.match(app, /r\.status === 409\) resetRefTempTest\(\)/,
  "a server-rejected proof must disable Save until the mapping is tested again");
assert.match(httpConfig, /mqtt_reference_test_proof_valid\(in\.test_proof, tested\)[\s\S]*Test this MQTT mapping successfully before saving/,
  "a raw POST must not bypass the test-before-persist contract");
assert.match(httpConfig, /static esp_err_t test_ref_temp[\s\S]*mqtt_reference_test\([\s\S]*12000/,
  "the test endpoint must wait for the live MQTT task without writing the mapping");
assert.match(mqttHa, /service_reference_probe_frame[\s\S]*reference_timestamp_moved_backward\([\s\S]*service_reference_frames[\s\S]*reference_timestamp_moved_backward\(/,
  "the transient test and saved source must share the backward-timestamp rejection");
assert.match(app, /r\.retained[\s\S]*ref\.retained/,
  "the captured-value UI must identify retained MQTT messages");
assert.match(app, /r\.freshness_reason === "retained_without_timestamp"[\s\S]*ref\.time_untrusted/,
  "retained values without source time must be shown as untrusted, never fresh");

// All popup text-like fields share one select-all behavior. Exercise the production helper and pin
// the exclusions that preserve native checkbox/radio/file interaction.
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
vm.runInContext(`${settingsSource}\nthis.__selectModalFieldContents = selectModalFieldContents;`,
  selectContext, { filename: "main/www/js/settings.js" });
let selected = 0;
assert.equal(selectContext.__selectModalFieldContents({
  matches: () => true,
  select: () => { selected++; },
}), true);
assert.equal(selected, 1, "a matching popup field must select its complete content");
assert.match(app, /\.modal-card textarea, \.modal-card input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\)/,
  "popup select-all must exclude controls without replaceable text");
assert.match(app, /\["focusin", "click"\][\s\S]*selectModalFieldContents\(e\.target\)/,
  "focus and click must both apply the popup-wide selection rule");

console.log(`ui bundle: ${files.length} sources, ${Buffer.byteLength(app)} bytes — valid classic script`);
