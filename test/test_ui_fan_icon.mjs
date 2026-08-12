// Contract test for the static dashboard brand icon: it must use the supplied three-blade raster
// silhouette at a readable header size, while the schematic keeps its own live fan animation.
import assert from "node:assert/strict";
import fs from "node:fs";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const bootstrap = readAppFragments(["bootstrap.js"]);
const demoBuilder = fs.readFileSync(new URL("../tools/uigif/build_demo.py", import.meta.url), "utf8");
const installer = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
const pagesBuilder = fs.readFileSync(new URL("../scripts/build-pages.sh", import.meta.url), "utf8");
const raster = new URL("../main/www/heat_pump_icon.png", import.meta.url);

assert.ok(fs.statSync(raster).size > 0, "the source-faithful fan raster must ship with the UI");
assert.match(html,
             /<img class="logo md" id="appIcon" src="\/heat-pump-icon\.png" alt="" aria-hidden="true">/,
             "the header must request the dedicated heat-pump brand mark");
assert.match(css, /\.logo\.md\s*\{\s*width:\s*48px;\s*height:\s*48px;/,
             "the brand mark must remain large enough beside the device name");
assert.doesNotMatch(html, /id="appFan"|<use href="#scFan"/,
                    "the static brand icon must not duplicate or borrow the live schematic rotor");
assert.doesNotMatch(css, /#appFan|\.fan-on #appFan/,
                    "the static brand icon must not receive live fan animation");
assert.match(css, /\.fan-on #scFan\s*\{\s*animation:\s*spin 2\.6s linear infinite;/,
             "the outdoor-unit schematic must retain its live fan animation");
assert.doesNotMatch(bootstrap, /syncAppFan|MutationObserver\(syncAppFan\)/,
                    "the static brand icon must not mirror telemetry state");
assert.match(demoBuilder, /out\.parent \/ "heat-pump-icon\.png"/,
             "the recording harness must copy the underscored source asset to the hyphenated UI URL");
assert.match(installer,
             /<img class="installer-logo" src="\.\/heat-pump-icon\.png" alt="" aria-hidden="true">/,
             "the browser installer must use the firmware dashboard's canonical fan mark");
assert.match(pagesBuilder,
             /cp main\/www\/heat_pump_icon\.png "\$OUT\/heat-pump-icon\.png"/,
             "the Pages build must publish the exact firmware icon instead of another drawing");

console.log("ui fan icon: static brand raster and live schematic fan verified");
