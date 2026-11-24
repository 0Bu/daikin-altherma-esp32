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
const languages = JSON.parse(base.match(/const UI_LANGS = Object\.freeze\((\[[^\n]+\])\)/)[1]);
const locales = languages.filter(code => code !== "en");
const registries = ["I18N", "INSPECT_I18N", "HOMEHUB_LABEL_I18N", "DESCRIPTION_I18N",
  "MODEL_DESCRIPTION_I18N", "FAULT_CODE_I18N", "MB_DELTA_I18N"];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-locale-bundle-"));
const producer = path.join(root, "tools/web_asset/build_locale_bundle.py");
const packDir = path.join(work, "packs");
const tagHeader = path.join(work, "locale_asset_tag.hpp");
const metadata = path.join(work, "locale-packs.json");
const args = [producer, "--locale-dir", path.join(root, "main/www/locales"), "--locales", ...locales,
  "--output-dir", packDir, "--tag-header", tagHeader, "--metadata", metadata];
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function python(arguments_) {
  return spawnSync("python3", arguments_, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}
const fixtureCode = String.raw`
import base64,json,sys,zlib
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'tools/web_asset'))
import build_locale_bundle as b
codes=sys.argv[2:]
sources={c:b.minify_javascript((Path(sys.argv[1])/'main/www/locales'/f'{c}.js').read_text(encoding='utf-8')) for c in codes}
romance=['es','fr','it']
newline=bytes([10])
source=b'(()=>{'+newline+(b';'+newline).join(sources[c].encode() for c in romance)+newline+b'})();'
decoder=b.load_decoder()
crc=zlib.crc32(source)
frame=b.PREFIX+source
packed=b.encode_frame(frame)
cases={}
def add(name,frame,expected_size=len(source),expected_crc=crc):
    cases[name]=b.render_wrapper(b.encode_frame(frame),expected_size,expected_crc,decoder,pack_name='romance',codes=tuple(romance))
add('prefix',bytes([255,76,90,77,66,1])+source)
add('version',b.PREFIX[:-1]+bytes([2])+source)
longer=packed[:5]+(len(frame)+1).to_bytes(8,'little')+packed[13:]
cases['length']=b.render_wrapper(longer,len(source)+1,crc,decoder,pack_name='romance',codes=tuple(romance))
add('type',b'XXXXXX'+source)
add('crc',frame,expected_crc=crc^1)
invalid=bytes([255])+source[1:]
add('utf8',b.PREFIX+invalid,expected_crc=zlib.crc32(invalid))
cases['property']=b.render_wrapper(bytes([255])+packed[1:],len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
dictionary=packed[:1]+(1<<31).to_bytes(4,'little')+packed[5:]
cases['dictionary']=b.render_wrapper(dictionary,len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
size=packed[:5]+(1<<40).to_bytes(8,'little')+packed[13:]
cases['size']=b.render_wrapper(size,len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
unknown=packed[:5]+bytes([255])*8+packed[13:]
cases['unknown-size']=b.render_wrapper(unknown,len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
cases['short-header']=b.render_wrapper(packed[:12],len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
damaged=bytearray(packed);damaged[len(damaged)//2]^=1
cases['stream']=b.render_wrapper(bytes(damaged),len(source),crc,decoder,pack_name='romance',codes=tuple(romance))
sample='😀 日本語 简体中文 Україна é'+chr(0)+'end'
unicode_source=('globalThis.__localeUnicode='+json.dumps(sample,ensure_ascii=False)+';').encode()+newline+source
cases['unicode']=b.render_wrapper(b.encode_frame(b.PREFIX+unicode_source),len(unicode_source),zlib.crc32(unicode_source),decoder,pack_name='romance',codes=tuple(romance))
print(json.dumps({'sources':[sources[c] for c in codes],'payload_b64':base64.b64encode(source).decode(),'packed_b64':base64.b64encode(packed).decode(),'cases':cases,'unicode':sample},ensure_ascii=False))
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

async function browserChecks(packsByCode, fixtures, baselineSources) {
  const { launchBrowser } = await import("../tools/browser/cdp_browser.mjs");
  const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'";
  let mode = "plain";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy });
      response.end(`<!doctype html><meta charset="utf-8"><script src="/base.js"></script><script>
        window.__sentinel=function(){};window.onmessage=__sentinel;window.LZMA=__sentinel;window.LZMA_WORKER=__sentinel;
        window.__registrations=0;window.__decoderCalls=0;const append=document.head.append.bind(document.head);
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
        : mode === "bundle" || mode === "gzip-crc" ? Buffer.from(packsByCode.get(lang)) : gzipSync(fixtures.cases[mode]
          .replace("const all=lzma1Decompress(", "window.__decoderCalls++;const all=lzma1Decompress("));
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
    assert.ok((await page.evaluate("Promise.all(['de','es','fr','pl','nb','zh'].map(loadLocale))")).every(Boolean));
    assert.equal(await page.evaluate("window.__registrations"), 4, "4 LZMA cognate packs inject one script each; de runs inline");
    await page.evaluate(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/locale.js?lang=it';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})`);
    assert.equal(await page.evaluate("window.__registrations"), 4, "re-loading an already-ready cognate pack must stay idempotent");
    assert.equal(sha(await page.evaluate(capture)), expected.hash);
    assert.equal(await page.evaluate("window.onmessage===__sentinel&&window.LZMA===__sentinel&&window.LZMA_WORKER===__sentinel"), true);
    assert.deepEqual(page.diagnostics, []);
    for (const key of ["property", "dictionary", "size", "unknown-size", "short-header", "stream",
      "prefix", "version", "length", "type", "crc", "utf8"]) {
      mode = key; await fresh();
      assert.ok((await page.evaluate("Promise.all([loadLocale('es'),loadLocale('fr')])")).every(v => v === false));
      assert.equal(await page.evaluate("window.__registrations"), 0, `${key} must fail before registration`);
      assert.equal(await page.evaluate("window.__decoderCalls"),
        ["property", "dictionary", "size", "unknown-size", "short-header"].includes(key) ? 0 : 2,
        `${key}: invalid headers must not invoke the decoder`);
      assert.equal(await page.evaluate("UI_LANGS.filter(x=>x!=='en'&&localeReady(x)).length"), 0);
      assert.equal(await page.evaluate("window.onmessage===__sentinel&&window.LZMA===__sentinel&&window.LZMA_WORKER===__sentinel"), true);
    }
    mode = "gzip-crc"; await fresh();
    const crcResults = await page.evaluate("Promise.all([loadLocale('es'),loadLocale('fr')])");
    if (crcResults.some(Boolean)) {
      await page.evaluate("Promise.all(['de','pl','nb','zh'].map(loadLocale))");
    }
    // Chromium can accept a damaged gzip footer. The explicit decoded CRC is the integrity check.
    console.log(`locale packs browser: ${browser.product}; CSP, concurrent/repeated loads, globals and malformed inputs pass; gzip footer accepted=${crcResults.some(Boolean)}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
}

try {
  const built = python(args); assert.equal(built.status, 0, built.stderr || built.stdout);
  const info = JSON.parse(fs.readFileSync(metadata, "utf8"));
  assert.equal(info.dictionary_bytes, 524288); assert.equal(info.preset, 6);
  assert.deepEqual(info.locales, locales);
  assert.match(info.locale_asset_tag, /^[0-9a-f]{8}$/);
  assert.ok(info.total_gzip_bytes <= 296960, `total locale packs ${info.total_gzip_bytes} exceeds 296960`);
  assert.ok(info.sources.every(item => item.source_gzip_bytes <= 32768));
  assert.equal(info.packs.length, 5);
  const headerText = fs.readFileSync(tagHeader, "utf8");
  assert.ok(headerText.includes(`inline constexpr char LOCALE_ASSET_TAG[] = "${info.locale_asset_tag}";`),
    "generated header must carry the exact deterministic locale asset tag");

  const decoderSource = fs.readFileSync(path.join(root, "tools/web_asset/lzma1_decoder.js"), "utf8");
  const decoderContext = context();
  vm.runInContext(decoderSource, decoderContext);
  const ContextUint8Array = vm.runInContext("Uint8Array", decoderContext);
  const lzma1Decompress = decoderContext.lzma1Decompress;
  assert.equal(typeof lzma1Decompress, "function");

  const packsByName = new Map();
  const packsByCode = new Map();
  const bundled = context();
  for (const packInfo of info.packs) {
    const packet = fs.readFileSync(path.join(packDir, `locale-${packInfo.name}.js.gz`));
    assert.equal(packet.length, packInfo.pack_gzip_bytes);
    assert.equal(sha(packet), packInfo.pack_sha256);
    const wrapper = gunzipSync(packet).toString("utf8");
    assert.doesNotMatch(wrapper, /\b(?:eval|Function|Blob)\s*\(/);
    packsByName.set(packInfo.name, { packet, wrapper, info: packInfo });
    for (const code of packInfo.locales) packsByCode.set(code, packet);

    const isolated = context();
    if (packInfo.name === "de") {
      assert.equal(packInfo.encoding, "gzip");
      assert.doesNotMatch(wrapper, /lzma1Decompress|atob\(/);
      vm.runInContext(wrapper, isolated, { timeout: 10000 });
      assert.equal(isolated.registrations, 0, "de runs directly without secondary script injection");
      assert.equal(vm.runInContext("localeReady('de')", isolated), true);
      vm.runInContext(wrapper, isolated, { timeout: 10000 });
      assert.equal(isolated.registrations, 0);
    } else {
      assert.equal(packInfo.encoding, "lzma+gzip");
      const literal = wrapper.match(/atob\("([A-Za-z0-9+/=]+)"\)/)?.[1];
      assert.ok(literal, `${packInfo.name} must contain its exact offline payload`);
      const encodedFrame = Buffer.from(literal, "base64");
      assert.equal(encodedFrame[0], 3, "LZMA header pins lc=3, lp=0 and pb=0");
      assert.equal(encodedFrame.readUInt32LE(1), 524288);
      assert.equal(encodedFrame.readBigUInt64LE(5), BigInt(packInfo.framed_bytes));
      const framed = lzma1Decompress(encodedFrame, packInfo.framed_bytes);
      assert.ok(framed instanceof ContextUint8Array);
      assert.deepEqual(Array.from(framed.subarray(0, 6)), [255, 76, 90, 77, 65, 1]);
      assert.equal(sha(framed.subarray(6)), packInfo.decoded_source_sha256);

      vm.runInContext(wrapper, isolated, { timeout: 10000 });
      assert.equal(isolated.registrations, 1);
      for (const code of locales) {
        assert.equal(vm.runInContext(`localeReady('${code}')`, isolated), packInfo.locales.includes(code));
      }
      vm.runInContext(wrapper, isolated, { timeout: 10000 });
      assert.equal(isolated.registrations, 1, `${packInfo.name} repeat load must remain idempotent`);
      assert.equal(isolated.onmessage, isolated.sentinel);
      assert.equal(isolated.LZMA, isolated.sentinel);
      assert.equal(isolated.LZMA_WORKER, isolated.sentinel);
    }
    vm.runInContext(wrapper, bundled, { timeout: 10000 });
  }

  const fixtureRun = python(["-c", fixtureCode, root, ...locales]);
  assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
  const fixtures = JSON.parse(fixtureRun.stdout);
  const original = context();
  for (const source of fixtures.sources) vm.runInContext(source, original);
  const expected = snapshot(original);
  assert.equal(snapshot(bundled), expected, "all 12 locale values, formatter probes and freeze contracts must match");
  assert.equal(bundled.registrations, 4);
  assert.equal(bundled.onmessage, bundled.sentinel); assert.equal(bundled.LZMA, bundled.sentinel);
  assert.equal(bundled.LZMA_WORKER, bundled.sentinel);

  // Direct standalone bounds/header validation on pure-TypedArray lzma1Decompress
  const samplePacked = Buffer.from(fixtures.packed_b64, "base64");
  const badProp = Buffer.from(samplePacked); badProp[0] = 225;
  assert.throws(() => lzma1Decompress(badProp, samplePacked.readUInt32LE(5)), /corrupted input/);
  const zeroDict = Buffer.from(samplePacked); zeroDict.writeUInt32LE(0, 1);
  assert.throws(() => lzma1Decompress(zeroDict, samplePacked.readUInt32LE(5)), /corrupted input/);
  const hugeDict = Buffer.from(samplePacked); hugeDict.writeUInt32LE((1 << 31) >>> 0, 1);
  assert.throws(() => lzma1Decompress(hugeDict, samplePacked.readUInt32LE(5)), /corrupted input/);
  const zeroOut = Buffer.from(samplePacked); zeroOut.writeBigUInt64LE(0n, 5);
  assert.throws(() => lzma1Decompress(zeroOut, 1572864), /corrupted input/);
  const unknownOut = Buffer.from(samplePacked); Buffer.alloc(8, 0xff).copy(unknownOut, 5);
  assert.throws(() => lzma1Decompress(unknownOut, 1572864), /corrupted input/);
  const overMaxOut = Buffer.from(samplePacked);
  assert.throws(() => lzma1Decompress(overMaxOut, overMaxOut.readUInt32LE(5) - 1), /corrupted input/);
  assert.throws(() => lzma1Decompress(samplePacked.subarray(0, 12), 1572864), /corrupted input/);
  assert.throws(() => lzma1Decompress(samplePacked.subarray(0, 20), 1572864), /corrupted input/);

  const headerCases = ["property", "dictionary", "size", "unknown-size", "short-header"];
  for (const key of [...headerCases, "stream", "prefix", "version", "length", "type", "crc", "utf8"]) {
    const bad = context();
    const observed = fixtures.cases[key].replace("const all=lzma1Decompress(",
      "globalThis.__decoderCalls=(globalThis.__decoderCalls||0)+1;const all=lzma1Decompress(");
    assert.throws(() => vm.runInContext(observed, bad, { timeout: 10000 }),
      /corrupted input|locale LZMA header|locale payload|encoded data/, key);
    assert.equal(bad.__decoderCalls || 0, headerCases.includes(key) ? 0 : 1,
      `${key}: header refusals must precede decoder allocation`);
    assert.equal(bad.registrations, 0, `${key} must fail before registration`);
    assert.equal(vm.runInContext("UI_LANGS.filter(x=>x!=='en'&&localeReady(x)).length", bad), 0);
    assert.equal(bad.onmessage, bad.sentinel); assert.equal(bad.LZMA, bad.sentinel);
  }
  const unicode = context(); vm.runInContext(fixtures.cases.unicode, unicode, { timeout: 10000 });
  assert.equal(unicode.__localeUnicode, fixtures.unicode); assert.equal(unicode.registrations, 1);

  for (const [name, entry] of packsByName) {
    const damaged = Buffer.from(entry.packet); damaged[damaged.length - 8] ^= 1;
    assert.throws(() => gunzipSync(damaged), /incorrect data check/, `${name} damaged gzip`);
  }
  const rerunDir = path.join(work, "packs-rerun");
  const again = python([producer, "--locale-dir", path.join(root, "main/www/locales"),
    "--locales", ...locales, "--output-dir", rerunDir]);
  assert.equal(again.status, 0, again.stderr);
  for (const [name, entry] of packsByName) {
    assert.deepEqual(fs.readFileSync(path.join(rerunDir, `locale-${name}.js.gz`)), entry.packet,
      `pack ${name} must be deterministic`);
  }
  const dePath = path.join(packDir, "locale-de.js.gz");
  fs.writeFileSync(dePath, "keep");
  const limited = python([...args, "--max-gzip-bytes", "1"]);
  assert.notEqual(limited.status, 0); assert.equal(fs.readFileSync(dePath, "utf8"), "keep");
  const raised = python([...args, "--max-gzip-bytes", "296961"]); assert.notEqual(raised.status, 0);
  const sourceRaised = python([...args, "--source-max-gzip-bytes", "32769"]);
  assert.notEqual(sourceRaised.status, 0);
  const sourceLimited = python([...args, "--source-max-gzip-bytes", "1"]);
  assert.notEqual(sourceLimited.status, 0);
  const omitted = python([producer, "--locale-dir", path.join(root, "main/www/locales"),
    "--locales", ...locales.slice(1), "--output-dir", packDir]);
  assert.notEqual(omitted.status, 0, "an omitted source locale must stop the build");
  if (process.argv.includes("--browser")) await browserChecks(packsByCode, fixtures, fixtures.sources);
  console.log(`locale packs: 5 packs for ${locales.length} catalogs, ${info.total_gzip_bytes} bytes (tag ${info.locale_asset_tag}); exact formatters, binary framing, integrity, Unicode, isolation and idempotency verified`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
