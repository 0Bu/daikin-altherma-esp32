import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-runner-selftest-"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const active = pid => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() && !result.stdout.trim().startsWith("Z");
};
// Execute the real worker-side protocol without importing its top-level browser launch.
const workerSource = fs.readFileSync(path.join(root, "test/test_browser_render.mjs"), "utf8");
const barrierStart = workerSource.indexOf("async function waitForHistoryContinuation(");
const barrierEnd = workerSource.indexOf("\nconst layoutAudit", barrierStart);
assert.ok(barrierStart >= 0 && barrierEnd > barrierStart, "worker barrier fixture must extract the real protocol");
const barrierSource = 'import assert from "node:assert/strict";\nexport ' +
  workerSource.slice(barrierStart, barrierEnd);
const fakeNode = String.raw`
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const [script, ...args] = process.argv.slice(2);
const dir = process.env.RUNNER_FIXTURE, mode = process.env.RUNNER_MODE;
const has = name => fs.existsSync(path.join(dir,name));
const mark = name => fs.writeFileSync(path.join(dir,name),String(Date.now()));
const waitFor = (predicate, run) => { if(predicate())run();else setTimeout(()=>waitFor(predicate,run),10); };
const descendant = role => {
  const page=process.env.DAIKIN_BROWSER_PAGE;
  const resistant = !['slow-temporal','missing-receipt','duplicate-receipt','wrong-receipt',
    'wrong-nonce','ready-then-exit','focused','serial','mutation'].includes(mode);
  const code=[
    'const fs=require("node:fs");'+(resistant?'process.on("SIGTERM",()=>{});':''),
    'fs.writeFileSync('+JSON.stringify(path.join(dir,role+'-descendant-ready'))+',"yes");',
    'setInterval(()=>{if(!fs.existsSync('+JSON.stringify(page)+'))fs.writeFileSync('+
      JSON.stringify(path.join(dir,'page-removed-while-live'))+',"yes");},10);',
  ].join('\n');
  const child=spawn(process.execPath,['-e',code],{stdio:'ignore'});
  fs.writeFileSync(path.join(dir,role+'.json'),JSON.stringify({pid:process.pid,descendant:child.pid,page}));
};
if(script.endsWith('find_browser.mjs'))console.log('/synthetic/browser');
else if(script.endsWith('assemble_page.mjs')){
  if(mode==='assembler-fails')process.exit(1);
  fs.writeFileSync(args[0],'<!doctype html><title>runner fixture</title>');
}else if(script.endsWith('run_render.mjs')){
  const supervisor=spawn(process.execPath,[script,...args],{stdio:'inherit'});
  process.on('SIGTERM',()=>supervisor.kill('SIGTERM'));
  process.on('SIGINT',()=>supervisor.kill('SIGINT'));
  supervisor.once('exit',(code,signal)=>process.exit(code??(signal==='SIGINT'?130:143)));
}else if(script.endsWith('selftest.mjs')){
  assert.equal(process.env.DAIKIN_BROWSER_HISTORY_BARRIER,undefined,'controls cannot inherit a positive worker barrier');
  if(args.includes('--infrastructure-only')){
    assert.ok(!has('phone.json')&&!has('desktop.json'),'infrastructure must precede positive browser jobs');
    mark('infrastructure-started');
    setTimeout(()=>{mark('infrastructure-ended');process.exit(mode==='infrastructure-fails'?2:0);},40);
  }else if(args.includes('--browser-controls-only')){
    mark('chromium-selftest-reached');mark('controls-started');descendant('controls');
    waitFor(()=>has('controls-descendant-ready')&&has('phone-static-started')&&has('desktop-static-started'),()=>{
      assert.ok(has('phone-history-ready')&&has('desktop-history-ready'),'controls cannot overlap a temporal witness');
      mark('controls-overlap');
      if(mode==='controls-fails')process.exit(1);
      if(['interrupt-after-release','deadline-after-release','static-phone-fails','static-desktop-fails'].includes(mode))return;
      setTimeout(()=>{mark('controls-completed');process.exit(0);},140);
    });
    setInterval(()=>{},1000);
  }else mark(process.env.DAIKIN_BROWSER_ENGINE+'-selftest-reached');
}else if(script.endsWith('test_browser_render.mjs')||script.endsWith('test_browser_webkit.mjs')){
  const viewport=args[args.indexOf('--viewport')+1]||'combined';
  descendant(viewport);
  const barrier=process.env.DAIKIN_BROWSER_HISTORY_BARRIER;
  if(barrier)assert.ok(has('infrastructure-ended'),'infrastructure must finish before temporal observation');
  const duration=viewport==='phone'?40:mode==='slow-temporal'?350:140;
  const end=async()=>{
    if(!has(viewport+'-descendant-ready')){setTimeout(end,10);return;}
    if(mode==='phone-fails'&&viewport==='phone'){mark(viewport+'-temporal-failed');process.exit(1);}
    if(mode==='desktop-fails'&&viewport==='desktop'){mark(viewport+'-temporal-failed');process.exit(2);}
    if(mode==='both-fail'){mark(viewport+'-temporal-failed');process.exit(1);}
    if(mode==='webkit-fails'&&viewport.startsWith('ipad-'))process.exit(1);
    // Old coordinators get meaningful legacy success instead of an artificial setup failure.
    if(!barrier){
      if(['interrupt','deadline'].includes(mode))return;
      mark(viewport+'-history-ready');mark(viewport+'-static-started');
      setTimeout(()=>process.exit(0),80);return;
    }
    const request=JSON.parse(barrier),receipt={type:'history-motion-ready',viewport,nonce:request.nonce};
    if(viewport==='phone'){
      if(mode==='missing-receipt')process.exit(0);
      if(['duplicate-receipt','wrong-receipt','wrong-nonce','ready-then-exit'].includes(mode)){
        if(mode==='wrong-receipt')receipt.viewport='desktop';
        if(mode==='wrong-nonce')receipt.nonce=request.nonce==='f'.repeat(32)?'e'.repeat(32):'f'.repeat(32);
        if(mode==='ready-then-exit')mark(viewport+'-history-ready');
        process.send(receipt);
        if(mode==='duplicate-receipt')process.send(receipt);
        if(mode==='ready-then-exit')process.exit(0);
        return;
      }
    }
    if(viewport==='desktop'&&['interrupt','deadline','duplicate-receipt','ready-then-exit'].includes(mode))return;
    mark(viewport+'-history-ready');
    const {waitForHistoryContinuation}=await import(path.join(dir,'barrier-client.mjs'));
    await waitForHistoryContinuation(viewport);
    mark(viewport+'-static-started');
    assert.ok(has('phone-history-ready')&&has('desktop-history-ready'),'static work cannot overlap a sibling temporal witness');
    waitFor(()=>has('controls-overlap'),()=>{
      if(mode==='static-phone-fails'&&viewport==='phone')process.exit(1);
      if(mode==='static-desktop-fails'&&viewport==='desktop')process.exit(2);
      if(['interrupt-after-release','deadline-after-release','controls-fails',
          'static-phone-fails','static-desktop-fails'].includes(mode))return;
      setTimeout(()=>process.exit(0),80);
    });
  };
  setTimeout(()=>end().catch(error=>{console.error(error);process.exit(1);}),duration);
  setInterval(()=>{},1000);
}else{console.error('unknown fake-node fixture script',script);process.exit(2);}
`;

