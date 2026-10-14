import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=path.join(root,"test/http_stream_runtime");
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"daikin-http-stream-runtime-"));
const commands=[];
const paths={ common:"main/http_common.cpp",status:"main/http_status.cpp",dwell:"main/state_dwell.cpp",
  chunks:"main/logic/chunk_sink.hpp",json:"main/logic/json.hpp",identity:"main/logic/values_identity.hpp",
  dwellLogic:"main/logic/state_dwell.hpp" };
const sources=Object.fromEntries(Object.entries(paths).map(([key,file])=>[key,fs.readFileSync(path.join(root,file),"utf8")]));
const frozen=JSON.parse(fs.readFileSync(path.join(fixture,"legacy_handlers.json"),"utf8"));
assert.equal(frozen.base_commit,"819a2c98ad7e331ce1527ca85f4acb7127e55734");
function functionText(source,name,templated=false) {
  const regex=templated?new RegExp(`template <typename JsonOut>\\s*\\nstatic void ${name}\\([^]*?\\n}`)
    :new RegExp(`(?:static )?(?:esp_err_t|logic::DwellReading) ${name}\\([^]*?\\n}`);
  const match=source.match(regex); assert.ok(match,`missing complete function ${name}`); return match[0];
}
const cxx=process.env.CXX||"c++";
const sanitizer=process.argv.includes("--sanitizer=undefined");
function execute(command,args,required=true) {
  commands.push([command,...args]);
  const result=spawnSync(command,args,{cwd:root,encoding:"utf8",timeout:60000,maxBuffer:2*1024*1024});
  if(required) assert.equal(result.status,0,`${command}: ${result.error||""}\n${result.stdout.split("\n").filter(line=>!line.startsWith("WIRE ")).join("\n")}${result.stderr}`);
  return result;
}
function copyHeaders(from,to) {
  fs.mkdirSync(to,{recursive:true});
  for(const entry of fs.readdirSync(from,{withFileTypes:true})) {
    if(entry.isDirectory()) copyHeaders(path.join(from,entry.name),path.join(to,entry.name));
    else if(entry.name.endsWith(".hpp")) fs.copyFileSync(path.join(from,entry.name),path.join(to,entry.name));
  }
}
function compile(tag,mutation) {
  const directory=path.join(temporary,tag),main=path.join(directory,"main");
  copyHeaders(path.join(root,"main"),main);
  const effective={...sources};
  if(mutation) {
    if(mutation.special==="legacy-history"||mutation.special==="legacy-diag") {
      const name=mutation.special==="legacy-history"?"h_history":"h_diag";
      effective.status=effective.status.replace(functionText(effective.status,name),mutation.special==="legacy-history"?frozen.history:frozen.diag);
    } else if(mutation.special==="legacy-values") {
      effective.status=effective.status.replace(functionText(effective.status,"append_values_array",true),frozen.values)
        .replace(/append_values_array\(j, snapshot.x10a, snapshot.x10a_label_ambiguous,\s*snapshot.x10a_dwell\);/,
                 "append_values_array(j, snapshot.x10a, snapshot.x10a_label_ambiguous);");
      effective.dwell+="\nnamespace daik {\n"+frozen.dwell+"\n}\n";
    } else {
    const before=mutation.before;
    const count=typeof before==="string"?effective[mutation.file].split(before).length-1:
      [...effective[mutation.file].matchAll(new RegExp(before.source,before.flags+"g"))].length;
    assert.equal(count,1,`${mutation.name}: mutation must bind unique production anchor`);
    effective[mutation.file]=effective[mutation.file].replace(before,mutation.after);
    }
  }
  for(const [key,file] of Object.entries(paths)) fs.writeFileSync(path.join(directory,file),effective[key]);
  const binary=path.join(directory,"fixture");
  execute(cxx,["-std=c++20","-O0","-g","-ffunction-sections","-fdata-sections","-Wall","-Wextra","-Wno-unused-parameter",
    ...(sanitizer?["-fsanitize=undefined","-fno-sanitize-recover=all"]:[]),
    ...(mutation?.special==="legacy-values"?["-DHTTP_STREAM_LEGACY_DWELL"]:[]),
    '-DCONFIG_DAIKIN_HOSTNAME="daikin-altherma-esp32"','-DCONFIG_IDF_TARGET="esp32s3"',
    '-DCONFIG_DAIKIN_MQTT_BASE_TOPIC="daikin-altherma-esp32"',`-I${path.join(fixture,"stubs")}`,`-I${main}`,
    `-DHTTP_COMMON_SOURCE=${JSON.stringify(path.join(directory,paths.common))}`,
    `-DHTTP_STATUS_SOURCE=${JSON.stringify(path.join(directory,paths.status))}`,
    `-DSTATE_DWELL_SOURCE=${JSON.stringify(path.join(directory,paths.dwell))}`,
    "-MMD","-MF",path.join(directory,"inputs.d"),path.join(fixture,"fixture.cpp"),
    ...(process.platform==="darwin"?["-Wl,-dead_strip"]:["-Wl,--gc-sections"]),"-o",binary]);
  return binary;
}
const mutations=[
  {name:"original-history-oom",special:"legacy-history",scenario:"allocation_failures"},
  {name:"original-redacted-diag-oom",special:"legacy-diag",scenario:"allocation_failures"},
  {name:"original-live-dwell-mismatch",special:"legacy-values",scenario:"dwell_state_and_identity"},
  {name:"postcommit-rethrow",file:"chunks",scenario:"allocation_failures",
    before:"if (!sink.emission_started()) throw;",after:"throw;"},
  {name:"lost-emission-attempt",file:"chunks",scenario:"first_send_failure_then_oom",
    before:"emission_started_ = true;",after:"/* mutation: do not latch attempted send */"},
  {name:"ignored-chunk-failure",file:"chunks",scenario:"chunk_failures",
    before:"failed_ = true;\n            return;",after:"buffer_.clear(); return;"},
  {name:"omitted-final-send",file:"chunks",scenario:"completed_oracles",
    before:"if (!failed_ && !emit_(std::string_view(), true)) failed_ = true;",after:"/* omitted final send */"},
  {name:"history-epoch-bypass",file:"status",scenario:"history_epoch_refusal",
    before:"if (history_snapshot_epoch != history_epoch())",after:"if (false)"},
  {name:"dwell-identity-bypass",file:"dwell",scenario:"dwell_state_and_identity",
    before:"!hp_values_identity_matches(identity, s_published_identity)",after:"false"},
  {name:"dwell-code-bypass",file:"dwellLogic",scenario:"dwell_state_and_identity",
    before:"slots[static_cast<size_t>(i)].code != code",after:"false"},
  {name:"omitted-dwell-staging",file:"status",scenario:"dwell_state_and_identity",
    before:/dwell_readings_snapshot\(snapshot.x10a.data\(\), snapshot.x10a.size\(\), x10a_identity,\s*snapshot.x10a_dwell.get\(\)\);/,
    after:"/* mutation: omit prepared dwell metadata */"},
  {name:"utf8-output-bypass",file:"json",scenario:"invalid_utf8_output",
    before:"if (u >= 0x80) {",after:"if (false) {"},
];
try {
  const compiler=execute(cxx,["--version"]).stdout.trim();
  const baseline=execute(compile("production"),[]);
  assert.match(baseline.stdout,/PASS total=12\b/);
  const wires=[]; const decoder=new TextDecoder("utf-8",{fatal:true});
  for(const line of baseline.stdout.trim().split("\n")) {
    if(!line.startsWith("WIRE ")) {console.log(line);continue;}
    const [,name,type,hex]=line.match(/^WIRE (\S+) (json|text) ([0-9a-f]*)$/)||[];
    assert.ok(type,`invalid wire record: ${line}`);
    const text=decoder.decode(Buffer.from(hex,"hex"));
    const doc=type==="json"?JSON.parse(text):null;
    if(name==="/status") {
      assert.equal(doc.version,"fixture-version"); assert.equal(doc.platform,"esp32s3");
      assert.equal(doc.wifi.ssid,'Café "quoted"\\line\n'); assert.equal(doc.wifi.rssi,-42);
      assert.equal(doc.sys.stack_min_free_bytes.httpd,null);
    }
    if(name==="/values") {
      assert.equal(doc.values.length,129); assert.equal(doc.values[0].value,"0");
      assert.equal(doc.values[0].dwell_s,5); assert.equal(doc.values[1].held,true);
      assert.equal(doc.values[1].label,'Temp Café "quote"\\unit\n'); assert.equal(doc.values[1].unit,"°C");
      assert.equal(Object.hasOwn(doc,"modbus"),false);
    }
    if(name.startsWith("/history")) {
      assert.equal(doc.id,"leaving_water"); assert.equal(doc.source,"x10a"); assert.equal(doc.epoch,42);
      assert.equal(doc.dt,300); assert.equal(doc.v.length,288); assert.equal(doc.v[0],-100);
      assert.equal(doc.v[1],null); assert.deepEqual(doc.held[0],[1,1]);
      assert.equal(doc.held.length,144); assert.equal(doc.t0,2000000000-10-287*300); assert.equal(doc.b0,100);
      assert.deepEqual(doc.v,Array.from({length:288},(_,i)=>i%2?null:i-100));
      assert.deepEqual(doc.held,Array.from({length:144},(_,i)=>[i*2+1,1]));
    }
    if(name==="invalid-ssid") assert.equal(doc.wifi.ssid,"bad"+"�".repeat(5));
    if(name==="dwell-mismatch") assert.equal(Object.hasOwn(doc.values[0],"dwell_s"),false);
    if(name==="dwell-match") assert.equal(doc.values[0].dwell_s,5);
    if(name==="epoch-refusal") assert.deepEqual(doc,{ok:false,error:"history changed; retry"});
    if(name==="/diag") assert.match(text,/Fixture home network/);
    if(name==="/diag?redact=1") assert.doesNotMatch(text,/Fixture home network|192\.0\.2\.10/);
    if(name==="stable-values") {assert.equal(doc.values.at(-1).value,"0");assert.equal(doc.values.at(-1).dwell_s,5);}
    if(name==="modbus-values") {
      assert.equal(doc.values.length,129);assert.deepEqual(doc.modbus.map(row=>row.value),["U4",12.3,1,null]);
      assert.equal(doc.modbus[2].binary,true);assert.deepEqual(doc.modbus.map(row=>row.off),[22,40,4,40]);
    }
    if(name==="framed-values") {assert.equal(doc.result.values.length,129);assert.equal(doc.result.values[0].dwell_s,5);}
    wires.push({name,type,hex});
  }
  const controls=[];
  if(!process.argv.includes("--no-mutations")) for(const mutation of mutations) {
    const result=execute(compile(mutation.name,mutation),[mutation.scenario],false);
    assert.equal(result.status,1,`${mutation.name}: compiling negative control must fail named oracle\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr,new RegExp(`^FAIL ${mutation.scenario}:`,"m"));
    controls.push({name:mutation.name,oracle:mutation.scenario,stderr:result.stderr});
    console.log(`negative control ${mutation.name}: ${mutation.scenario}`);
  }
  let sanitizerControl=null;
  if(sanitizer) {
    const tripwire={name:"signed-overflow-tripwire",file:"status",scenario:"completed_oracles",
      before:"static esp_err_t h_values(httpd_req_t* req) {",
      after:"static esp_err_t h_values(httpd_req_t* req) {\nvolatile int maximum=2147483647;volatile int overflow=maximum+1;(void)overflow;"};
    const result=execute(compile(tripwire.name,tripwire),[tripwire.scenario],false);
    assert.notEqual(result.status,0,"UBSan tripwire did not terminate");assert.match(result.stderr,/runtime error: signed integer overflow/);
    sanitizerControl={exitCode:result.status,stderr:result.stderr};
    console.log("sanitizer control: signed-overflow tripwire terminated before completing values");
  }
  const hashes=Object.fromEntries(Object.entries(paths).map(([key,file])=>{
    assert.equal(fs.readFileSync(path.join(root,file),"utf8"),sources[key],`source changed during test: ${file}`);
    return [file,createHash("sha256").update(sources[key]).digest("hex")];
  }));
  const dependencies=fs.readFileSync(path.join(temporary,"production/inputs.d"),"utf8").replace(/\\\n/g," ");
  const compiledInputs={};
  for(const file of dependencies.slice(dependencies.indexOf(":")+1).trim().split(/\s+/).filter(Boolean)) {
    const bytes=fs.readFileSync(file),hash=createHash("sha256").update(bytes).digest("hex");
    compiledInputs[file]=hash;
    if(file.startsWith(path.join(temporary,"production/main")+path.sep)) {
      const original=path.join(root,"main",path.relative(path.join(temporary,"production/main"),file));
      assert.equal(createHash("sha256").update(fs.readFileSync(original)).digest("hex"),hash,`included production file changed during tests: ${original}`);
      hashes[path.relative(root,original)]=hash;
    }
  }
  for(const file of ["main/hp_poll.cpp","test/http_stream_runtime/legacy_handlers.json","test/test_http_stream_runtime.mjs"])
    hashes[file]=createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex");
  const record={compiler,sanitizer:sanitizer?"undefined-no-recover":"none",sanitizerControl,commands,hashes,compiledInputs,wires,controls,
    baseline:baseline.stdout.split("\n").filter(line=>!line.startsWith("WIRE ")).join("\n"),
    limits:["Complete unextracted http_common.cpp/http_status.cpp/state_dwell.cpp execute. Unrelated handlers are link-discarded.",
      "Snapshots and SDK transports use shaped adapters; every observed C++ new position and stream chunk/final failure is injected independently. Adapter transport allocations are excluded.",
      "Dwell producer and batch-reader execute; UART poll/cache provider is a controlled immutable-snapshot adapter.",
      "Source/header hashes bind local evidence. Hardware scheduling, target heap/stack and source truth are separate."]};
  if(process.env.HTTP_STREAM_RECORD) fs.writeFileSync(process.env.HTTP_STREAM_RECORD,JSON.stringify(record,null,2)+"\n");
  console.log(`production HTTP stream runtime: 12 cases, ${controls.length} compiling negative controls`);
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
