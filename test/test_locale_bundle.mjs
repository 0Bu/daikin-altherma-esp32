// Execute the production offline producer and served registration code against the original
// catalogs. The optional browser pass checks script.onload, CSP and transport behavior in Chrome.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = readAppFragments(["i18n.js"]);
const languages = JSON.parse(base.match(/const UI_LANGS = Object.freeze\((\[[^\n]+\])\)/)[1]);
const locales = languages.filter(code => code !== "en");
const registries = ["I18N", "INSPECT_I18N", "HOMEHUB_LABEL_I18N", "DESCRIPTION_I18N",
  "MODEL_DESCRIPTION_I18N", "FAULT_CODE_I18N", "MB_DELTA_I18N"];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-locale-bundle-"));
const producer = path.join(root, "tools/web_asset/build_locale_bundle.py");
const output = path.join(work, "locale-bundle.js.gz");
const metadata = path.join(work, "locale-bundle.json");
const args = [producer, "--locale-dir", path.join(root, "main/www/locales"), "--locales", ...locales,
  "--output", output, "--metadata", metadata];
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function python(arguments_) {
  return spawnSync("python3", arguments_, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}
const fixtureCode = String.raw`
import base64,json,shutil,sys,tempfile,zlib
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'tools/web_asset'))
import build_locale_bundle as b
codes=sys.argv[2:]
sources=[b.minify_javascript((Path(sys.argv[1])/'main/www/locales'/f'{c}.js').read_text(encoding='utf-8')) for c in codes]
newline=bytes([10])
source=b'(()=>{'+newline+(b';'+newline).join(x.encode() for x in sources)+newline+b'})();'
decoder,license,_=b.load_decoder()
with tempfile.TemporaryDirectory(prefix='daikin-locale-pin-') as temporary:
    copied=Path(temporary)
    for name in ['UPSTREAM.json','LICENSE','lzma-d.js','lzma-d-min.js']:
        shutil.copyfile(b.VENDOR/name,copied/name)
    (copied/'lzma-d-min.js').write_bytes((copied/'lzma-d-min.js').read_bytes()+b' ')
    try:
        b.load_decoder(copied)
        raise AssertionError('modified decoder accepted')
    except ValueError:
        pass
crc=zlib.crc32(source)
frame=b.PREFIX+source
packed=b.encode_frame(frame)
cases={}
def add(name,frame,expected_size=len(source),expected_crc=crc):
    cases[name]=b.render_wrapper(b.encode_frame(frame),expected_size,expected_crc,decoder,license)
add('prefix',bytes([255,76,90,77,66,1])+source)
add('version',b.PREFIX[:-1]+bytes([2])+source)
longer=packed[:5]+(len(frame)+1).to_bytes(8,'little')+packed[13:]
cases['length']=b.render_wrapper(longer,len(source)+1,crc,decoder,license)
add('type',b'XXXXXX'+source)
add('crc',frame,expected_crc=crc^1)
invalid=bytes([255])+source[1:]
add('utf8',b.PREFIX+invalid,expected_crc=zlib.crc32(invalid))
cases['property']=b.render_wrapper(bytes([255])+packed[1:],len(source),crc,decoder,license)
dictionary=packed[:1]+(1<<31).to_bytes(4,'little')+packed[5:]
cases['dictionary']=b.render_wrapper(dictionary,len(source),crc,decoder,license)
size=packed[:5]+(1<<40).to_bytes(8,'little')+packed[13:]
cases['size']=b.render_wrapper(size,len(source),crc,decoder,license)
unknown=packed[:5]+bytes([255])*8+packed[13:]
cases['unknown-size']=b.render_wrapper(unknown,len(source),crc,decoder,license)
cases['short-header']=b.render_wrapper(packed[:12],len(source),crc,decoder,license)
damaged=bytearray(packed);damaged[len(damaged)//2]^=1
cases['stream']=b.render_wrapper(bytes(damaged),len(source),crc,decoder,license)
sample='😀 日本語 简体中文 Україна é'+chr(0)+'end'
unicode_source=('globalThis.__localeUnicode='+json.dumps(sample,ensure_ascii=False)+';').encode()+newline+source
cases['unicode']=b.render_wrapper(b.encode_frame(b.PREFIX+unicode_source),len(unicode_source),zlib.crc32(unicode_source),decoder,license)
print(json.dumps({'sources':sources,'payload_b64':base64.b64encode(source).decode(),'cases':cases,'unicode':sample},ensure_ascii=False))
`;

function context() {
  let sandbox;
  const document = {
    getElementById: () => null,
    createElement: () => ({ textContent: "", remove() {} }),
    head: { append(script) {
      sandbox.registrations++;
      vm.runInContext(script.textContent, sandbox, { timeout: 10000 });
    } },
  };
  const sentinel = () => {};
  sandbox = vm.createContext({ document, navigator: { language: "en" },
    localStorage: { getItem: () => "en", setItem() {} }, TextEncoder, TextDecoder,
    setTimeout, setImmediate, atob, registrations: 0, onmessage: sentinel,
    LZMA: sentinel, LZMA_WORKER: sentinel });
  sandbox.window = sandbox;
  sandbox.sentinel = sentinel;
  vm.runInContext(base, sandbox);
  return sandbox;
}

const probeArguments = [[], [0], [1], [2], [4], [5], [11], [12], [14], [21], [22], [101],
  [102], [112], [-1], [1.5], ["x"], [null], [undefined], Array(12).fill(0),
  Array(12).fill(1), Array(12).fill("x")];
function snapshot(sandbox) {
  const values = vm.runInContext(`({${registries.join(",")}})`, sandbox);
  function normalize(value) {
    if (typeof value === "function") return { source: String(value), arity: value.length,
      probes: probeArguments.map(args => {
        try { return { value: value(...args) }; }
        catch (error) { return { error: `${error.name}:${error.message}` }; }
      }) };
    if (Array.isArray(value)) return { array: Array.from(value, normalize), frozen: Object.isFrozen(value) };
    if (value && typeof value === "object") return { object: Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)])),
    frozen: Object.isFrozen(value) };
    return value;
  }
  return sha(JSON.stringify(normalize(values)));
}

