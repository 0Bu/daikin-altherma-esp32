import assert from "node:assert/strict";
import fs from "node:fs";
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const config = read("main/http_config.cpp");
assert.doesNotMatch(config, /cJSON_Parse\s*\(/, "all config ingress must use bounded parsing");
const readers = [...config.matchAll(/const int\s+length\s*=\s*http_read_body\(req, body\.get\(\), capacity\);/g)];
const parsers = [...config.matchAll(/json_parse_document\(std::string_view\(body\.get\(\), static_cast<size_t>\(length\)\)\)/g)];
const consumers = [...config.matchAll(/JsonGuard\s+j\(read_config_document\(req,\s*\d+,\s*parse_error\)\);/g)];
assert.equal(readers.length, 1, "configuration ingress must share the byte-counted reader");
assert.equal(parsers.length, 1, "the shared parser must include embedded NULs in its bounded input");
assert.equal(consumers.length, 13, "all 13 current JSON config bodies must own the shared parsed document");
assert.match(config, /if \(length < 0\)\s*\{\s*error = "bad body";\s*return nullptr;/,
  "a failed bounded read must never reach the parser");
const guard = read("main/json_guard.hpp");
assert.match(guard, /json_parse_document\(std::string_view payload\)\s*\{\s*if \(!json_payload_is_object\(payload\)\) return nullptr;/,
  "configuration ingress must reject non-object roots before parsing or applying defaults");
assert.match(guard, /json_parse_bounded\([\s\S]*?cJSON_ParseWithLengthOpts/,
  "the cJSON adapter must invoke the tested preflight/suffix rule");
assert.match(config, /std::unique_ptr<char\[\]>\s+body\(new char\[capacity\]\)/,
  "shared request scratch must have bounded heap ownership");
const status = read("main/http_status.cpp");
assert.match(status, /s_status_boot_id[\s\S]*?esp_random\(\)[\s\S]*?esp_random\(\)/,
  "status must expose one boot-scoped identity independent of uptime comparisons");
assert.ok(status.includes('j += "\\\"boot_id\\\":";'));

const mqtt = read("main/mqtt_ha.cpp");
const decode = mqtt.indexOf("decode_circulation_frame(");
const parser = mqtt.slice(decode, mqtt.indexOf("static MqttSourceFreshness", decode));
const parse = parser.indexOf("cJSON_ParseWithLengthOpts");
assert.ok(decode >= 0 && parse >= 0, "the circulation witness must parse the bounded complete payload");
for (const check of ["json_payload_strings_ok", "json_payload_depth_ok"]) {
  assert.ok(parser.indexOf(check) >= 0 && parser.indexOf(check) < parse,
    check + " must precede recursive parsing");
}
assert.match(parser, /json_suffix_is_whitespace/, "the circulation decoder must reject trailing data");
console.log("JSON ingress: bounded config and circulation parsers");
