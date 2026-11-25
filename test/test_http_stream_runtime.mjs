import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { renderWireSnapshots } from "../tools/ui/render_wire_snapshot.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=path.join(root,"test/http_stream_runtime");
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"daikin-http-stream-runtime-"));
const commands=[];
const paths={ common:"main/http_common.cpp",status:"main/http_status.cpp",dwell:"main/state_dwell.cpp",
  chunks:"main/logic/chunk_sink.hpp",json:"main/logic/json.hpp",identity:"main/logic/values_identity.hpp",
  dwellLogic:"main/logic/state_dwell.hpp",heartbeat:"main/logic/heartbeat.hpp",
  hydronicPayload:"main/logic/hydronic_payload.hpp",
  heater:"main/logic/heater_context_payload.hpp",jsonOutput:"main/logic/json_output.hpp" };
const sources=Object.fromEntries(Object.entries(paths).map(([key,file])=>[key,fs.readFileSync(path.join(root,file),"utf8")]));
const fixtureSource=fs.readFileSync(path.join(fixture,"fixture.cpp"),"utf8");
const frozen=JSON.parse(fs.readFileSync(path.join(fixture,"legacy_handlers.json"),"utf8"));
assert.equal(frozen.base_commit,"e99da78f38901cfc1421cec7f74e44dbbb632486");
// Complete pre-streaming handler from c9835ea0fa1862615b7cceb71cf8a6e43c199547.
// Compile it in the full production unit so the independent memory/transport oracle rejects it.
const legacyScan=String.raw`static esp_err_t h_scan(httpd_req_t* req) {
    if (ota_download_active()) return network_tls_busy(req);
    WifiScanEntry e[20];
    int n = wifi_scan(e, 20);
    std::string j = "{\"networks\":[";
    for (int i = 0; i < n; i++) {
        if (i) j += ",";
        j += "{\"ssid\":";
        json_append_quoted(j, e[i].ssid);
        j += ",\"rssi\":";
        j += std::to_string(e[i].rssi);
        j += "}";
    }
    j += "]}";
    return http_send_json(req, j.c_str());
}`;
function functionText(source,name,templated=false) {
  const regex=templated?new RegExp(`template <typename JsonOut>\\s*\\nstatic void ${name}\\([^]*?\\n}`)
    :new RegExp(`(?:static )?(?:esp_err_t|logic::DwellReading) ${name}\\([^]*?\\n}`);
  const match=source.match(regex); assert.ok(match,`missing complete function ${name}`); return match[0];
}
const cxx=process.env.CXX||"c++";
const sanitizer=process.argv.includes("--sanitizer=undefined");
function execute(command,args,required=true) {
  commands.push([command,...args]);
  const result=spawnSync(command,args,{cwd:root,encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024});
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
  assert.equal(fs.readFileSync(path.join(fixture,"fixture.cpp"),"utf8"),fixtureSource,"fixture changed after capture");
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
    } else if(mutation.special==="legacy-scan") {
      effective.status=effective.status.replace(functionText(effective.status,"h_scan"),legacyScan);
    } else if(mutation.special==="scan-boundary") {
      const before=functionText(effective.status,"h_scan");
      const after=before.replace("return finish_bounded_stream(chunks,","auto append =")
        .replace(/\}\)\s*\? ESP_OK\s*:\s*ESP_FAIL;/,"};\n    append(chunks);\n    return chunks.finish() ? ESP_OK : ESP_FAIL;");
      assert.notEqual(before,after,"scan boundary mutation must bind production handler");
      assert.doesNotMatch(after,/finish_bounded_stream/);
      effective.status=effective.status.replace(before,after);
    } else if(mutation.special==="refrigerant-total-count") {
      const signature=/const logic::RefrigerantServiceSource&\s+source\)\s*\{/;
      assert.equal([...effective.status.matchAll(new RegExp(signature.source,"g"))].length,1,
        "refrigerant count control must bind append_status_service_meta");
      effective.status=effective.status.replace(signature,
        "const logic::RefrigerantServiceSource& source, uint32_t total_samples) {");
      const before="append_json_uint(j, metric.samples);";
      assert.equal(effective.status.split(before).length-1,1,
        "refrigerant count control must bind the per-metric counter");
      effective.status=effective.status.replace(before,"append_json_uint(j, total_samples);");
      const call=/append_status_service_meta\(\s*j,\s*([^;]+?)\);/g;
      assert.equal([...effective.status.matchAll(call)].length,1,
        "refrigerant count control must bind the metadata loop call");
      effective.status=effective.status.replace(call,
        "append_status_service_meta(j, $1, refrigerant_service.samples);");
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
    ...(mutation?.special==="legacy-history"?["-DHTTP_STREAM_LEGACY_HISTORY"]:[]),
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
  {name:"defrost-start-zero-is-missing",file:"status",scenario:"defrost_start_wire",
    before:"start.outdoor_tenths != logic::CHECKUP_ABSENT",
    after:"start.outdoor_tenths != logic::CHECKUP_ABSENT && start.outdoor_tenths != 0"},
  {name:"history-epoch-bypass",file:"status",scenario:"history_epoch_refusal",
    before:"if (history_snapshot_epoch != history_epoch())",after:"if (false)"},
  {name:"history-separately-rounded-clocks",file:"status",scenario:"restored_history_boot_raster",
    before:/logic::history_commit_unix_s\(unix_s, wall_ms, esp_timer_get_time\(\),\s*history_meta\.newest_commit_us, newest\)/,
    after:"((newest = unix_s - history_meta.newest_age_s), true)"},
  {name:"history-label-escape",file:"status",scenario:"completed_oracles",
    before:String.raw`json_append_quoted(j, lbl);
    j += ",\"dt\":";`,
    after:String.raw`j += "\""; j += lbl; j += "\"";
    j += ",\"dt\":";`},
  {name:"dwell-identity-bypass",file:"dwell",scenario:"dwell_state_and_identity",
    before:"!hp_values_identity_matches(identity, s_published_identity)",after:"false"},
  {name:"dwell-code-bypass",file:"dwellLogic",scenario:"dwell_state_and_identity",
    before:"slots[static_cast<size_t>(i)].code != code",after:"false"},
  {name:"omitted-dwell-staging",file:"status",scenario:"dwell_state_and_identity",
    before:/dwell_readings_snapshot\(snapshot.x10a.data\(\), snapshot.x10a.size\(\), x10a_identity,\s*snapshot.x10a_dwell.get\(\)\);/,
    after:"/* mutation: omit prepared dwell metadata */"},
  {name:"utf8-output-bypass",file:"json",scenario:"invalid_utf8_output",
    before:"if (u >= 0x80) {",after:"if (false) {"},
  {name:"original-growing-scan-body",special:"legacy-scan",scenario:"scan_completed_oracles"},
  {name:"scan-boundary-bypass",special:"scan-boundary",scenario:"scan_failure_boundaries"},
  {name:"omitted-config-unreadable",file:"status",scenario:"config_unreadable_status",
    before:'if (config_stored_blob_unreadable()) j += ",\\\"config_unreadable\\\":true";',
    after:"/* mutation: omit stored configuration warning */"},
  {name:"inverted-config-unreadable",file:"status",scenario:"config_unreadable_status",
    before:'if (config_stored_blob_unreadable()) j += ",\\\"config_unreadable\\\":true";',
    after:'if (!config_stored_blob_unreadable()) j += ",\\\"config_unreadable\\\":true";'},
  {name:"fabricated-unreadable-stop-counts",file:"heartbeat",scenario:"stop_context_absent",
    before:/const bool\s+known = f\.confirmed && f\.has_readable;/,
    after:"const bool known = true;"},
  {name:"lost-covered-zero-stop-population",file:"heartbeat",scenario:"stop_context_covered_zero",
    before:/const bool\s+known = f\.confirmed && f\.has_readable;/,
    after:"const bool known = f.confirmed && f.has_readable && f.counters.witnessed_stops_recent_heating > 0;"},
  {name:"omitted-stop-context",file:"status",scenario:"stop_context_populated",
    before:/append_stop_context_json\(\s*j,\s*diag_effective == DiagnosticsSource::Modbus\s*\?\s*StopContextPayloadFields\{\}\s*:\s*stop_context_payload_fields\(checkup_stop_context_report\(\)\)\);/,
    after:'j += "null";'},
  {name:"leaked-x10a-hydronic-on-modbus",file:"status",scenario:"status_modbus_diagnostics",
    before:/if \(diag_effective == DiagnosticsSource::Modbus\) \{\s*report\s*=\s*\{\};/,
    after:"if (diag_effective == DiagnosticsSource::Modbus) {"},
  {name:"leaked-heating-minimum-windows",file:"status",scenario:"heating_minimum_status",
    before:/append_heating_windows\(j, use_modbus \? modbus\.windows : obs\.minimum_windows,\s*redact \|\| !observed\);/,
    after:"append_heating_windows(j, use_modbus ? modbus.windows : obs.minimum_windows, !observed);"},
  {name:"unsupported-stop-count-leak",file:"heartbeat",scenario:"stop_context_populated",
    before:"number(c.positive[k], known && supported);",after:"number(c.positive[k], known);"},
  {name:"elapsed-on-closed-hour",file:"status",scenario:"cycling_hours_wire",
    before:"if (hi + 1 == hrs.count) {",after:"if (hrs.count) {"},
  {name:"late-checkup-persist-read",file:"status",scenario:"checkup_persist_snapshot",
    before:"json_append_quoted(j, logic::checkup_restore_slug(persist));",
    after:"json_append_quoted(j, checkup_persist_state());"},
  {name:"dhw-zero-rate-is-missing",file:"status",scenario:"dhw_timeline_wire",
    before:'tenths("rate_k_h", w.rate_tenths);',
    after:'tenths("rate_k_h", w.rate_tenths ? w.rate_tenths : -1);'},
  {name:"dhw-zero-observed-is-missing",file:"status",scenario:"dhw_timeline_wire",
    before:String.raw`append_status_opt_uint(j, ",\"observed_end_s\":", dhw_trace->observed,`,
    after:String.raw`append_status_opt_uint(j, ",\"observed_end_s\":", dhw_trace->observed && dhw_trace->observed_end_s != 0,`},
  {name:"dhw-lost-draw-marker",file:"status",scenario:"dhw_timeline_wire",
    before:String.raw`bfield(",\"draw_marker\":", w.draw_marker);`,
    after:String.raw`bfield(",\"draw_marker\":", false);`},
  {name:"dhw-redaction-detail-leak",file:"status",scenario:"dhw_timeline_wire",
    before:"const bool trace_admitted = !redact && c.diagnostics_enabled;",
    after:"const bool trace_admitted = c.diagnostics_enabled;"},
  {name:"incorrect-status-schema-version",file:"status",scenario:"retired_sources_status_and_history",
    before:'ufield("{\\"status_schema_version\\":", 2);',after:'ufield("{\\"status_schema_version\\":", 1);'},
  {name:"truncated-history-source-falls-back",file:"status",scenario:"retired_sources_status_and_history",
    before:"source_err != ESP_ERR_NOT_FOUND && !modbus && !env3_source",
    after:"has_source && !modbus && !env3_source"},
  {name:"refrigerant-total-as-input-count",special:"refrigerant-total-count",scenario:"refrigerant_metadata"},
  {name:"refrigerant-coordinate-swap",file:"status",scenario:"refrigerant_metadata",
    before:"append_json_uint(j, source.reg);",after:"append_json_uint(j, source.off);"},
  {name:"refrigerant-selection-from-availability",file:"status",scenario:"refrigerant_selected_unread",
    before:"if (source.selected) {",after:"if (source.selected && metric.available) {"},
  {name:"stale-secondary-supply",file:"status",scenario:"hydronic_status",
    before:"!report.current || !secondary.samples || !secondary.source.conv",
    after:"!secondary.samples || !secondary.source.conv"},
  {name:"leaked-x10a-water-agreement-on-modbus",file:"status",scenario:"status_modbus_diagnostics",
    before:/if\s*\(diag_effective == DiagnosticsSource::Modbus \|\| !report\.observation\.confirmed\)\s*\{\s*j\s*\+=\s*"null";\s*return;\s*\}\s*append_hydronic_agreement_json\(j, report\);/,
    after:"append_hydronic_agreement_json(j, checkup_hydronic_report());"},
  {name:"unconfirmed-water-agreement-leaked",file:"status",scenario:"hydronic_status",
    before:"if (diag_effective == DiagnosticsSource::Modbus || !report.observation.confirmed) {",
    after:"if (diag_effective == DiagnosticsSource::Modbus) {"},
  {name:"undated-water-agreement-ranges",file:"hydronicPayload",scenario:"hydronic_status",
    before:/const bool\s+known =\s*observation\.confirmed && observation\.dated && totals\.first_evidence_unix_us >= 0;/,
    after:"const bool known = observation.confirmed;"},
  {name:"stale-agreement-current-limits",file:"hydronicPayload",scenario:"hydronic_status",
    before:'w.u64("current_limitations_mask", report.agree_limitations, report.current);',
    after:'w.u64("current_limitations_mask", report.agree_limitations, true);'},
  {name:"omitted-heater-context",file:"status",scenario:"heater_context_populated",
    before:"append_heater_context_status(j, diag_effective);",after:'j += ",\\"context\\":null";'},
  {name:"leaked-x10a-heater-on-modbus",file:"status",scenario:"status_modbus_diagnostics",
    before:"if (diag_effective != DiagnosticsSource::Modbus) {\n        checkup_heater_context_expire();\n        heater_context_payload(fields);\n    }",
    after:"checkup_heater_context_expire();\n    heater_context_payload(fields);"},
  {name:"heater-snapshot-refetched",file:"status",scenario:"heater_context_atomic",
    before:"heater_context_payload(fields);",after:"heater_context_payload(fields); heater_context_payload(fields);"},
  {name:"heater-expiry-omitted",file:"status",scenario:"heater_context_failures",
    before:"checkup_heater_context_expire();",after:"/* mutation: no expiry */"},
  {name:"heater-time-only-observation-lost",file:"heater",scenario:"heater_context_seams",
    before:/const bool\s+observed\s*= f\.confirmed && supported && c\.has_observed;/,
    after:"const bool observed = f.confirmed && supported && c.samples > 0;"},
  {name:"heater-time-only-readable-lost",file:"heater",scenario:"heater_context_seams",
    before:/const bool\s+readable\s*= observed && c\.has_readable;/,
    after:"const bool readable = observed && c.readable_samples > 0;"},
  {name:"heater-unsupported-category-leaked",file:"heater",scenario:"heater_context_populated",
    before:/const bool\s+known\s*= readable && capable && \(c\.evaluable_mask & \(1u << k\)\);/,
    after:"const bool known = readable && (c.evaluable_mask & (1u << k));"},
  {name:"heater-legacy-buh-clock-replaced",file:"status",scenario:"heater_context_populated",
    before:'num("buh_s", ck.a);',after:'num("buh_s", 0);'},
  {name:"heater-legacy-bsh-clock-coupled",file:"status",scenario:"heater_context_populated",
    before:'num("bsh_s", ck.b);',after:'num("bsh_s", ck.a);'},
  {name:"heater-shared-engine-forces-flat-sink",file:"heater",scenario:"heater_context_populated",
    before:"detail::append_heater_context_json_impl(sink, f, flat, selected_heater);",
    after:"detail::append_heater_context_json_impl(sink, f, true, selected_heater);"},
  {name:"stop-shared-engine-flips-flat",file:"heartbeat",scenario:"stop_context_populated",
    before:'if (flat) j += "stop_context_";',after:'if (!flat) j += "stop_context_";'},
];
try {
  const compiler=execute(cxx,["--version"]).stdout.trim();
  const baseline=execute(compile("production"),[]);
  const caseCount=Number(baseline.stdout.match(/^PASS total=(\d+)$/m)?.[1]);
  assert.equal(caseCount,42);
  assert.equal(caseCount,[...baseline.stdout.matchAll(/^PASS (?!total=)\S+$/gm)].length);
  const wires=[]; const decoder=new TextDecoder("utf-8",{fatal:true});
  const configCases=new Map([
    ["config-readable-plain",{unreadable:false,redact:false,absent:false}],
    ["config-readable-redacted",{unreadable:false,redact:true,absent:false}],
    ["config-unreadable-plain",{unreadable:true,redact:false,absent:false}],
    ["config-unreadable-redacted",{unreadable:true,redact:true,absent:false}],
    ["config-absent-plain",{unreadable:false,redact:false,absent:true}],
    ["config-absent-redacted",{unreadable:false,redact:true,absent:true}],
  ]);
  const retirementWires=new Set(["retired-status-plain","retired-status-redacted",
    "retired-room-history","invalid-mqtt-history","truncated-history-source",
    "retained-env3-history","retained-homehub-room-history"]);
  const stopWires=new Set(["stop-unconfirmed","stop-unreadable","stop-covered-zero",
    "stop-populated","stop-populated-redacted"]);
  const secondaryWires=new Map([
    ["secondary-unavailable",null],
    ["secondary-current",{
      delta_k:-0.875,duration_s:15.000001,samples:2,
      source:{reg:101,offset:4,conv:105},zone_context:"unknown",
    }],
    ["secondary-expired",null],
  ]);
  const heatingWindows=(hour,mask)=>({t0:1800000000,slot_s:300,
    hour_masks:Array.from({length:24},(_,i)=>i===hour?mask:0),locations_missing:false});
  const modbusHeating={source:"modbus",reason:"observed",min_l_min:5.2,
    minimum_windows:heatingWindows(23,4)};
  const x10aHeating={source:"x10a",reason:"observed",min_l_min:7.125,
    minimum_windows:heatingWindows(22,16)};
  const heatingWires=new Map([
    ["status-modbus-diagnostics",{source:"modbus",report:modbusHeating}],
    ["heating-modbus-fallback",{source:"x10a",report:modbusHeating}],
    ["heating-modbus-redacted",{source:"x10a",report:{...modbusHeating,minimum_windows:null}}],
    ["heating-x10a-priority",{source:"x10a",report:x10aHeating}],
    ["heating-x10a-with-modbus-diagnostics",{source:"modbus",report:x10aHeating}],
    ["heating-disabled",{source:"x10a",report:null}],
  ]);
  const cyclingWires=new Map([
    ["cycling-partial",{bucket:0,elapsed_s:450,starts:1,run_s:180,observed_s:420,space_s:0,dhw_s:60}],
    ["cycling-edge",{bucket:0,elapsed_s:0,starts:1,run_s:0,observed_s:0}],
    ["cycling-trace-oom",{bucket:0,elapsed_s:0,starts:1,run_s:0,observed_s:0}],
    ["cycling-expired",{bucket:0,elapsed_s:0,starts:1,run_s:0,observed_s:0}],
  ]);
  const persistWires=new Set(["checkup-persist-plain","checkup-persist-redacted",
    "checkup-persist-framed"]);
  // Independently specified real endpoints, rates and paired context; not generated from the
  // fixture's modulo expressions, hourly aggregate count, hero maximum or evenly spaced bars.
  const dhwWindows=[
    [86369,90000,0,3599,false,false],
    [90000,93600,0.7,3581,true,false],
    [93600,97200,1.4,3562,false,true],
    [97200,100800,2.1,3543,true,false],
    [100800,104400,0.3,3524,false,false],
    [104400,108000,1,3600,true,true],
    [108000,111600,1.7,3581,false,false],
    [111600,115200,2.4,3562,true,false],
    [115200,118800,0.6,3543,false,true],
    [118800,122400,1.3,3524,true,false],
    [122400,126000,2,3600,false,false],
    [126000,129600,0.2,3581,true,true],
    [129600,133200,0.9,3562,false,false],
    [133200,136800,1.6,3543,true,false],
    [136800,140400,2.3,3524,false,true],
    [140400,144000,0.5,3600,true,false],
    [144000,147600,1.2,3581,false,false],
    [147600,151200,1.9,3562,true,true],
    [151200,154800,0.1,3543,false,false],
    [154800,158400,0.8,3524,true,false],
    [158400,162000,1.5,3600,false,true],
    [162000,165600,2.2,3581,true,false],
    [165600,169200,0.4,3562,false,false],
    [169200,172800,1.1,3543,true,true],
  ].map(([start_s,end_s,rate_k_h,observed_s,pump_marker,draw_marker])=>
    ({start_s,end_s,rate_k_h,observed_s,pump_marker,draw_marker}));
  const dhwX10a={epoch:71,window_end_s:172800,since_s:80000,observed_end_s:172799,
    unix_s:2000000000,live:true,windows:dhwWindows};
  const dhwModbus={epoch:83,window_end_s:174000,since_s:166000,observed_end_s:173999,
    unix_s:1999999993,live:false,windows:[
      {start_s:169400,end_s:173000,rate_k_h:3.3,observed_s:3581,pump_marker:false,draw_marker:true},
    ]};
  const dhwUnsynced={epoch:71,window_end_s:172800,since_s:80000,observed_end_s:172799,
    live:true,windows:dhwWindows};
  const dhwAggregate={id:"dhw_loss",evidence:"heuristic",verdict:"info",reason:"",
    observed_s:28000,required_s:0,max_k_h:4.5,windows:8,high_windows:3,high_with_pump:2,
    high_pump_off:1,draw_windows:4,pump_windows:5,quiet_high_windows:1,circulation_on_s:600,
    circulation_known_s:7200,candidate_s:137,settle_remaining_s:19,aborts:2,best_aborted_s:119,
    blocked:false,abort_reasons:["reading","blind"]};
  const dhwCases=new Map([
    ["dhw-x10a",{timeline:dhwX10a}],
    ["dhw-mcp-x10a",{timeline:dhwX10a,mcp:true}],
    ["dhw-modbus",{timeline:dhwModbus,source:"modbus"}],
    ["dhw-mcp-modbus",{timeline:dhwModbus,source:"modbus",mcp:true}],
    ["dhw-no-sntp",{timeline:dhwUnsynced,unsynced:true}],
    ["dhw-empty-unobserved",{timeline:{epoch:73,window_end_s:1800,since_s:0,
      observed_end_s:null,live:false,windows:[]},unsynced:true}],
    ["dhw-empty-observed-zero",{timeline:{epoch:74,window_end_s:0,since_s:0,
      observed_end_s:0,live:false,windows:[]},unsynced:true}],
    ["dhw-epoch-zero",{}],
    ["dhw-disabled",{disabled:true}],
    ["dhw-redacted",{redact:true}],
    ["dhw-all-trace-oom",{}],
    ["dhw-only-oom",{cycling:true}],
    ["dhw-mcp-only-oom",{cycling:true,mcp:true}],
    ["dhw-cycling-oom",{timeline:dhwX10a}],
    ["dhw-recovered",{timeline:dhwX10a,cycling:true}],
  ]);
  const dhwSeen=new Set();
  let persistUnknownSeen=false;
  let defrostOutdoorSeen=false;
  const stopIds=["low_rps_above_main_target","request_withdrawal","defrost",
    "dhw_transition","route_mode_transition"];
  const stopCountKeys=["witnessed_stops_recent_heating","unclassified_stops","unknown_stops",
    "partial_stops","censored_stops","target_changed","time_overflow","saturated"];
  const heaterWires=new Set(["heater-unconfirmed","heater-unreadable","heater-unsupported",
    "heater-populated","heater-time-only","heater-unknown-only","heater-subsecond",
    "heater-atomic","heater-maximum","heater-expired","heater-recovered"]);
  const heaterIds=["emergency","error","defrost_recovery","dhw_route","silent",
    "cold_outdoor","mild_outdoor","compressor_off","quiet_mild_heating"];
  const refrigerantWires=new Set(["refrigerant-populated","refrigerant-populated-redacted",
    "refrigerant-selected-unread","refrigerant-selected-unread-redacted",
    "refrigerant-missing","refrigerant-gap","refrigerant-new-source",
    "refrigerant-unevaluated","refrigerant-undetected"]);
  const refrigerantMetrics={
    compressor_rps:{min:20,mean:25,max:30},
    discharge_c:{min:60.1,mean:65.2,max:70.3},
    eev_command_pls:{min:100,mean:120,max:140},
    high_pressure_bar:{min:12.1,mean:14.2,max:16.3},
    low_pressure_bar:{min:1.1,mean:2.2,max:3.3},
  };
  const refrigerantSources={
    compressor_rps:{kind:"x10a",reg:48,offset:0,conv:152},
    discharge_c:{kind:"x10a",reg:32,offset:4,conv:105},
    eev_command_pls:{kind:"x10a",reg:48,offset:3,conv:151},
    high_pressure_bar:{kind:"x10a",reg:98,offset:15,conv:105},
    low_pressure_bar:{kind:"x10a",reg:32,offset:14,conv:105},
  };
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
      assert.equal(Object.hasOwn(doc.sys,"config_unreadable"),false);
      assert.equal(Object.hasOwn(doc,"refrigerant_service"),false);
    }
    if(refrigerantWires.has(name)) {
      assert.equal(doc.health.checks.length,8,`${name}: service remains outside the eight checks`);
      if(name==="refrigerant-unevaluated"||name==="refrigerant-undetected") {
        assert.equal(Object.hasOwn(doc,"refrigerant_service"),false,
          `${name}: no fabricated observation before detection and coverage`);
      } else {
        const missing=name==="refrigerant-missing";
        const selectedUnread=name==="refrigerant-selected-unread"||
          name==="refrigerant-selected-unread-redacted";
        const reset=name==="refrigerant-gap"||name==="refrigerant-new-source";
        const metrics=structuredClone(refrigerantMetrics);
        const sources=structuredClone(refrigerantSources);
        if(name==="refrigerant-new-source")
          sources.high_pressure_bar={kind:"x10a",reg:32,offset:12,conv:105};
        if(missing) sources.low_pressure_bar=null;
        const counts={compressor_rps:7,discharge_c:7,eev_command_pls:7,
          high_pressure_bar:missing?7:6,low_pressure_bar:selectedUnread?7:4};
        for(const key of Object.keys(metrics)) {
          if(reset||(missing&&key==="low_pressure_bar")||(selectedUnread&&key==="high_pressure_bar")) {
            counts[key]=0; metrics[key]=null;
          }
        }
        const meta=Object.fromEntries(Object.keys(metrics).map(key=>[key,{samples:counts[key],source:sources[key]}]));
        assert.deepEqual(doc.refrigerant_service,{
          kind:"observation",state:name==="refrigerant-gap"?"interrupted":
            name==="refrigerant-new-source"?"waiting":"limited",
          continuous_s:reset?0:30,samples:reset?0:7,
          source_generation:name==="refrigerant-new-source"?32:31,mode:"heating",
          blocker:name==="refrigerant-gap"?"poll_gap":
            name==="refrigerant-new-source"?"missing_fresh_signal":null,
          special_phases_known:true,load_proven:false,eev_feedback:false,
          limitations:reset?[]:["pressure_sides_incomplete"],metrics,metric_meta:meta,
        },`${name}: complete independent legacy-value and metadata wire oracle`);
      }
      refrigerantWires.delete(name);
    }
    if(cyclingWires.has(name)) {
      const cycling=doc.health.checks.find(check=>check.id==="cycling");
      assert.equal(cycling?.hours_epoch,17,name);
      const closed=name==="cycling-expired"
        ? {bucket:-1,expired:true,starts:0,run_s:0,observed_s:0}
        : {bucket:-1,end_unix_s:1999998000,restored:true,starts:2,run_s:1200,observed_s:2700,space_s:600,dhw_s:300};
      assert.deepEqual(cycling.hours,[closed,cyclingWires.get(name)],name);
      if (["cycling-expired", "cycling-trace-oom"].includes(name))
        assert.equal(cycling.timeline, undefined);
      else assert.deepEqual(cycling.timeline, {
        unix_s: 2000000000, window_end_s: 86400, observed_end_s: 86399,
        boot_s: 451, live: true, run_edges: true,
        records: [[86359, 1], [86369, 5], [86369, 3], [86389, 1], [86390, 6]]
          .map(([time, kind]) => time * 8 + kind),
      });
      cyclingWires.delete(name);
    }
    if(name.startsWith("dhw-")) {
      assert.ok(dhwCases.has(name),`${name}: unexpected DHW wire case`);
      assert.ok(!dhwSeen.has(name),`${name}: duplicate DHW wire case`);
      dhwSeen.add(name);
      const expected=dhwCases.get(name);
      const status=expected.mcp?doc.result.structuredContent:doc;
      if(expected.mcp) {
        assert.deepEqual(Object.keys(doc),["jsonrpc","id","result"],name);
        assert.equal(doc.jsonrpc,"2.0",name);
        assert.equal(doc.id,73,name);
        assert.deepEqual(Object.keys(doc.result),["content","structuredContent","isError"],name);
        assert.deepEqual(doc.result.content,[{type:"text",text:"Current device and heat-pump status."}],name);
        assert.equal(doc.result.isError,false,name);
      }
      assert.equal(status.version,"fixture-version",name);
      assert.equal(status.health.source,expected.source??"x10a",name);
      assert.equal(status.diagnostics.source,expected.source??"x10a",name);
      assert.equal(status.diagnostics.effective_source,expected.source??"x10a",name);
      assert.equal(status.diagnostics.enabled,!expected.disabled,name);
      assert.equal(status.ntp.synced,!expected.unsynced,name);
      if(expected.unsynced) assert.equal(status.ntp.time,null,name);
      assert.equal(status.health.checks.length,8,`${name}: retain the eight diagnosis rows`);
      const dhw=status.health.checks.find(check=>check.id==="dhw_loss");
      assert.ok(dhw,`${name}: DHW row must remain present without optional detail`);
      const {timeline,...aggregate}=dhw;
      assert.deepEqual(aggregate,dhwAggregate,`${name}: optional detail cannot replace aggregate evidence`);
      assert.equal(Object.hasOwn(dhw,"timeline"),expected.timeline!==undefined,
        `${name}: refusal means absent, not null or an empty substitute`);
      assert.deepEqual(timeline,expected.timeline,`${name}: exact DHW frame, endpoints, rates and context`);
      const rawRates=[...text.matchAll(/"rate_k_h":([^,}\]]+)/g)].map(match=>match[1]);
      assert.deepEqual(rawRates,(expected.timeline?.windows??[]).map(window=>window.rate_k_h.toFixed(1)),
        `${name}: rates must be numeric with exactly one decimal, including 0.0`);
      if(timeline) {
        assert.ok(timeline.epoch>0&&timeline.windows.length<=24,name);
        for(const key of ["epoch","window_end_s","since_s","observed_end_s","unix_s"])
          if(timeline[key]!==undefined&&timeline[key]!==null)
            assert.ok(Number.isInteger(timeline[key])&&timeline[key]>=0&&timeline[key]<=0xffffffff,
              `${name}/${key}: unsigned monotonic metadata or trusted anchor`);
        const rawWindows=timeline.windows.map(window=>
          `{"start_s":${window.start_s},"end_s":${window.end_s},"rate_k_h":${window.rate_k_h.toFixed(1)},`+
          `"observed_s":${window.observed_s},"pump_marker":${window.pump_marker},"draw_marker":${window.draw_marker}}`);
        assert.ok(text.includes('"windows":['+rawWindows.join(",")+"]"),
          `${name}: completed records must stream compactly without invented metadata`);
        for(const [index,window] of timeline.windows.entries()) {
          assert.ok(Number.isInteger(window.start_s)&&Number.isInteger(window.end_s),name);
          // Real elapsed evaluations are 3600..3630 s. Independently floored endpoint timestamps
          // can differ by 3631 s, so rejecting that wire span would discard real evidence.
          assert.ok(window.end_s-window.start_s>=3600&&window.end_s-window.start_s<=3631,name);
          assert.ok(window.start_s>=timeline.since_s&&window.end_s<=timeline.window_end_s,name);
          assert.ok(window.end_s>timeline.window_end_s-86400,`${name}: retain by completion, not start`);
          if(index) assert.ok(timeline.windows[index-1].end_s<=window.start_s,
            `${name}: chronological, non-overlapping windows`);
          assert.ok(Number.isFinite(window.rate_k_h)&&window.rate_k_h>=0,name);
          assert.ok(Number.isInteger(window.observed_s)&&window.observed_s>=0&&
            window.observed_s<=window.end_s-window.start_s,name);
          assert.equal(typeof window.pump_marker,"boolean",name);
          assert.equal(typeof window.draw_marker,"boolean",name);
        }
        if(timeline.windows.length===24) {
          assert.equal(timeline.windows[0].end_s-timeline.windows[0].start_s,3631,name);
          assert.ok(timeline.windows[0].start_s<timeline.window_end_s-86400,name);
          assert.equal(Math.max(...timeline.windows.map(window=>window.rate_k_h)),2.4,name);
          assert.ok(dhw.windows<timeline.windows.length,`${name}: no clamping timed records to aggregate count`);
        }
        if(expected.source==="modbus") {
          assert.equal(timeline.windows[0].rate_k_h,3.3,name);
          assert.ok(dhw.windows>timeline.windows.length,`${name}: no synthetic bars for aggregate-only windows`);
        }
      }
      const cycling=status.health.checks.find(check=>check.id==="cycling");
      assert.equal(cycling.hours_epoch,17,name);
      assert.deepEqual(cycling.hours,[
        {bucket:-1,starts:2,run_s:1800,observed_s:3600,space_s:900,dhw_s:900},
        {bucket:0,elapsed_s:137,starts:1,run_s:60,observed_s:120,space_s:0,dhw_s:60},
      ],`${name}: admission or DHW OOM must not lose compact cycling hours`);
      assert.equal(Object.hasOwn(cycling,"timeline"),!!expected.cycling,name);
      if(expected.cycling) assert.deepEqual(cycling.timeline,{
        unix_s:2000000000,window_end_s:86400,observed_end_s:86399,boot_s:451,live:true,
        run_edges:true,records:[86359*8+1,86369*8+3],
      },`${name}: DHW-only OOM must retain the independent cycling snapshot`);
      if(expected.redact) assert.equal(status.wifi.ssid,"<redacted>",name);
    }
    if(persistWires.delete(name)) {
      const health=(name==="checkup-persist-framed"?doc.result:doc).health;
      assert.equal(health.persist,"flash",name);
      assert.equal(health.covered_s,1200,name);
      const cycling=health.checks.find(check=>check.id==="cycling");
      assert.equal(cycling.hours_epoch,17,name);
      assert.deepEqual(cycling.hours,[
        {bucket:-1,end_unix_s:1999998000,restored:true,starts:2,run_s:600,observed_s:1200,space_s:600,dhw_s:0},
        {bucket:0,elapsed_s:0,starts:0,run_s:0,observed_s:0},
      ],name);
    }
    if(name==="checkup-persist-unknown") {
      assert.equal(doc.health.persist,"unknown",name);
      assert.equal(doc.health.covered_s,0,name);
      assert.equal(doc.health.source_fresh,false,name);
      const cycling=doc.health.checks.find(check=>check.id==="cycling");
      assert.deepEqual(cycling.hours,[],name);
      assert.equal(cycling.timeline,undefined,name);
      persistUnknownSeen=true;
    }
    if(secondaryWires.has(name)) {
      const flow=doc.health.checks.find(check=>check.id==="flow");
      assert.equal(doc.health.checks.length,8,name);
      assert.equal(flow?.min_l_min,6.5,name);
      assert.deepEqual(flow.secondary_supply,secondaryWires.get(name),name);
      const isUnavailable=name==="secondary-unavailable";
      const current=name==="secondary-current";
      assert.deepEqual(flow.water_agreement,isUnavailable?{
        method:2,settling_s:600,stable_window_s:300,max_drift_k:0.5,min_flow_l_min:5,max_gap_s:15,
        reason_code:3,reason:"no_source",settling_remaining_s:null,
        current_limitations_mask:null,population_limitations_mask:0,
        r1_r4:{supported:false,qualified_s:0,windows:0,samples:0,delta_k:{min:null,mean:null,max:null}},
        r2_r1:{supported:false,qualified_s:0,windows:0,samples:0,delta_k:{min:null,mean:null,max:null}},
      }:{
        method:2,settling_s:600,stable_window_s:300,max_drift_k:0.5,min_flow_l_min:5,max_gap_s:15,
        reason_code:0,reason:"none",settling_remaining_s:null,
        current_limitations_mask:current?2:null,population_limitations_mask:3,
        r1_r4:{supported:true,qualified_s:35.000001,windows:1,samples:2,delta_k:{min:-0.3,mean:-0.25,max:-0.1}},
        r2_r1:{supported:true,qualified_s:15,windows:1,samples:3,delta_k:{min:0.2,mean:0.3,max:0.4}},
      },`${name}: water_agreement wire oracle`);
      secondaryWires.delete(name);
    }
    if(name==="status-modbus-diagnostics") {
      const flow=doc.health.checks.find(check=>check.id==="flow");
      assert.equal(flow?.secondary_supply,null,name);
      assert.equal(flow?.water_agreement,null,name);
    }
    if(name==="status-x10a-defrost-outdoor") {
      assert.equal(doc.health.source_fresh,true,name);
      const defrost=doc.health.checks.find(check=>check.id==="defrost");
      assert.equal(defrost?.verdict,"info",name);
      assert.equal(defrost?.outdoor_source,"x10a",name);
      assert.equal(defrost?.outdoor_min_c,-4.5,name);
      assert.equal(defrost?.outdoor_mean_c,-2,name);
      assert.equal(defrost?.outdoor_samples,12,name);
      assert.deepEqual(defrost?.last_observed_start,{unix_s:2000000000,route:"space_heating",outdoor_c:-2.5},name);
      defrostOutdoorSeen=true;
    }
    if(heatingWires.has(name)) {
      const {source,report}=heatingWires.get(name);
      assert.equal(doc.health.source,source,name);
      const flow=doc.health.checks.find(check=>check.id==="flow");
      assert.deepEqual(flow?.heating_minimum,report,name);
      assert.deepEqual(flow?.minimum_windows,name==="heating-x10a-priority"
        ?x10aHeating.minimum_windows:null,`${name}: legacy X10A windows`);
      assert.equal(flow?.min_l_min,source==="x10a"&&report?6.5:null,`${name}: legacy pump minimum`);
      heatingWires.delete(name);
    }
    if(stopWires.has(name)) {
      const cycling=doc.health.checks.find(check=>check.id==="cycling");
      assert.ok(cycling,`${name}: retain the existing cycling row`);
      assert.equal(doc.health.checks.length,8,`${name}: no ninth check row`);
      assert.equal(cycling.verdict,"unavailable");
      for(const key of ["starts","mean_run_s","space_runs","space_mean_run_s"])
        assert.equal(cycling[key],null,`${name}: stop observations cannot fabricate ${key}`);
      const s=cycling.stop_context;
      assert.equal(s.denominator,"witnessed_stops_recent_heating");
      assert.equal(s.window_s,30);assert.equal(s.max_gap_s,15);
      assert.equal(s.low_rps,22);assert.equal(s.above_main_target_k,2);
      assert.deepEqual(Object.keys(s.categories),stopIds);
      assert.ok(Buffer.byteLength(JSON.stringify(s))<=2048,`${name}: stop object must stay bounded`);
      assert.ok(text.includes('"stop_context":'+JSON.stringify(s)),`${name}: stop JSON must be compact`);
      if(name==="stop-unconfirmed"||name==="stop-unreadable") {
        const confirmed=name==="stop-unreadable";
        assert.equal(s.confirmed,confirmed);
        assert.equal(s.capability_mask,confirmed?31:null);
        assert.equal(s.readable_s,confirmed?0:null);
        assert.equal(s.observed_hours,confirmed?0:null);
        assert.equal(s.dropped,confirmed?0:null);
        for(const key of stopCountKeys) assert.equal(s[key],null,`${name}/${key}`);
        for(const category of Object.values(s.categories))
          assert.deepEqual(category,{supported:confirmed?true:null,positive:null,evaluable:null,complete:null});
        assert.equal(s.pending,false);assert.equal(s.dated,false);assert.equal(s.coverage_partial,true);
        assert.equal(s.restore_pending,true);assert.equal(s.persistence_pending,false);
      } else if(name==="stop-covered-zero") {
        assert.equal(s.confirmed,true);assert.equal(s.capability_mask,31);
        assert.equal(s.readable_s,37);assert.equal(s.observed_hours,1);assert.equal(s.dropped,0);
        for(const key of stopCountKeys) assert.equal(s[key],key==="saturated"?false:0,`${name}/${key}`);
        for(const category of Object.values(s.categories))
          assert.deepEqual(category,{supported:true,positive:0,evaluable:0,complete:0});
        assert.equal(s.pending,false);assert.equal(s.dated,true);assert.equal(s.coverage_partial,false);
        assert.equal(s.restore_pending,false);assert.equal(s.persistence_pending,false);
      } else {
        assert.deepEqual(cycling.hours,[
          {bucket:-1,starts:2,run_s:1800,observed_s:3600,space_s:900,dhw_s:900},
          {bucket:0,elapsed_s:3600,starts:1,run_s:600,observed_s:3600,space_s:0,dhw_s:0},
        ],`${name}: witnessed and unassigned runtime survive alongside stop context`);
        assert.equal(s.confirmed,true);assert.equal(s.capability_mask,27);
        assert.equal(s.readable_s,3600);assert.equal(s.observed_hours,2);assert.equal(s.dropped,9);
        assert.deepEqual(stopCountKeys.map(key=>s[key]),[7,1,2,3,2,1,0,true]);
        assert.deepEqual(s.categories,{
          low_rps_above_main_target:{supported:true,positive:3,evaluable:6,complete:4},
          request_withdrawal:{supported:true,positive:4,evaluable:7,complete:5},
          defrost:{supported:false,positive:null,evaluable:null,complete:null},
          dhw_transition:{supported:true,positive:2,evaluable:5,complete:3},
          route_mode_transition:{supported:true,positive:3,evaluable:6,complete:4},
        });
        assert.ok(Object.values(s.categories).reduce((n,c)=>n+(c.positive??0),0)>
          s.witnessed_stops_recent_heating,"positive observations overlap without normalization");
        assert.equal(s.pending,true);assert.equal(s.dated,false);assert.equal(s.coverage_partial,true);
        assert.equal(s.restore_pending,false);assert.equal(s.persistence_pending,true);
      }
      stopWires.delete(name);
    }
    if(heaterWires.has(name)) {
      heaterWires.delete(name);
      assert.equal(doc.health.checks.length,8,"heater context remains within its existing check row");
      const row=doc.health.checks.find(check=>check.id==="heater"),s=row.context;
      assert.ok(s,`${name}: actual status must include the independent typed context`);
      assert.equal(s.max_gap_s,15);assert.equal(s.recovery_s,300);assert.equal(s.notice_s,900);
      assert.equal(s.mild_boundary_tenths_c,20);assert.equal(s.categories_overlap,true);
      for(const h of [s.buh,s.bsh]) {
        assert.deepEqual(Object.keys(h.categories),heaterIds);
        assert.ok(Buffer.byteLength(JSON.stringify(h))<=2048,`${name}: per-heater wire object bound`);
      }
      if(name==="heater-populated") {
        assert.deepEqual([row.buh_s,row.bsh_s,row.buh_observed_s,row.bsh_observed_s],[17,29,111,222]);
      } else assert.deepEqual([row.buh_s,row.bsh_s,row.buh_observed_s,row.bsh_observed_s],[null,null,null,null],
        `${name}: independent context must never backfill legacy BUH/BSH clocks`);
      if(name==="heater-unconfirmed"||name==="heater-expired") {
        assert.equal(s.confirmed,false);assert.equal(s.epoch,null);assert.equal(s.capability_mask,null);
        for(const h of [s.buh,s.bsh]) {
          assert.equal(h.supported,null);assert.equal(h.on_s,null);assert.equal(h.samples,null);
          for(const category of Object.values(h.categories)) assert.deepEqual(category,
            {supported:null,positive_s:null,evaluable_on_s:null,positive_samples:null});
        }
      } else if(name==="heater-unreadable"||name==="heater-unsupported") {
        assert.equal(s.confirmed,true);
        for(const h of [s.buh,s.bsh]) {
          assert.equal(h.supported,name==="heater-unreadable");
          assert.equal(h.readable_s,null);assert.equal(h.on_s,null);
          assert.equal(h.samples,name==="heater-unreadable"?0:null);
        }
      } else if(name==="heater-time-only") {
        assert.equal(s.epoch,73);
        for(const [h,wanted] of [[s.buh,2],[s.bsh,3]]) {
          assert.equal(h.on_s,wanted);assert.equal(h.readable_s,wanted);assert.equal(h.samples,0);
          assert.deepEqual(h.categories.emergency,{supported:true,positive_s:wanted,evaluable_on_s:wanted,positive_samples:0});
        }
      } else if(name==="heater-unknown-only") {
        for(const h of [s.buh,s.bsh]) {
          assert.equal(h.unreadable_s,2);assert.equal(h.samples,0);assert.equal(h.readable_s,0);
          assert.equal(h.on_s,null);assert.equal(h.categories.emergency.positive_s,null);
        }
      } else if(name==="heater-subsecond") {
        assert.equal(s.buh.on_s,0);assert.equal(s.buh.samples,2);
        assert.deepEqual(s.buh.categories.emergency,{supported:true,positive_s:0,evaluable_on_s:0,positive_samples:1});
      } else if(name==="heater-maximum") {
        assert.equal(s.epoch,4294967295);
        for(const h of [s.buh,s.bsh]) {
          assert.equal(h.on_s,4294967295);assert.equal(h.samples,4294967295);assert.equal(h.saturated,true);
        }
      } else {
        assert.equal(s.epoch,73);assert.equal(s.dropped,3);assert.equal(s.persistence_pending,true);
        assert.equal(s.buh.on_s,3);assert.equal(s.bsh.on_s,7);
        assert.deepEqual(s.bsh.categories.silent,{supported:true,positive_s:0,evaluable_on_s:7,positive_samples:0});
        for(const h of [s.buh,s.bsh]) assert.deepEqual(h.categories.cold_outdoor,
          {supported:false,positive_s:null,evaluable_on_s:null,positive_samples:null});
      }
    }
    if(configCases.has(name)) {
      const expected=configCases.get(name);
      assert.equal(Object.hasOwn(doc.sys,"config_unreadable"),expected.unreadable,name);
      if(expected.unreadable) assert.equal(doc.sys.config_unreadable,true,name);
      assert.equal(doc.wifi.ssid,expected.absent?"":expected.redact?"<redacted>":'Café "quoted"\\line\n',name);
      configCases.delete(name);
    }
    if(name==="/values") {
      assert.equal(doc.values.length,129); assert.equal(doc.values[0].value,"0");
      assert.equal(doc.values[0].dwell_s,5); assert.equal(doc.values[1].held,true);
      assert.equal(Object.hasOwn(doc.values[1],"held_unknown"),false);
      assert.equal(doc.values[2].held_unknown,true); assert.equal(Object.hasOwn(doc.values[2],"held"),false);
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
    if(name==="restored-history") {
      assert.equal(doc.boot_b0,-288);
      assert.equal(Object.hasOwn(doc,"b0"),false);
      assert.equal(doc.v.length,288);
      assert.equal(doc.t0,2000000099-287*300);
      assert.match(doc.boot_id,/^[0-9a-f]{16}$/);
    }
    if(name==="retired-status-plain"||name==="retired-status-redacted") {
      assert.equal(doc.status_schema_version,2);
      for(const field of ["heating_curve","weather_forecast","reference_temperature"])
        assert.equal(Object.hasOwn(doc,field),false,field);
      assert.equal(Object.hasOwn(doc.history,"room_rows"),false);
      assert.equal(Object.hasOwn(doc.sys.stack_min_free_bytes,"weather"),false);
      assert.equal(doc.modbus.enabled,true);
      assert.equal(doc.modbus.connected,true);
      assert.equal(doc.modbus.host,name==="retired-status-plain"?"fixture-homehub.invalid":"<redacted>");
      assert.ok(doc.history.modbus_rows.some(row=>row.id==="room_temp"),"HomeHub retains its own room sensor");
      assert.equal(doc.env3.fresh,true);
      assert.deepEqual([doc.env3.temperature_c,doc.env3.humidity_pct,doc.env3.pressure_hpa],[8.5,71.25,1016.75]);
      assert.deepEqual(doc.history.env3_rows.map(row=>row.id),["env3_temperature","env3_humidity","env3_pressure"]);
      assert.ok(doc.health.checks.some(row=>row.id==="dhw_loss"),"ordinary plant diagnostics remain available");
    }
    if(name==="retired-room-history"||name==="invalid-mqtt-history"||name==="truncated-history-source")
      assert.deepEqual(doc,{ok:false,error:"unknown source"},name);
    if(name==="retained-env3-history"||name==="retained-homehub-room-history") {
      const env3=name==="retained-env3-history";
      assert.equal(doc.id,env3?"env3_temperature":"room_temp");
      assert.equal(doc.source,env3?"env3":"modbus");
      assert.equal(doc.epoch,42);
      assert.equal(doc.unit,"°C");
      assert.equal(doc.v.length,288);
      assert.equal(doc.v[0],-100);
      assert.equal(doc.v[1],null);
      assert.deepEqual(doc.held,[]);
    }
    retirementWires.delete(name);
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
    if(name==="framed-status-redacted") {
      assert.deepEqual(Object.keys(doc),["result"]);
      assert.equal(doc.result.sys.config_unreadable,true);
      assert.equal(doc.result.wifi.ssid,"<redacted>");
    }
    if(name==="scan-empty") assert.deepEqual(doc,{networks:[]});
    if(name==="scan-maximum-invalid") {
      assert.deepEqual(Object.keys(doc),["networks"]);
      assert.equal(doc.networks.length,20);
      for(const [i,row] of doc.networks.entries()) {
        assert.deepEqual(Object.keys(row),["ssid","rssi"]);
        assert.equal(Array.from(row.ssid).length,32);
        assert.ok(Array.from(row.ssid).every(character=>character.codePointAt(0)===0xfffd));
        assert.equal(row.rssi,i===0?-128:i===18?0:i===19?127:-i);
      }
    }
    if(name==="scan-unicode-escape") assert.deepEqual(doc,{networks:[{ssid:"Café \"quoted\"\\line\n",rssi:-42}]});
    if(name==="status-modbus-diagnostics") {
      assert.equal(doc.gas_comparison.configured,true);
      assert.equal(doc.gas_comparison.currency,"CHF");
      assert.equal(doc.gas_comparison.gas_efficiency_pct,88);
      assert.equal(doc.working_figure.pel_source,"modbus");
      assert.equal(doc.working_figure.state,"limited");
      assert.equal(doc.working_figure.limited_buh,true);
    }
    wires.push({name,type,hex});
  }
  assert.equal(configCases.size,0,"all plain/redacted stored and absent configuration cases must run");
  assert.equal(retirementWires.size,0,"all retirement and retained-source wire oracles must run");
  assert.equal(stopWires.size,0,"all unknown, covered-zero and populated stop-context wire oracles must run");
  assert.equal(heaterWires.size,0,"all independent heater population/seam/lifecycle wire oracles must run");
  assert.equal(cyclingWires.size,0,"both partially elapsed and start-edge cycling frames must run");
  assert.deepEqual([...dhwSeen].sort(),[...dhwCases.keys()].sort(),
    "all DHW source, frame, admission, OOM, redaction and MCP wire oracles must run exactly once");
  assert.equal(persistWires.size,0,"plain, redacted and framed diagnosis snapshots must run");
  assert.ok(persistUnknownSeen,"unreadable diagnosis snapshot must run");
  assert.ok(defrostOutdoorSeen,"X10A defrost outdoor status snapshot must run");
  assert.equal(refrigerantWires.size,0,"all populated, missing, reset and omitted refrigerant wire oracles must run");
  assert.equal(secondaryWires.size,0,"all secondary-supply wire cases must be present");
  assert.equal(heatingWires.size,0,"all heating-minimum wire cases must be present");
  const wireUiCount=renderWireSnapshots(wires);
  console.log(`WIRE->UI contract bridge: ${wireUiCount} C++ snapshot scenarios rendered through strict DOM`);
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
  assert.equal(fs.readFileSync(path.join(fixture,"fixture.cpp"),"utf8"),fixtureSource,"fixture changed during test");
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
  for(const file of ["main/logic/dhw_loss_trace.hpp","main/logic/mcp.hpp","main/logic/heater_context_payload.hpp","main/logic/json_output.hpp"])
    assert.ok(Object.hasOwn(hashes,file),`new DHW/framing/heater input must appear in compiler dependency hashes: ${file}`);
  for(const file of ["main/hp_poll.cpp","test/http_stream_runtime/legacy_handlers.json","test/test_http_stream_runtime.mjs"])
    hashes[file]=createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex");
  const record={compiler,sanitizer:sanitizer?"undefined-no-recover":"none",sanitizerControl,commands,hashes,compiledInputs,wires,controls,
    baseline:baseline.stdout.split("\n").filter(line=>!line.startsWith("WIRE ")).join("\n"),
    limits:["Complete unextracted http_common.cpp/http_status.cpp/state_dwell.cpp execute. Unrelated handlers are link-discarded.",
      "Snapshots and SDK transports use shaped adapters; every observed C++ new position and stream chunk/final failure is injected independently. Adapter transport allocations are excluded.",
      "Dwell producer and batch-reader execute; UART poll/cache provider is a controlled immutable-snapshot adapter.",
      "DHW source-specific report snapshots are controlled adapters. Production HTTP serialization and MCP framing helpers execute, not the MCP dispatcher or DHW producer/lifecycle/persistence.",
      "Refrigerant metadata uses controlled typed snapshots, with independent full JSON field oracles. Producer eligibility, source selection and resets are tested separately; these wires do not prove them or physical sensor pairing.",
      "Source/header hashes bind local evidence. Hardware scheduling, target heap/stack and source truth are separate."]};
  if(process.env.HTTP_STREAM_RECORD) fs.writeFileSync(process.env.HTTP_STREAM_RECORD,JSON.stringify(record,null,2)+"\n");
  console.log(`production HTTP stream runtime: ${caseCount} cases, ${controls.length} compiling negative controls`);
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