async function browserChecks(packet, wrapper, fixtures, baselineSources) {
  const { launchBrowser } = await import("../tools/browser/cdp_browser.mjs");
  const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'";
  let mode = "plain";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy });
      response.end(`<!doctype html><meta charset="utf-8"><script src="/base.js"></script><script>
        window.__sentinel=function(){};window.onmessage=__sentinel;window.LZMA=__sentinel;window.LZMA_WORKER=__sentinel;
        window.__registrations=0;window.__decoderConstructions=0;const append=document.head.append.bind(document.head);
        document.head.append=(...nodes)=>{for(const node of nodes)if(node.tagName==='SCRIPT'&&!node.src)__registrations++;return append(...nodes)};
        </script>`);
      return;
    }
    if (url.pathname === "/base.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(`Object.defineProperty(navigator,'language',{get:()=>'en'});${base}`); return;
    }
    if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (url.pathname === "/locale.js") {
      const lang = url.searchParams.get("lang");
      if (!locales.includes(lang)) { response.writeHead(404); response.end(); return; }
      let body = mode === "plain" ? gzipSync(baselineSources[locales.indexOf(lang)])
        : mode === "bundle" || mode === "gzip-crc" ? Buffer.from(packet) : gzipSync(fixtures.cases[mode]
          .replace("const decoder=(function()", "window.__decoderConstructions++;const decoder=(function()"));
      if (mode === "gzip-crc") body[body.length - 8] ^= 1;
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8",
        "Content-Encoding": "gzip", "Cache-Control": "no-store" }); response.end(body); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launchBrowser(); const page = browser.page;
    const url = `http://127.0.0.1:${server.address().port}/`;
    const capture = `(() => {
      const args=${JSON.stringify(probeArguments.map(a => a.map(v => v === undefined ? null : v)))};
      const map=v=>typeof v==='function'?{source:String(v),probes:args.map(a=>{try{return{value:v(...a)}}catch(e){return{error:e.name+':'+e.message}}})}
        :Array.isArray(v)?{array:v.map(map),frozen:Object.isFrozen(v)}:v&&typeof v==='object'?{object:Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,map(x)])),frozen:Object.isFrozen(v)}:v;
      return JSON.stringify(map({${registries.join(",")}}));})()`;
    const expected = {};
    async function fresh() {
      page.diagnostics.length = 0; await page.navigate(url);
      await page.waitFor("typeof localeReady==='function'&&window.__sentinel");
    }
    await fresh();
    await page.evaluate(`Promise.all(${JSON.stringify(locales)}.map(loadLocale))`);
    expected.hash = sha(await page.evaluate(capture));
    assert.deepEqual(page.diagnostics, []);
    mode = "bundle"; await fresh();
    assert.ok((await page.evaluate("Promise.all([loadLocale('de'),loadLocale('fr')])")).every(Boolean));
    assert.equal(await page.evaluate("window.__registrations"), 1);
    await page.evaluate(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/locale.js?lang=pl';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})`);
    assert.equal(await page.evaluate("window.__registrations"), 1);
    assert.equal(sha(await page.evaluate(capture)), expected.hash);
    assert.equal(await page.evaluate("window.onmessage===__sentinel&&window.LZMA===__sentinel&&window.LZMA_WORKER===__sentinel"), true);
    assert.deepEqual(page.diagnostics, []);
    for (const key of ["property", "dictionary", "size", "unknown-size", "short-header", "stream",
      "prefix", "version", "length", "type", "crc", "utf8"]) {
      mode = key; await fresh();
      assert.ok((await page.evaluate("Promise.all([loadLocale('de'),loadLocale('fr')])")).every(v => v === false));
      assert.equal(await page.evaluate("window.__registrations"), 0, `${key} must fail before registration`);
      assert.equal(await page.evaluate("window.__decoderConstructions"),
        ["property", "dictionary", "size", "unknown-size", "short-header"].includes(key) ? 0 : 2,
        `${key}: invalid headers must not instantiate a decoder`);
      assert.equal(await page.evaluate("UI_LANGS.filter(x=>x!=='en'&&localeReady(x)).length"), 0);
      assert.equal(await page.evaluate("window.onmessage===__sentinel&&window.LZMA===__sentinel&&window.LZMA_WORKER===__sentinel"), true);
    }
    mode = "gzip-crc"; await fresh();
    const crcResults = await page.evaluate("Promise.all([loadLocale('de'),loadLocale('fr')])");
    if (crcResults.some(Boolean)) assert.equal(sha(await page.evaluate(capture)), expected.hash);
    // Chromium can accept a damaged gzip footer. The explicit decoded CRC is the integrity check.
    console.log(`locale bundle browser: ${browser.product}; CSP, concurrent/repeated loads, globals and malformed inputs pass; gzip footer accepted=${crcResults.some(Boolean)}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
}

try {
  const built = python(args); assert.equal(built.status, 0, built.stderr || built.stdout);
  const packet = fs.readFileSync(output), wrapper = gunzipSync(packet).toString("utf8");
  const info = JSON.parse(fs.readFileSync(metadata, "utf8"));
  assert.equal(info.dictionary_bytes, 524288); assert.equal(info.preset, 6);
  assert.deepEqual(info.locales, locales); assert.ok(packet.length <= 289792);
  assert.ok(info.sources.every(item => item.source_gzip_bytes <= 32768));
  assert.equal(sha(packet), info.bundle_sha256);
  const license = fs.readFileSync(path.join(root, "tools/web_asset/vendor/lzma-js/LICENSE"), "utf8");
  assert.ok(wrapper.includes(license), "the complete upstream license must remain in served bytes");
  assert.doesNotMatch(wrapper, /\b(?:eval|Function|Blob)\s*\(/);
  const fixtureRun = python(["-c", fixtureCode, root, ...locales]);
  assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
  const fixtures = JSON.parse(fixtureRun.stdout);
  const expectedBytes = Buffer.from(fixtures.payload_b64, "base64");
  assert.equal(sha(expectedBytes), info.decoded_source_sha256);
  const decoderSource = fs.readFileSync(path.join(root, "tools/web_asset/vendor/lzma-js/lzma-d-min.js"), "utf8");
  const decoderContext = context();
  const decoder = vm.runInContext(`(function(){${decoderSource};return this.LZMA}).call({})`, decoderContext);
  const literal = wrapper.match(/atob\(("[A-Za-z0-9+/=]+")\)/)?.[1];
  assert.ok(literal, "the served bytes must contain their exact offline payload");
  const framed = Uint8Array.from(decoder.decompress(Buffer.from(JSON.parse(literal), "base64")));
  const encodedFrame = Buffer.from(JSON.parse(literal), "base64");
  assert.equal(encodedFrame[0], 0x5d);
  assert.equal(encodedFrame.readUInt32LE(1), 524288);
  assert.equal(encodedFrame.readBigUInt64LE(5), BigInt(info.framed_bytes));
  assert.deepEqual(Array.from(framed.subarray(0, 6)), [255, 76, 90, 77, 65, 1]);
  assert.deepEqual(Buffer.from(framed.subarray(6)), expectedBytes);
  const original = context();
  for (const source of fixtures.sources) vm.runInContext(source, original);
  const expected = snapshot(original);
  const bundled = context(); vm.runInContext(wrapper, bundled, { timeout: 10000 });
  assert.equal(snapshot(bundled), expected, "all locale values, formatter probes and freeze contracts must match");
  assert.equal(bundled.registrations, 1);
  vm.runInContext(wrapper, bundled, { timeout: 10000 }); assert.equal(bundled.registrations, 1);
  assert.equal(snapshot(bundled), expected);
  assert.equal(bundled.onmessage, bundled.sentinel); assert.equal(bundled.LZMA, bundled.sentinel);
  assert.equal(bundled.LZMA_WORKER, bundled.sentinel);
  const headerCases = ["property", "dictionary", "size", "unknown-size", "short-header"];
  for (const key of [...headerCases, "stream", "prefix", "version", "length", "type", "crc", "utf8"]) {
    const bad = context();
    const observed = fixtures.cases[key].replace("const decoder=(function()",
      "globalThis.__decoderConstructions=(globalThis.__decoderConstructions||0)+1;const decoder=(function()");
    assert.throws(() => vm.runInContext(observed, bad, { timeout: 10000 }),
      /corrupted input|locale LZMA header|locale payload|encoded data/, key);
    assert.equal(bad.__decoderConstructions || 0, headerCases.includes(key) ? 0 : 1,
      `${key}: header refusals must precede decoder allocation`);
    assert.equal(bad.registrations, 0, `${key} must fail before registration`);
    assert.equal(vm.runInContext("UI_LANGS.filter(x=>x!=='en'&&localeReady(x)).length", bad), 0);
    assert.equal(bad.onmessage, bad.sentinel); assert.equal(bad.LZMA, bad.sentinel);
  }
  const unicode = context(); vm.runInContext(fixtures.cases.unicode, unicode, { timeout: 10000 });
  assert.equal(unicode.__localeUnicode, fixtures.unicode); assert.equal(unicode.registrations, 1);
  const damaged = Buffer.from(packet); damaged[damaged.length - 8] ^= 1;
  assert.throws(() => gunzipSync(damaged), /incorrect data check/);
  const again = python(args); assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(fs.readFileSync(output), packet, "the complete producer must be deterministic");
  fs.writeFileSync(output, "keep");
  const limited = python([...args, "--max-gzip-bytes", "1"]);
  assert.notEqual(limited.status, 0); assert.equal(fs.readFileSync(output, "utf8"), "keep");
  const raised = python([...args, "--max-gzip-bytes", "289793"]); assert.notEqual(raised.status, 0);
  const sourceRaised = python([...args, "--source-max-gzip-bytes", "32769"]);
  assert.notEqual(sourceRaised.status, 0);
  const sourceLimited = python([...args, "--source-max-gzip-bytes", "1"]);
  assert.notEqual(sourceLimited.status, 0);
  const omitted = python([producer, "--locale-dir", path.join(root, "main/www/locales"),
    "--locales", ...locales.slice(1), "--output", output]);
  assert.notEqual(omitted.status, 0, "an omitted source locale must stop the build");
  if (process.argv.includes("--browser")) await browserChecks(packet, wrapper, fixtures, fixtures.sources);
  console.log(`locale bundle: ${locales.length} catalogs, ${packet.length} bytes; exact formatters, binary framing, integrity, Unicode, isolation and single registration verified`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
