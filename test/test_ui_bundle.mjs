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
const mqttHa = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const dialogs = [...html.matchAll(/<[^>]+class="modal-card"[^>]+role="dialog"[^>]*>/g)].map((m) => m[0]);
assert.equal(dialogs.length, 8, "every custom popup must remain identifiable as a dialog");
for (const dialog of dialogs)
  assert.match(dialog, /tabindex="-1"/, "popup focus must land on the dialog container, not an input");
assert.match(app, /function openPopup\(id\)[\s\S]*modal\.hidden = false;[\s\S]*querySelector\?\.\('\[role="dialog"\]'\)[\s\S]*focus\?\.\(\{ preventScroll: true \}\)/,
  "opening a popup must focus only its container without scrolling");
for (const opener of ["openWifi", "openMqtt", "openRefTemp", "openSyslog", "openNtp", "openHomehub", "openBoard", "openBug"])
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

// Dynamic LWT owns one permanent Settings card from the first capture slice onward. Only its room
// source is editable today; forecast, strategy and output have explicit non-active/read-only homes.
assert.match(app, /function dynamicControlCardHtml\(\)[\s\S]*t\("dyn\.mode"\)[\s\S]*t\("dyn\.room_sources"\)[\s\S]*t\("dyn\.weather"\)[\s\S]*t\("dyn\.strategy"\)[\s\S]*t\("dyn\.safety"\)/,
  "the dynamic-LWT Settings card must keep all planned configuration domains together");
assert.match(app, /t\("dyn\.observe"\)[\s\S]*t\("dyn\.read_only"\)/,
  "the first slice must identify itself as observation-only and read-only");

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