async function assertWebKitPaintScope() {
  const fixture = path.join(work, "webkit-paint-scope");
  for (const directory of ["test", "tools/browser"])
    fs.mkdirSync(path.join(fixture, directory), { recursive: true });
  const source = fs.readFileSync(path.join(root, "test/test_browser_webkit.mjs"), "utf8");
  const selection = 'if (!mutation || mutation === "history-paint-freeze")';
  assert.equal(source.split(selection).length, 2, "paint scope control must mutate one actual worker selection");
  const { HISTORY_MOTION_MUTATIONS: mutations } = await import(
    pathToFileURL(path.join(root, "test/test_browser_history_motion.mjs")));
  fs.writeFileSync(path.join(fixture, "record.mjs"), `import fs from "node:fs";
    export const record=(type,context="")=>fs.appendFileSync(process.env.WEBKIT_SCOPE_RECORD,
      JSON.stringify({type,context})+"\\n");`);
  fs.writeFileSync(path.join(fixture, "tools/browser/fixture_server.mjs"), `
    import {record} from "../../record.mjs";
    export async function startFixtureServer(){record("server-open");
      return {url:"http://fixture.invalid/",close:async()=>record("server-close")};}`);
  fs.writeFileSync(path.join(fixture, "tools/browser/webkit_browser.mjs"), `
    import {record} from "../../record.mjs";
    export async function launchWebKit({viewport}){
      const context=viewport.width===834?"ipad-portrait":"ipad-landscape";
      record("browser-open",context);
      const page={diagnostics:[],navigate:async()=>{},waitFor:async()=>{},evaluate:async()=>true,
        touchWitness:async()=>({touchstart:2,touchend:2,pointerdown:2,pointerup:2}),
        touchTimings:()=>[1,1]};
      return {page,product:"synthetic",descriptor:"synthetic",close:async()=>record("browser-close",context)};
    }`);
  fs.writeFileSync(path.join(fixture, "test/test_browser_history_motion.mjs"), `
    import {record} from "../record.mjs";
    export const HISTORY_MOTION_MUTATIONS=${JSON.stringify(mutations)};
    export async function assertHistoryMotion(page,server,context){
      record("motion",context);await page.assertFlowPaint?.(context);
      if(process.env.DAIKIN_BROWSER_MUTATION)throw new Error("seeded motion rejection: "+process.env.DAIKIN_BROWSER_MUTATION);
      page.historyMotionEvidence.push({maxFrameGap:1,maxNativeInputMs:1,focusSetupMs:1,focusWasAlready:true});
    }`);
  fs.writeFileSync(path.join(fixture, "test/test_browser_webkit_paint.mjs"), `
    import {record} from "../record.mjs";
    export async function assertWebKitFlowPaint(page,context){record("paint",context);
      if(process.env.DAIKIN_BROWSER_MUTATION==="history-paint-freeze")
        throw new Error("WebKit painted flow must change across native screenshots");}`);
  const page = path.join(fixture, "index.html");
  fs.writeFileSync(page, "<!doctype html><title>synthetic paint scope</title>");
  function check(label, workerSource, mutation, expectedPaint) {
    const worker = path.join(fixture, "test", label + ".mjs"), record = path.join(fixture, label + ".jsonl");
    fs.writeFileSync(worker, workerSource);
    const result = spawnSync(process.execPath, [worker], { encoding: "utf8", timeout: 5000,
      env: { ...process.env, DAIKIN_BROWSER_PAGE: page, DAIKIN_BROWSER_MUTATION: mutation,
        DAIKIN_WEBKIT_DIAGNOSTICS: "0", WEBKIT_SCOPE_RECORD: record } });
    const output = (result.stdout || "") + "\n" + (result.stderr || "");
    assert.equal(result.error, undefined, label + ": actual worker must terminate normally\n" + output);
    assert.equal(result.status, mutation ? 1 : 0, label + ": actual worker must reach its fixture outcome\n" + output);
    const events = fs.readFileSync(record, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const orientations = mutation ? ["ipad-portrait"] : ["ipad-portrait", "ipad-landscape"];
    assert.deepEqual(events.filter(event => event.type === "browser-open").map(event => event.context), orientations,
      label + ": actual worker must select each expected orientation");
    assert.deepEqual(events.filter(event => event.type === "paint").map(event => event.context), expectedPaint,
      label + ": expected paint captures");
    const lifecycle = orientations.flatMap(orientation => {
      const context = "webkit/" + orientation + "/history-motion";
      return ["server-open", "browser-open", "motion", ...(expectedPaint.includes(context) ? ["paint"] : []),
        "browser-close", "server-close"];
    });
    assert.deepEqual(events.map(event => event.type), lifecycle, label + ": finally must close browser then server");
    if (mutation) assert.ok(output.includes(mutation === "history-paint-freeze"
      ? "WebKit painted flow must change across native screenshots" : "seeded motion rejection: " + mutation),
    label + ": the intended fixture rejection must remain reachable\n" + output);
  }
  const positivePaint = ["ipad-portrait", "ipad-landscape"].map(name => "webkit/" + name + "/history-motion");
  const frozenPaint = [positivePaint[0]];
  check("positive", source, "", positivePaint);
  check("frozen", source, "history-paint-freeze", frozenPaint);
  for (const mutation of mutations) check(mutation, source, mutation, []);
  for (const [label, changed, mutation, expected] of [
    ["always-off-positive", source.replace(selection, "if (false)"), "", positivePaint],
    ["always-off-frozen", source.replace(selection, "if (false)"), "history-paint-freeze", frozenPaint],
    ["always-on-unrelated", source.replace(selection, "if (true)"), mutations[0], []],
  ]) {
    assert.throws(() => check(label, changed, mutation, expected), /expected paint captures/,
      label + ": selection mutation must fail the scope assertion");
    console.log("browser runner selftest: actual WebKit paint scope rejects " + label);
  }
  console.log("browser runner selftest: actual WebKit paint scope covers both orientations, frozen paint and " +
    mutations.length + " unrelated controls with finally cleanup");
}

try {
  const cases = [["success", 0], ["slow-temporal", 0], ["phone-fails", 1], ["desktop-fails", 2],
    ["both-fail", 1], ["missing-receipt", 2], ["duplicate-receipt", 2], ["wrong-receipt", 2],
    ["wrong-nonce", 2], ["ready-then-exit", 2], ["static-phone-fails", 1], ["static-desktop-fails", 2],
    ["controls-fails", 1], ["infrastructure-fails", 2], ["interrupt", 143],
    ["interrupt-after-release", 143], ["deadline", 2], ["deadline-after-release", 2],
    ["invalid-deadline", 2], ["assembler-fails", 2], ["forged-directory", 0],
    ["webkit-fails", 1], ["focused", 0], ["serial", 0], ["mutation", 0]];
  for (const [mode, expected] of cases) {
    const fixture = path.join(work, mode);
    for (const directory of ["scripts", "tools/browser", "bin", "tmp"])
      fs.mkdirSync(path.join(fixture, directory), { recursive: true });
    fs.copyFileSync(process.env.DAIKIN_BROWSER_RUNNER_SOURCE || path.join(root, "scripts/run-browser-render-tests.sh"),
      path.join(fixture, "scripts/run-browser-render-tests.sh"));
    fs.copyFileSync(process.env.DAIKIN_BROWSER_COORDINATOR_SOURCE || path.join(root, "tools/browser/run_render.mjs"),
      path.join(fixture, "tools/browser/run_render.mjs"));
    fs.writeFileSync(path.join(fixture, "barrier-client.mjs"), barrierSource);
    fs.writeFileSync(path.join(fixture, "bin/node"), `#!${process.execPath}\n${fakeNode}`, { mode: 0o755 });
    const sentinel = path.join(fixture, "user-work");
    fs.mkdirSync(sentinel);
    fs.writeFileSync(path.join(sentinel, "index.html"), "preserve this user-owned sentinel");
    const extra = mode === "forged-directory" ? [sentinel]
      : mode === "focused" ? ["--history-motion-case", "board"] : [];
    const runner = spawn("bash", [path.join(fixture, "scripts/run-browser-render-tests.sh"), ...extra], {
      cwd: fixture, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${path.join(fixture, "bin")}${path.delimiter}${process.env.PATH}`,
        TMPDIR: path.join(fixture, "tmp"), RUNNER_FIXTURE: fixture,
        RUNNER_MODE: mode === "forged-directory" ? "success" : mode,
        DAIKIN_BROWSER_PAGE: path.join(sentinel, "index.html"),
        DAIKIN_BROWSER_CONTAINER: "1", DAIKIN_BROWSER_ENGINE: "chromium",
        DAIKIN_BROWSER_MUTATION: mode === "mutation" ? "history-stall" : "",
        DAIKIN_BROWSER_PARALLEL: mode === "serial" ? "0" : "1",
        DAIKIN_BROWSER_TIMEOUT_MS: mode === "invalid-deadline" ? "invalid"
          : mode.startsWith("deadline") ? "1000" : "5000" },
    });
    let output = "";
    runner.stdout.on("data", chunk => { output += chunk; });
    runner.stderr.on("data", chunk => { output += chunk; });
    const completion = new Promise(resolve => runner.once("exit", (code, signal) => resolve({ code, signal })));
    const watchdog = setTimeout(() => runner.kill("SIGKILL"), 12000);
    try {
      if (["interrupt", "interrupt-after-release"].includes(mode)) {
        const ready = mode === "interrupt" ? "phone-history-ready" : "controls-overlap";
        const end = Date.now() + 3000;
        while (!fs.existsSync(path.join(fixture, ready))) {
          assert.ok(Date.now() < end, "interrupt must reach the intended phase\n" + output);
          await pause(20);
        }
        runner.kill("SIGTERM");
      }
      const result = await completion;
      assert.equal(result.code, expected, `${mode}: preserve the appropriate exit status\n${output}`);
      if (["duplicate-receipt", "wrong-receipt", "wrong-nonce"].includes(mode))
        assert.match(output, /invalid or duplicate history receipt from phone/, "receipt control must fail at protocol validation");
      if (["missing-receipt", "ready-then-exit"].includes(mode))
        assert.match(output, /phone exited before history continuation release/, "exit control must fail before the two-worker release");
      if (["phone-fails", "desktop-fails", "both-fail"].includes(mode))
        assert.ok(["phone", "desktop"].some(viewport => fs.existsSync(path.join(fixture, viewport + "-temporal-failed"))),
          "temporal failure control must execute its seeded failure");
      if (mode === "infrastructure-fails") {
        assert.ok(fs.existsSync(path.join(fixture, "infrastructure-ended")), "infrastructure failure must execute");
        assert.equal(fs.existsSync(path.join(fixture, "phone.json")), false, "failed infrastructure must stop positive launch");
      }
      if (mode === "deadline") assert.ok(fs.existsSync(path.join(fixture, "phone-history-ready")),
        "pre-release deadline must reach the temporal barrier");
      const optimized = !["forged-directory", "focused", "serial", "mutation"].includes(mode);
      const overlap = ["success", "slow-temporal", "webkit-fails"].includes(mode);
      if (overlap) {
        assert.ok(fs.existsSync(path.join(fixture, "controls-overlap")),
          "full Chromium controls must overlap static locale continuation after both temporal workers");
        const timestamp = name => Number(fs.readFileSync(path.join(fixture, name), "utf8"));
        const temporalEnd = Math.max(timestamp("phone-history-ready"), timestamp("desktop-history-ready"));
        for (const viewport of ["phone", "desktop"])
          assert.ok(timestamp(viewport + "-static-started") >= temporalEnd,
            "the faster viewport must pause until both temporal observations finish");
        assert.ok(timestamp("infrastructure-ended") <= Math.min(timestamp("phone-history-ready"), timestamp("desktop-history-ready")),
          "infrastructure fixtures must be joined before positive temporal workers");
        assert.ok(fs.existsSync(path.join(fixture, "controls-completed")), "all three overlapping jobs must complete");
      }
      const late = ["static-phone-fails", "static-desktop-fails", "controls-fails",
        "interrupt-after-release", "deadline-after-release"].includes(mode);
      if (late) assert.ok(fs.existsSync(path.join(fixture, "controls-overlap")), mode + ": exercise the released three-job phase");
      else if (optimized && !overlap)
        assert.equal(fs.existsSync(path.join(fixture, "controls-started")), false, mode + ": controls cannot start before a valid two-worker barrier");
      const roles = ["phone", "desktop", "combined", "controls", "ipad-portrait", "ipad-landscape"];
      for (const role of roles) {
        const marker = path.join(fixture, `${role}.json`);
        if (!fs.existsSync(marker)) continue;
        const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
        assert.equal(Boolean(active(recorded.pid)), false, `${mode}/${role}: worker must be joined`);
        assert.equal(Boolean(active(recorded.descendant)), false,
          `${mode}/${role}: exited parent cannot orphan a TERM-resistant descendant`);
        assert.equal(fs.existsSync(recorded.page), false, `${mode}: shared page must be removed\n${output}`);
      }
      if (mode === "serial") assert.ok(fs.existsSync(path.join(fixture, "combined.json")), "serial Chromium must retain its combined worker");
      if (["success", "slow-temporal", "forged-directory", "focused", "serial", "mutation"].includes(mode)) {
        for (const viewport of ["ipad-portrait", "ipad-landscape"])
          assert.ok(fs.existsSync(path.join(fixture, viewport + ".json")), mode + ": both serial WebKit orientations must run");
        assert.ok(fs.existsSync(path.join(fixture, "webkit-selftest-reached")), "serial WebKit retains its final controls");
      }
      if (mode === "webkit-fails") {
        assert.ok(fs.existsSync(path.join(fixture, "ipad-portrait.json")));
        assert.equal(fs.existsSync(path.join(fixture, "ipad-landscape.json")), false,
          "failed WebKit portrait must stop before landscape");
        assert.equal(fs.existsSync(path.join(fixture, "webkit-selftest-reached")), false);
      }
      assert.equal(fs.existsSync(path.join(fixture, "page-removed-while-live")), false,
        `${mode}: shared page must stay available until all descendants end`);
      assert.deepEqual(fs.readdirSync(path.join(fixture, "tmp")), [], `${mode}: no temporary tree may remain`);
      assert.equal(fs.readFileSync(path.join(sentinel, "index.html"), "utf8"), "preserve this user-owned sentinel",
        `${mode}: CLI arguments and a forged page environment cannot transfer cleanup ownership`);
      console.log(`browser runner selftest: ${mode} status, phase ordering, process trees and cleanup observed`);
    } finally {
      clearTimeout(watchdog);
      runner.kill("SIGKILL");
      for (const role of ["phone", "desktop", "combined", "controls", "ipad-portrait", "ipad-landscape"]) {
        const marker = path.join(fixture, `${role}.json`);
        if (!fs.existsSync(marker)) continue;
        const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
        for (const pid of [recorded.pid, recorded.descendant]) {
          try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      }
    }
  }

  for (const mode of ["continue", "parent-disconnect", "foreign-release"]) {
    const fixture = path.join(work, "client-" + mode);
    fs.mkdirSync(fixture);
    const source = path.join(fixture, "client.mjs");
    fs.writeFileSync(source, barrierSource + `\ntry { await waitForHistoryContinuation("phone"); }
      catch(error) { console.error(error.message); process.exitCode=1; }\n`);
    const nonce = "a".repeat(32);
    const child = spawn(process.execPath, [source], { stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, DAIKIN_BROWSER_HISTORY_BARRIER: JSON.stringify({ viewport: "phone", nonce }) } });
    let output = "";
    child.stderr.on("data", chunk => { output += chunk; });
    const completed = new Promise(resolve => child.once("exit", code => resolve(code)));
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      child.once("message", receipt => {
        assert.deepEqual(receipt, { type: "history-motion-ready", viewport: "phone", nonce });
        if (mode === "parent-disconnect") child.disconnect();
        else child.send({ type: "history-motion-continue", viewport: mode === "continue" ? "phone" : "desktop", nonce });
      });
      assert.equal(await completed, mode === "continue" ? 0 : 1, mode + ": actual worker protocol must settle\n" + output);
      if (mode !== "continue") assert.match(output, mode === "parent-disconnect"
        ? /history continuation parent disconnected/ : /invalid history continuation release/);
    } finally { clearTimeout(watchdog); child.kill("SIGKILL"); }
    console.log("browser runner selftest: actual worker protocol " + mode);
  }

  // Execute the real phase selector too: browser-only must not load infrastructure, and a failed
  // infrastructure import must wait for its siblings before throwing or starting browser work.
  const phaseFixture = path.join(work, "selftest-phases");
  fs.mkdirSync(path.join(phaseFixture, "tools/browser"), { recursive: true });
  fs.mkdirSync(path.join(phaseFixture, "test"));
  for (const name of ["selftest.mjs", "cdp_browser.mjs", "find_browser.mjs"])
    fs.copyFileSync(path.join(root, "tools/browser", name), path.join(phaseFixture, "tools/browser", name));
  for (const [name, delay] of [["cleanup", 20], ["runner", 40], ["container", 60]])
    fs.writeFileSync(path.join(phaseFixture, "tools/browser", name + "_selftest.mjs"),
      `import fs from "node:fs";import path from "node:path";
       await new Promise(resolve=>setTimeout(resolve,${delay}));
       fs.writeFileSync(path.join(process.env.SELFTEST_PHASE_DIRECTORY,${JSON.stringify(name)}),"joined");
       if(process.env.SELFTEST_PHASE_FAIL==="1"&&${JSON.stringify(name)}==="cleanup")throw new Error("seeded infrastructure import failure");`);
  fs.writeFileSync(path.join(phaseFixture, "tools/browser/stage_source_selftest.py"), "print('synthetic staging completed')\n");
  fs.writeFileSync(path.join(phaseFixture, "test/test_browser_render.mjs"), `
    import fs from "node:fs";import path from "node:path";
    const directory=process.env.SELFTEST_PHASE_DIRECTORY,mutation=process.env.DAIKIN_BROWSER_MUTATION;
    const messages={"root-overflow":"selftest/root-overflow: horizontal viewport overflow",
      "modal-focus-delay":"browser modal-focus selftest passed",
      "history-flood":"real browser History transitions must stay bounded",
      "route-hashchange-manual":"browser route-event selftest passed",
      "route-isolation-bypass":"route-isolated keyboard open must keep the Settings hash",
      "history-eager":"polls must not rebuild cached charts in closed rows",
      "history-stall":"history frame responsiveness budget exceeded",
      "history-replace":"unchanged plot must remain mounted",
      "history-restart":"preserve running CSSAnimation instance",
      "history-unknown":"history inspector inventory must classify every production entry",
      "history-disclosure-replace":"unchanged plot must remain mounted",
      "history-detach":"unchanged history ancestors must remain connected",
      "history-text-stale":"changed board telemetry must update the visible reading"};
    if(!messages[mutation])throw new Error("unknown synthetic browser control");
    const lock=path.join(directory,"control-active");fs.writeFileSync(lock,mutation,{flag:"wx"});
    setTimeout(()=>{fs.appendFileSync(path.join(directory,"controls"),mutation+"\\n");
      fs.unlinkSync(lock);console.log(messages[mutation]);
      process.exit(["modal-focus-delay","route-hashchange-manual"].includes(mutation)?0:1);},20);
  `);
  for (const phase of ["--infrastructure-only", "--browser-controls-only", "default", "failed-import"]) {
    const directory = path.join(phaseFixture, phase);
    fs.mkdirSync(directory);
    const env = { ...process.env, SELFTEST_PHASE_DIRECTORY: directory,
      SELFTEST_PHASE_FAIL: phase === "failed-import" ? "1" : "0" };
    delete env.DAIKIN_BROWSER_PAGE;
    delete env.DAIKIN_BROWSER_BIN;
    if (phase !== "--infrastructure-only") {
      env.DAIKIN_BROWSER_PAGE = "/synthetic/assembled-page";
      env.DAIKIN_BROWSER_BIN = "/synthetic/browser";
    }
    const result = spawnSync(process.execPath, [path.join(phaseFixture, "tools/browser/selftest.mjs"),
      ...(phase.startsWith("--") ? [phase] : [])], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, phase === "failed-import" ? 1 : 0,
      "actual selftest phase selector: " + phase + "\n" + result.stdout + result.stderr);
    if (phase === "failed-import") assert.match(result.stderr, /seeded infrastructure import failure/,
      "import control must fail for its seeded error after sibling imports join");
    for (const name of ["cleanup", "runner", "container"])
      assert.equal(fs.existsSync(path.join(directory, name)), phase !== "--browser-controls-only",
        phase + ": infrastructure imports must be selected and joined");
    const controls = path.join(directory, "controls");
    if (["default", "--browser-controls-only"].includes(phase)) {
      const mutations = fs.readFileSync(controls, "utf8").trim().split("\n");
      assert.equal(mutations.length, 13, phase + ": every serial browser control must execute");
      assert.equal(new Set(mutations).size, 13);
    } else assert.equal(fs.existsSync(controls), false, phase + ": no browser control may run");
    assert.equal(fs.existsSync(path.join(directory, "control-active")), false, "controls must stay serial and finish");
    console.log("browser runner selftest: actual selftest phase " + phase);
  }
  await assertWebKitPaintScope();
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
