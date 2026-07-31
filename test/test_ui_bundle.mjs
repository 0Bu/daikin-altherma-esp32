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

console.log(`ui bundle: ${files.length} sources, ${Buffer.byteLength(app)} bytes — valid classic script`);
