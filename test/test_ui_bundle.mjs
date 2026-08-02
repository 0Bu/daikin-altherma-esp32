// Contract test for the modular device UI: every host-side tool and the firmware build consume the
// same ordered source manifest, whose concatenation must remain one valid classic script.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appSourceFiles, readAppSource } from "../tools/ui/read_app_source.mjs";

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

// HomeHub intent must be explicit in both halves of the browser contract. Without these checks the
// status renderer could understand Auto/Manual/Off while the modal silently fell back to the old
// ambiguous empty-host form, or the form could show the selector but omit mb_mode from its POST.
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
assert.match(html, /<select class="input" id="hhMode">[\s\S]*value="auto"[\s\S]*value="manual"[\s\S]*value="off"[\s\S]*<\/select>/,
  "the HomeHub modal must expose Auto, Manual, and Off as explicit choices");
assert.match(app, /applyLive\(\{ mb_mode: mode, mb_host:/,
  "the HomeHub save must carry the selected mode to the firmware");

// Dynamic LWT owns one permanent Settings card from the first capture slice onward. Only its room
// source is editable today; forecast, strategy and output have explicit non-active/read-only homes.
assert.match(app, /function dynamicControlCardHtml\(\)[\s\S]*t\("dyn\.mode"\)[\s\S]*t\("dyn\.room_sources"\)[\s\S]*t\("dyn\.weather"\)[\s\S]*t\("dyn\.strategy"\)[\s\S]*t\("dyn\.safety"\)/,
  "the dynamic-LWT Settings card must keep all planned configuration domains together");
assert.match(app, /t\("dyn\.observe"\)[\s\S]*t\("dyn\.read_only"\)/,
  "the first slice must identify itself as observation-only and read-only");

// The room-source row remains a user-configured exact MQTT mapping: the test Shelly source prefills
// the modal, while the save sends separate topic/path fields to the firmware.
assert.match(html, /id="refTempModal"[\s\S]*id="rtTopic"[\s\S]*id="rtPath"[\s\S]*id="rtTimePath"[\s\S]*id="rtMaxAge"/,
  "the room-temperature source modal must expose value, timestamp, and freshness mapping");
assert.match(app, /shelly1pmminig4-fixture00003\/status\/switch:0/,
  "the requested Shelly topic must be available as the first-open test preset");
assert.match(app, /post\("\/set_ref_temp", \{[\s\S]*temperature_path: temperaturePath, timestamp_path: timestampPath,[\s\S]*max_age_s:/,
  "the reference-temperature save must persist timestamp and maximum-age policy");
assert.match(app, /r\.retained[\s\S]*ref\.retained/,
  "the captured-value UI must identify retained MQTT messages");
assert.match(app, /r\.freshness_reason === "retained_without_timestamp"[\s\S]*ref\.time_untrusted/,
  "retained values without source time must be shown as untrusted, never fresh");

console.log(`ui bundle: ${files.length} sources, ${Buffer.byteLength(app)} bytes — valid classic script`);
