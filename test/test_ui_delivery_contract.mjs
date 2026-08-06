// The firmware must ship the maintainable UI sources as a bounded, deterministic minified gzip
// artefact.  Exercise the same Python step CMake invokes; syntax-check its actual script rather than
// trusting that a smaller byte count still describes executable JavaScript.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { readAppSource } from "../tools/ui/read_app_source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ui-delivery-"));
const input = path.join(work, "index_inlined.html");
const gzipA = path.join(work, "index-a.html.gz");
const gzipB = path.join(work, "index-b.html.gz");
const minifiedPath = path.join(work, "index.min.html");
const budget = 153600;

try {
  const html = fs.readFileSync(path.join(root, "main/www/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "main/www/style.css"), "utf8");
  const app = readAppSource();
  const assembled = html
    .replace("/*@@INLINE:style.css@@*/\n", css)
    .replace("//@@INLINE:app.js@@\n", app);
  assert.notEqual(assembled, html, "test assembly must replace both inline markers");
  fs.writeFileSync(input, assembled);

  const tool = path.join(root, "tools/web_asset/minify_and_gzip.py");
  const run = (output, extra = []) => childProcess.spawnSync("python3", [
    tool, "--input", input, "--output", output,
    "--max-gzip-bytes", String(budget), ...extra,
  ], { cwd: root, encoding: "utf8" });

  const first = run(gzipA, ["--html-output", minifiedPath]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = run(gzipB);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const compressed = fs.readFileSync(gzipA);
  assert.ok(compressed.length <= budget,
    `dashboard gzip ${compressed.length} exceeds ${budget}-byte delivery budget`);
  assert.deepEqual(compressed, fs.readFileSync(gzipB), "gzip output must be deterministic");

  const minified = fs.readFileSync(minifiedPath, "utf8");
  assert.equal(zlib.gunzipSync(compressed).toString("utf8"), minified,
    "checked minified HTML must be the exact compressed payload");
  assert.ok(minified.length < assembled.length * 0.7,
    "CSS/JS syntax minification must remove meaningful source-only weight");

  const script = minified.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, "minified page must retain its one inline script");
  assert.doesNotThrow(() => new vm.Script(script[1], { filename: "index.min.html" }),
    "the JavaScript in the shipped minified page must parse");

  const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
  assert.match(cmake, /set\(UI_GZIP_MAX_BYTES 153600\)/,
    "CMake and the host contract must share the 150 KiB budget");
  assert.match(cmake, /minify_and_gzip\.py[\s\S]*--max-gzip-bytes \$\{UI_GZIP_MAX_BYTES\}/,
    "firmware build must execute the checked minifier and size gate");

  // rJSmin supports only unnested template literals.  The wrapper must preserve their raw text,
  // including the leading spaces in nested translated clauses; syntax-only validation missed this
  // exact regression when " for register" became "for register" in a valid bundle.
  const fixtureInput = path.join(work, "fixture.html");
  const fixtureGzip = path.join(work, "fixture.html.gz");
  const fixture = `<style> .x { color: red; } </style><script>
    const phrase = (r) => \`Request failed\${r ? \` for register \${r}\` : ""}.\`;
    this.fixtureResult = [phrase(7), phrase(0)];
  </script>`;
  fs.writeFileSync(fixtureInput, fixture);
  const fixtureRun = childProcess.spawnSync("python3", [
    tool, "--input", fixtureInput, "--output", fixtureGzip,
    "--max-gzip-bytes", String(budget),
  ], { cwd: root, encoding: "utf8" });
  assert.equal(fixtureRun.status, 0, fixtureRun.stderr || fixtureRun.stdout);
  const fixtureMin = zlib.gunzipSync(fs.readFileSync(fixtureGzip)).toString("utf8");
  const fixtureScript = fixtureMin.match(/<script>([\s\S]*?)<\/script>/);
  const fixtureContext = {};
  vm.createContext(fixtureContext);
  vm.runInContext(fixtureScript[1], fixtureContext);
  assert.deepEqual(Array.from(fixtureContext.fixtureResult),
    ["Request failed for register 7.", "Request failed."],
    "nested template literal text must remain byte-for-byte meaningful after minification");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("UI delivery contract passed");
