import assert from "node:assert/strict";
import fs from "node:fs";
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const config = read("main/http_config.cpp");
assert.doesNotMatch(config, /cJSON_Parse\s*\(/, "all config ingress must use bounded parsing");
const readers = [...config.matchAll(/const int\s+body_len\s*=\s*http_read_body\(req, body(?:\.data\(\))?, (?:sizeof\(body\)|body\.size\(\))\);/g)];
const parsers = [...config.matchAll(/json_parse_document\(std::string_view\(body(?:\.data\(\))?, static_cast<size_t>\(body_len\)\)\)/g)];
assert.equal(readers.length, 14, "all 14 current JSON config bodies must retain their actual byte count");
assert.equal(parsers.length, readers.length, "each parser must include embedded NULs in its bounded input");
const guard = read("main/json_guard.hpp");
assert.match(guard, /json_parse_bounded\([\s\S]*?cJSON_ParseWithLengthOpts/,
  "the cJSON adapter must invoke the tested preflight/suffix rule");
const weather = read("main/weather_forecast.cpp");
const at = weather.indexOf("bool parse_forecast(");
assert.ok(at >= 0);
const parser = weather.slice(at, weather.indexOf("bool ok = false", at));
assert.ok(parser.indexOf("json_payload_depth_ok(payload, JSON_MAX_DEPTH)") >= 0 &&
  parser.indexOf("json_payload_depth_ok(payload, JSON_MAX_DEPTH)") < parser.indexOf("cJSON_ParseWithLengthOpts"),
  "Weather must reject excessive depth before recursive parsing");
assert.match(parser, /json_suffix_is_whitespace/,
  "Weather must retain strict trailing-data rejection");
console.log("JSON ingress: every cJSON config body bounded; Weather preflight before parser");

assert.match(config, /parse_ref_temp_request[\s\S]*?std::vector<char> body\(8192\)/,
  "the combined escaped-source request must fit without a large HTTP stack frame");
const topic = "\\".repeat(192), field = "\\".repeat(128);
const body = JSON.stringify({ topic, temperature_path: field, setpoint_topic: topic,
  setpoint_path: field, timestamp_topic: topic, timestamp_path: field });
assert.ok(Buffer.byteLength(body) > 1535 && Buffer.byteLength(body) < 8192);
const status = read("main/http_status.cpp");
assert.match(status, /s_status_boot_id[\s\S]*?esp_random\(\)[\s\S]*?esp_random\(\)/,
  "status must expose one boot-scoped identity independent of uptime comparisons");
assert.ok(status.includes('j += "\\\"boot_id\\\":";'));
