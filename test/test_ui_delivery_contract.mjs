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
const budget = 163840;

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

  // Comment stripping must cover all THREE languages.  It covered only the two inline assets until
  // the markup shell was measured: index.html is spliced in raw, so its load-bearing drawing and
  // layout commentary was compressed into the image and served to every browser — 39 KB of source,
  // 14 KB gzipped, 9.5% of this budget, spent on text no client can read.  Nothing failed; the page
  // rendered perfectly and the budget simply drained.  Assert the SOURCE still has comments too, so
  // a future index.html that happens to carry none cannot make this pass vacuously.
  assert.ok(/<!--/.test(html), "index.html must still keep its source comments (this test's premise)");
  const shellOnly = minified
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<script>[\s\S]*?<\/script>/, "");
  assert.ok(!/<!--/.test(shellOnly),
    "shipped markup must carry no HTML comments — the source keeps them, the artefact must not");

  const cmake = fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8");
  assert.match(cmake, /set\(UI_GZIP_MAX_BYTES 163840\)/,
    "CMake and the host contract must share the 160 KiB budget");
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

  // Markup stripping deletes bytes from the page, so its refusals matter more than its yield: a
  // wrongly-stripped page still parses and still renders, and shows the loss only where the
  // markup used to be.  Exercise each guard on a fixture rather than trusting that today's
  // index.html happens not to contain the shapes.
  const markupCase = (name, body) => {
    const src = path.join(work, `${name}.html`);
    const gz = path.join(work, `${name}.html.gz`);
    fs.writeFileSync(src, body);
    const proc = childProcess.spawnSync("python3", [
      tool, "--input", src, "--output", gz, "--max-gzip-bytes", String(budget),
    ], { cwd: root, encoding: "utf8" });
    return {
      status: proc.status,
      stderr: proc.stderr,
      page: proc.status === 0 ? zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8") : "",
    };
  };
  const assets = "<style> .x { color: red; } </style><script>var a=1;</script>";

  const stripped = markupCase("markup-strip",
    `<div id="keep"><!-- explanatory note --><span>text</span></div>${assets}`);
  assert.equal(stripped.status, 0, stripped.stderr);
  assert.ok(!stripped.page.includes("explanatory note"), "markup comments must be stripped");
  assert.ok(stripped.page.includes('<div id="keep">') && stripped.page.includes("<span>text</span>"),
    "stripping a comment must leave the markup around it untouched");

  // A `<!--` inside a raw-text element is character data the browser PRINTS.  index.html has two
  // such elements (the bug-report textareas); treating one as a comment would silently delete
  // everything up to the next `-->`.
  const rawText = markupCase("markup-rawtext",
    `<textarea id="t">a <!-- literal --> b</textarea><!-- real --><p>after</p>${assets}`);
  assert.equal(rawText.status, 0, rawText.stderr);
  assert.ok(rawText.page.includes("a <!-- literal --> b"),
    "text inside a raw-text element must survive markup stripping verbatim");
  assert.ok(!rawText.page.includes("<!-- real -->") && rawText.page.includes("<p>after</p>"),
    "a genuine comment beside a protected element must still go");

  // An unterminated comment would match to end-of-document and take real markup with it.
  const unterminated = markupCase("markup-unterminated",
    `<div><!-- never closed <p>content</p></div>${assets}`);
  assert.notEqual(unterminated.status, 0, "an unterminated markup comment must fail the build");
  assert.match(unterminated.stderr, /unterminated comment would swallow real markup/);

  // A conditional comment carries markup, not commentary — removing it deletes content.
  const conditional = markupCase("markup-conditional",
    `<div><!--[if IE]><p>legacy</p><![endif]--></div>${assets}`);
  assert.notEqual(conditional.status, 0, "a conditional comment must fail the build");
  assert.match(conditional.stderr, /conditional comment/);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("UI delivery contract passed");
