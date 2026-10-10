// Execute the production OTA status handler with host HTTP adapters; no copied serializer or
// config/network mutation. Also pin the log-producer and ring-helper bindings host CHECKs cannot see.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

for (const [file, expressions] of Object.entries({
  "main/wifi.cpp": ["DiagLogIdentifier(rollback_cfg.wifi_ssid).c_str()", "DiagLogIdentifier(stale_backup).c_str()"],
  "main/sntp_time.cpp": ["DiagLogIdentifier(s_server).c_str()", "ESP_NETIF_SNTP_DEFAULT_CONFIG(s_server.c_str())"],
  "main/syslog.cpp": ["DiagLogIdentifier(last_host).c_str()", "DiagLogIdentifier(syslog_host).c_str()", "getaddrinfo(syslog_host.c_str()"],
  "main/ota_update.cpp": ["DiagLogIdentifier(url).c_str()"],
  "main/diag_log.cpp": ["diag_finish_record(line, pre + n, sizeof(line) - 1, truncated)", "diag_dump_tail(s_buf, RING, s_len, s_wrapped, out, max)"],
})) {
  const text = fs.readFileSync(file, "utf8");
  for (const expression of expressions) assert.ok(text.includes(expression), `${file}: ${expression}`);
}
const ota = fs.readFileSync("main/http_ota.cpp", "utf8");
const start = ota.indexOf("static esp_err_t ota_stat(");
const end = ota.indexOf("// Stream the optional build notes", start);
assert.ok(start >= 0 && end > start);
const body = ota.slice(start, end);
const statusSource = fs.readFileSync("main/http_status.cpp", "utf8");
const statusWrapper = statusSource.match(/static std::string jstr_r\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const hvacExpression = statusSource.match(/j \+= rt\.has_hvac_mode\s*\?[\s\S]*?: "null";/)?.[0];
assert.ok(statusWrapper && hvacExpression, "production conditional HVAC serializer is missing");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-report-privacy-"));
try {
  const fixture = String.raw`
#include "ota_update.hpp"
#include "logic/json.hpp"
#include "logic/redact.hpp"
#include "logic/query_flag.hpp"
#include <cstdio>
#include <iostream>
#include <string>
#include <cstring>
using esp_err_t = int;
constexpr int ESP_OK=0, ESP_ERR_NOT_FOUND=1, ESP_ERR_HTTPD_RESULT_TRUNC=2;
constexpr int HTTPD_414_URI_TOO_LONG=414, HTTPD_400_BAD_REQUEST=400;
struct httpd_req_t { std::string query, response; int status=200; bool read_error=false; };
size_t httpd_req_get_url_query_len(httpd_req_t* r) { return r->query.size(); }
int httpd_req_get_url_query_str(httpd_req_t* r, char* out, size_t capacity) {
 if(r->read_error) return 99;
 if(r->query.empty()) return ESP_ERR_NOT_FOUND;
 if(r->query.size() >= capacity) return ESP_ERR_HTTPD_RESULT_TRUNC;
 std::memcpy(out,r->query.c_str(),r->query.size()+1); return ESP_OK;
}
int httpd_query_key_value(const char* raw,const char* key,char* out,size_t capacity) {
 std::string q(raw), prefix=std::string(key)+"=";
 size_t at=0;
 while(at<q.size()) {
  size_t end=q.find('&',at); if(end==std::string::npos)end=q.size();
  std::string pair=q.substr(at,end-at);
  if(pair.compare(0,prefix.size(),prefix)==0) {
   std::string value=pair.substr(prefix.size());
   if(value.size()>=capacity)return ESP_ERR_HTTPD_RESULT_TRUNC;
   std::memcpy(out,value.c_str(),value.size()+1);return ESP_OK;
  }
  at=end+1;
 }
 return ESP_ERR_NOT_FOUND;
}
int httpd_resp_send_err(httpd_req_t* r,int status,const char* text) {r->status=status;r->response=text;return status;}
void httpd_resp_set_status(httpd_req_t* r,const char*) {r->status=500;}
namespace daik {
int snapshots=0; bool empty=false;
OtaStatus ota_status(OtaFeedUrls* feed) {
 ++snapshots;
 if(!empty) {std::strcpy(feed->manifest.data(),"https://private.invalid/person/manifest.json");
 std::strcpy(feed->firmware_base.data(),"https://private.invalid/person/firmware/");}
 OtaStatus s; s.state="idle"; s.current="1.2.3"; return s;
}
int http_send_json(httpd_req_t* r,const char* text) {r->response=text;return ESP_OK;}
` + statusWrapper + String.raw`
std::string emitted_hvac(bool redact, bool has, const std::string& mode) {
 struct { bool has_hvac_mode; std::string hvac_mode; } rt{has, mode};
 std::string j;
` + hvacExpression + String.raw`
 return j;
}
` + body + String.raw`
}
int main() {
 for(const std::string& q: {std::string(""), std::string("redact=1"), std::string("redact=0"),
                          std::string("redact=1&padding=")+std::string(80,'x'),
                          std::string("redact=1111"), std::string("redact=true"), std::string("redact=")}) {
  httpd_req_t r; r.query=q; daik::snapshots=0; daik::ota_stat(&r);
  std::cout<<r.status<<'\t'<<daik::snapshots<<'\t'<<r.response<<'\n';
 }
 httpd_req_t unavailable; unavailable.query="redact=1"; unavailable.read_error=true;
 daik::snapshots=0; daik::ota_stat(&unavailable);
 std::cout<<unavailable.status<<'\t'<<daik::snapshots<<'\t'<<unavailable.response<<'\n';
 daik::empty=true; httpd_req_t unconfigured; unconfigured.query="redact=1"; daik::ota_stat(&unconfigured);
 std::cout<<unconfigured.status<<'\t'<<daik::snapshots<<'\t'<<unconfigured.response<<'\n';
 const char* modes[]={"off","heat","cool","heat_cool","auto","dry","fan_only","PRIVATE-HVAC","Heat","heat\nPRIVATE","hëat",""};
 for(size_t i=0; i<sizeof(modes)/sizeof(modes[0]); ++i)
  for(bool redact: {false,true})
   std::cout<<"hvac\t"<<i<<'\t'<<redact<<'\t'<<daik::emitted_hvac(redact,true,modes[i])<<'\n';
 std::cout<<"missing\t"<<daik::emitted_hvac(true,false,"PRIVATE-HVAC")<<'\n';
}
`;
  const cpp = path.join(dir, "handler.cpp"), bin = path.join(dir, "handler");
  fs.writeFileSync(cpp, fixture);
  execFileSync(process.env.CXX || "c++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-I", "main", cpp, "-o", bin], { stdio: "pipe" });
  const output = execFileSync(bin, [], { encoding: "utf8" }).trim().split("\n");
  const rows = output.slice(0, 9).map(line => {
    const [status, snapshots, ...text] = line.split("\t"); return { status: Number(status), snapshots: Number(snapshots), text: text.join("\t") };
  });
  assert.equal(rows.length, 9);
  for (const i of [0, 2, 6]) assert.match(rows[i].text, /https:\/\/private.invalid\/person\//); // operational API still works
  assert.equal(JSON.parse(rows[1].text).effective_manifest_url, "<redacted>");
  assert.equal(JSON.parse(rows[1].text).effective_firmware_base_url, "<redacted>");
  for (const i of [3, 4, 5, 7]) {
    assert.equal(rows[i].status, i === 7 ? 400 : 414);
    assert.equal(rows[i].snapshots, 0); // fail before accessing or serializing the private snapshot
    assert.ok(!rows[i].text.includes("private.invalid"));
  }
  assert.equal(JSON.parse(rows[8].text).effective_manifest_url, "");
  assert.equal(JSON.parse(rows[8].text).effective_firmware_base_url, "");
  const modes = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only", "PRIVATE-HVAC", "Heat", "heat\nPRIVATE", "hëat", ""];
  const hvacRows = output.filter(line => line.startsWith("hvac\t"));
  assert.equal(hvacRows.length, modes.length * 2);
  for (const line of hvacRows) {
    const [, i, redact, text] = line.split("\t");
    assert.equal(JSON.parse(text), redact === "1" && Number(i) >= 7 && modes[i] ? "<redacted>" : modes[i]);
  }
  assert.ok(output.includes("missing\tnull"), "an absent source mode must remain null");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log("report privacy source bindings and production OTA serializer/query behavior passed");
