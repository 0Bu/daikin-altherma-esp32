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
  const tuned = run(gzipB, ["--gzip-memory-level", "7"]);
  assert.equal(tuned.status, 0, tuned.stderr || tuned.stdout);
  const tunedBytes = fs.readFileSync(gzipB);
  assert.deepEqual(zlib.gunzipSync(tunedBytes), zlib.gunzipSync(compressed),
    "firmware compression tuning must preserve every decoded page byte");
  assert.equal(tunedBytes[9], 255, "tuned gzip must use deterministic host-independent metadata");
  const tunedRepeat = run(gzipB, ["--gzip-memory-level", "7"]);
  assert.equal(tunedRepeat.status, 0, tunedRepeat.stderr || tunedRepeat.stdout);
  assert.deepEqual(fs.readFileSync(gzipB), tunedBytes, "tuned gzip must remain deterministic");
  assert.match(fs.readFileSync(path.join(root, "main/CMakeLists.txt"), "utf8"),
    /--output "\$\{CMAKE_CURRENT_BINARY_DIR\}\/index\.html\.gz"\s+--gzip-memory-level 7/,
    "the tested compression parameter must be the firmware build parameter");
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
  const status = fs.readFileSync(path.join(root, "main/http_status.cpp"), "utf8");
  const common = fs.readFileSync(path.join(root, "main/http_common.cpp"), "utf8");
  assert.match(status,
    /http_send_gzip\(req,\s*"text\/html",\s*index_html_gz_start,\s*index_html_gz_end\)/,
    "the dashboard route must serve the checked gzip artifact");
  assert.match(common,
    /http_send_gzip[\s\S]*httpd_resp_set_hdr\(req, "Content-Encoding", "gzip"\)/,
    "the gzip sender must declare the matching HTTP content encoding");

  // Test the other shipped pages through the actual minifier too. Execute the setup form's
  // credential and server-rejection paths, and reuse every MCP clipboard interleaving control
  // against the shipped script, so a parseable but behavior-changing reduction cannot pass.
  const setupSource = fs.readFileSync(path.join(root, "main/www/setup.html"), "utf8");
  const mcpSource = fs.readFileSync(path.join(root, "main/www/mcp_dashboard.html"), "utf8")
    .replace("/*@@INLINE:style.css@@*/\n", fs.readFileSync(path.join(root, "main/www/mcp_dashboard.css"), "utf8"))
    .replace("//@@INLINE:app.js@@\n", fs.readFileSync(path.join(root, "main/www/mcp_dashboard.js"), "utf8"));
  const shipped = {};
  for (const [name, source, cap] of [["setup", setupSource, 4096], ["mcp", mcpSource, 8192]]) {
    const src = path.join(work, `${name}.html`);
    const gz = path.join(work, `${name}.html.gz`);
    fs.writeFileSync(src, source);
    const reduced = childProcess.spawnSync("python3", [tool, "--input", src, "--output", gz,
      "--max-gzip-bytes", String(cap)], { cwd: root, encoding: "utf8" });
    assert.equal(reduced.status, 0, reduced.stderr || reduced.stdout);
    shipped[name] = zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8");
    assert.doesNotThrow(() => new vm.Script(shipped[name].match(/<script>([\s\S]*?)<\/script>/)[1]));
    assert.match(cmake, new RegExp(`--output "\\$\\{CMAKE_CURRENT_BINARY_DIR\\}/${name}\\.html\\.gz"\\s+--max-gzip-bytes ${cap}`));
  }
  const mcpPath = path.join(work, "mcp.min.html");
  fs.writeFileSync(mcpPath, shipped.mcp);
  const mcpControls = childProcess.spawnSync(process.execPath, ["test/test_mcp_dashboard.mjs"], {
    cwd: root, encoding: "utf8", env: { ...process.env, DAIKIN_MCP_PAGE: mcpPath },
  });
  assert.equal(mcpControls.status, 0, mcpControls.stderr || mcpControls.stdout);

  for (const [ssid, pass, reply, expected, posts] of [
    ["", "", null, "Enter a network name", 0],
    ["test network", "short", null, "Password must be empty", 0],
    ["  test network  ", "test-password", { status: 400, ok: false, text: async () => '{"error":"Rejected by server"}' }, "Rejected by server", 1],
    ["test network", "test-password", { status: 503 }, "Device busy", 1],
    ["  test network  ", "", { status: 200, ok: true }, "Saved — rebooting", 1],
  ]) {
    let submit;
    const requests = [];
    const nodes = Object.fromEntries(["f", "btn", "msg", "ssid", "pass"].map(id => [id, {
      value: id === "ssid" ? ssid : id === "pass" ? pass : "", textContent: "", disabled: false,
      addEventListener(type, handler) { assert.equal(type, "submit"); submit = handler; },
    }]));
    const context = vm.createContext({ document: { getElementById: id => nodes[id] },
      fetch: async (url, options) => { requests.push({ url, options }); return reply; } });
    vm.runInContext(shipped.setup.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    await submit({ preventDefault() {} });
    assert.equal(requests.length, posts);
    assert.ok(nodes.msg.textContent.includes(expected), nodes.msg.textContent);
    if (posts) {
      assert.equal(requests[0].url, "/set_wifi");
      assert.deepEqual(JSON.parse(requests[0].options.body), { ssid, pass }, "opaque SSID/password bytes survive minification");
      if (!reply.ok) assert.equal(nodes.btn.disabled, false, "rejected writes allow retry");
    }
  }

  const iconSource = fs.readFileSync(path.join(root, "main/www/favicon.ico"));
  const iconGzip = childProcess.spawnSync("gzip", ["-9", "-n", "-c", path.join(root, "main/www/favicon.ico")]);
  assert.equal(iconGzip.status, 0, iconGzip.stderr?.toString());
  assert.deepEqual(zlib.gunzipSync(iconGzip.stdout), iconSource, "HTTP-decoded icon retains every original byte");
  assert.ok(iconGzip.stdout.length < iconSource.length, "compressing the icon must actually reduce its flash footprint");
  assert.match(cmake, /"\$\{CMAKE_CURRENT_BINARY_DIR\}\/favicon\.ico\.gz"/);
  assert.match(status, /http_send_gzip\(req,\s*"image\/vnd\.microsoft\.icon",\s*favicon_ico_gz_start,\s*favicon_ico_gz_end\)/);

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
