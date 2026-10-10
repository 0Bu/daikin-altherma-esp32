// Compile the entire production boot-capture translation unit against SDK-shaped host adapters.
// Each child process calls diag_crash_capture exactly once; no copied capture or erase implementation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-crash-capture-"));
try {
  const headers = {
    "esp_err.h": String.raw`
#pragma once
using esp_err_t = int;
constexpr esp_err_t ESP_OK=0, ESP_FAIL=-1, ESP_ERR_NOT_FOUND=0x105, ESP_ERR_INVALID_CRC=0x109;
const char* esp_err_to_name(esp_err_t);
`,
    "esp_system.h": String.raw`
#pragma once
enum esp_reset_reason_t { ESP_RST_UNKNOWN=0, ESP_RST_POWERON=1, ESP_RST_EXT=2, ESP_RST_SW=3,
 ESP_RST_PANIC=4, ESP_RST_INT_WDT=5, ESP_RST_TASK_WDT=6, ESP_RST_WDT=7, ESP_RST_DEEPSLEEP=8,
 ESP_RST_BROWNOUT=9, ESP_RST_SDIO=10, ESP_RST_USB=11, ESP_RST_JTAG=12, ESP_RST_EFUSE=13,
 ESP_RST_PWR_GLITCH=14, ESP_RST_CPU_LOCKUP=15 };
esp_reset_reason_t esp_reset_reason();
`,
    "esp_app_desc.h": String.raw`
#pragma once
#include <cstddef>
int esp_app_get_elf_sha256(char*, size_t);
`,
    "esp_core_dump.h": String.raw`
#pragma once
#include <cstddef>
#include <cstdint>
#include "esp_err.h"
#if defined(CONFIG_ESP_COREDUMP_DATA_FORMAT_ELF)
#error "The obsolete DATA_FORMAT_ELF macro must remain undefined in this contract"
#endif
#if CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH != 1
#error "This contract exercises the enabled flash summary path"
#endif
// IDF v6.1 esp_core_dump.h / Xtensa esp_core_dump_summary_port.h field shapes. The public
// summary SHA field is CONFIG_APP_RETRIEVE_LEN_ELF_SHA+1, separate from the raw note's 66 bytes.
#define APP_ELF_SHA256_SZ (CONFIG_APP_RETRIEVE_LEN_ELF_SHA + 1)
typedef struct { uint32_t bt[16]; uint32_t depth; bool corrupted; } esp_core_dump_bt_info_t;
// Extra registers are opaque to boot capture; preserve the SDK member types and target count.
typedef struct { uint32_t exc_cause, exc_vaddr, exc_a[16], epcx[6]; uint8_t epcx_reg_bits; }
 esp_core_dump_summary_extra_info_t;
typedef struct {
 uint32_t exc_tcb;
 char exc_task[16];
 uint32_t exc_pc;
 esp_core_dump_bt_info_t exc_bt_info;
 uint32_t core_dump_version;
 uint8_t app_elf_sha256[APP_ELF_SHA256_SZ];
 esp_core_dump_summary_extra_info_t ex_info;
} esp_core_dump_summary_t;
static_assert(sizeof(((esp_core_dump_summary_t*)nullptr)->app_elf_sha256)==10, "SDK summary hash bound");
static_assert(sizeof(((esp_core_dump_summary_t*)nullptr)->exc_task)==16, "SDK task bound");
static_assert(sizeof(((esp_core_dump_summary_t*)nullptr)->exc_bt_info.bt)/sizeof(uint32_t)==16, "SDK bt bound");
esp_err_t esp_core_dump_image_get(size_t*, size_t*);
esp_err_t esp_core_dump_image_check();
esp_err_t esp_core_dump_get_summary(esp_core_dump_summary_t*);
esp_err_t esp_core_dump_image_erase();
`,
  };
  for (const [name, text] of Object.entries(headers)) fs.writeFileSync(path.join(dir, name), text);
  const allocationShim = path.join(dir, "capture_allocation_shim.hpp");
  fs.writeFileSync(allocationShim, String.raw`
#pragma once
// Load the standard declaration first. Rename the call only in the production translation unit;
// this is not a linker/runtime interposition and does not affect the fixture's allocations.
#include <cstdlib>
extern "C" void* capture_fixture_calloc(std::size_t, std::size_t) noexcept;
#define calloc capture_fixture_calloc
`);
  const fixture = String.raw`
#include "diag_crash.hpp"
#include "esp_core_dump.h"
#include "esp_system.h"
#include <array>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <string>
#ifdef calloc
#error "The allocation shim must not be applied to the fixture translation unit"
#endif

namespace fixture {
constexpr const char* running_sha="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
esp_reset_reason_t reset=ESP_RST_SW;
bool image=true;
bool deny_summary_allocation=false;
bool inject_text_allocation_failure=false, deny_next_text_allocation=false;
int text_allocation_failures=0;
esp_err_t image_check=ESP_OK, summary_result=ESP_OK;
int reset_calls=0, image_calls=0, check_calls=0, summary_calls=0, hash_calls=0, erase_calls=0;
int allocation_calls=0;
size_t allocation_bytes=0;
std::array<uint8_t,96> flash{};
esp_core_dump_summary_t summary{};
std::string log;
}
// Arm exactly one allocation after the SDK summary has been copied. This reaches the actual
// production string builder, without applying general heap pressure to the fixture or capture.
void* operator new(std::size_t size) {
 if(fixture::deny_next_text_allocation) {
  fixture::deny_next_text_allocation=false; ++fixture::text_allocation_failures;
  throw std::bad_alloc();
 }
 if(void* result=std::malloc(size?size:1)) return result;
 throw std::bad_alloc();
}
void operator delete(void* value) noexcept { std::free(value); }
void operator delete(void* value,std::size_t) noexcept { std::free(value); }
extern "C" void* capture_fixture_calloc(size_t count,size_t size) noexcept {
 ++fixture::allocation_calls;
 fixture::allocation_bytes=count*size;
 if(fixture::deny_summary_allocation) return nullptr;
 return std::calloc(count,size);
}
esp_reset_reason_t esp_reset_reason() { ++fixture::reset_calls; return fixture::reset; }
esp_err_t esp_core_dump_image_get(size_t* address, size_t* size) {
 ++fixture::image_calls;
 if(!fixture::image) return ESP_ERR_NOT_FOUND;
 *address=0x3e0000; *size=fixture::flash.size(); return ESP_OK;
}
esp_err_t esp_core_dump_image_check() { ++fixture::check_calls; return fixture::image_check; }
esp_err_t esp_core_dump_get_summary(esp_core_dump_summary_t* out) {
 ++fixture::summary_calls;
 if(fixture::summary_result!=ESP_OK) return fixture::summary_result;
 std::memcpy(out,&fixture::summary,sizeof(*out));
 fixture::deny_next_text_allocation=fixture::inject_text_allocation_failure;
 return ESP_OK;
}
esp_err_t esp_core_dump_image_erase() {
 ++fixture::erase_calls; fixture::flash.fill(0xff); fixture::image=false; return ESP_OK;
}
int esp_app_get_elf_sha256(char* out,size_t capacity) {
 ++fixture::hash_calls; return std::snprintf(out,capacity,"%s",fixture::running_sha);
}
const char* esp_err_to_name(esp_err_t) { return "host-stub-error"; }
namespace daik {
void diag_printf(const char* format,...) {
 char text[1024]; va_list args; va_start(args,format);
 const int size=std::vsnprintf(text,sizeof(text),format,args); va_end(args);
 if(size>0) fixture::log.append(text,static_cast<size_t>(size)<sizeof(text)?static_cast<size_t>(size):sizeof(text)-1);
}
}
std::string quoted(const std::string& value) {
 std::string result="\""; daik::json_append_escaped(result,value); result+='"'; return result;
}
int main(int argc,char** argv) {
 if(argc!=3) return 2;
 const std::string scenario=argv[1];
 fixture::reset=static_cast<esp_reset_reason_t>(std::strtoul(argv[2],nullptr,10));
 for(size_t i=0;i<fixture::flash.size();++i) fixture::flash[i]=static_cast<uint8_t>(i^0x5a);
 std::strcpy(fixture::summary.exc_task,"stored_task");
 fixture::summary.exc_pc=0x42001234;
 fixture::summary.exc_bt_info.depth=3;
 fixture::summary.exc_bt_info.corrupted=true;
 for(size_t i=0;i<16;++i) fixture::summary.exc_bt_info.bt[i]=0x42001000+static_cast<uint32_t>(4*i);
 std::memcpy(fixture::summary.app_elf_sha256,fixture::running_sha,9);
 if(scenario=="no-image") fixture::image=false;
 else if(scenario=="invalid-image") fixture::image_check=ESP_ERR_INVALID_CRC;
 else if(scenario=="summary-missing") fixture::summary_result=ESP_ERR_NOT_FOUND;
 else if(scenario=="summary-error") fixture::summary_result=ESP_FAIL;
 else if(scenario=="allocation-failure") fixture::deny_summary_allocation=true;
 else if(scenario=="text-allocation-failure") fixture::inject_text_allocation_failure=true;
 else if(scenario=="foreign") std::memcpy(fixture::summary.app_elf_sha256,"fedcba987",9);
 else if(scenario=="empty-identity") fixture::summary.app_elf_sha256[0]=0;
 else if(scenario=="short-identity") std::memcpy(fixture::summary.app_elf_sha256,"fedcba9\0",8);
 else if(scenario=="invalid-identity") std::memcpy(fixture::summary.app_elf_sha256,"ggggggggg",9);
 else if(scenario=="upper-identity") std::memcpy(fixture::summary.app_elf_sha256,"ABCDEF012",9);
 else if(scenario=="nonterminated-fields") {
  std::memset(fixture::summary.exc_task,'T',sizeof(fixture::summary.exc_task));
  std::memcpy(fixture::summary.app_elf_sha256,fixture::running_sha,sizeof(fixture::summary.app_elf_sha256));
 }
 else if(scenario=="deep-backtrace") fixture::summary.exc_bt_info.depth=20;
 else if(scenario=="huge-depth") fixture::summary.exc_bt_info.depth=0xffffffffu;
 else if(scenario!="matching") return 3;
 const auto original_flash=fixture::flash;
 std::array<uint8_t,sizeof(esp_core_dump_summary_t)> original_summary{};
 std::memcpy(original_summary.data(),&fixture::summary,original_summary.size());
 const bool original_presence=fixture::image;
 // The only boot capture in this process. Accessors exercise the actual production cache/latch.
 try { daik::diag_crash_capture(); }
 catch(const std::bad_alloc&) { return 86; } // A missing boot-local exception boundary is a failure.
 const auto cached=daik::diag_crash_info();
 const auto live=daik::diag_crash_info_live();
 const bool downloadable=daik::diag_crash_coredump_present();
 std::cout<<"{\"cached\":"<<daik::build_crash_json(cached)
          <<",\"live\":"<<daik::build_crash_json(live)
          <<",\"have_summary\":"<<(cached.have_summary?"true":"false")
          <<",\"notable\":"<<(daik::crash_is_notable(live)?"true":"false")
          <<",\"downloadable\":"<<(downloadable?"true":"false")
          <<",\"physical_image\":"<<(fixture::image?"true":"false")
          <<",\"flash_unchanged\":"<<(fixture::flash==original_flash?"true":"false")
          <<",\"presence_unchanged\":"<<(fixture::image==original_presence?"true":"false")
          <<",\"summary_unchanged\":"<<(std::memcmp(&fixture::summary,original_summary.data(),original_summary.size())==0?"true":"false")
          <<",\"reset_calls\":"<<fixture::reset_calls<<",\"image_calls\":"<<fixture::image_calls
          <<",\"check_calls\":"<<fixture::check_calls<<",\"summary_calls\":"<<fixture::summary_calls
          <<",\"hash_calls\":"<<fixture::hash_calls<<",\"erase_calls\":"<<fixture::erase_calls
          <<",\"allocation_calls\":"<<fixture::allocation_calls
          <<",\"text_allocation_failures\":"<<fixture::text_allocation_failures
          <<",\"allocation_bytes\":"<<fixture::allocation_bytes
          <<",\"summary_size\":"<<sizeof(esp_core_dump_summary_t)
          <<",\"text\":"<<quoted(daik::build_crash_text(live))
          <<",\"mqtt\":"<<quoted(daik::build_crash_mqtt_payload(live))
          <<",\"log\":"<<quoted(fixture::log)<<"}\n";
}
`;
  const cpp = path.join(dir, "capture_fixture.cpp"), bin = path.join(dir, "capture_fixture");
  fs.writeFileSync(cpp, fixture);
  const compiler = process.env.CXX || "c++";
  const productionObject = path.join(dir, "diag_crash.o"), fixtureObject = path.join(dir, "capture_fixture.o");
  const compileArguments = ["-std=c++17", "-Wall", "-Wextra", "-Werror",
    "-DCONFIG_ESP_COREDUMP_ENABLE_TO_FLASH=1", "-DCONFIG_APP_RETRIEVE_LEN_ELF_SHA=9",
    "-I", dir, "-I", "main"];
  execFileSync(compiler, [...compileArguments, "-include", allocationShim, "-c", "main/diag_crash.cpp",
    "-o", productionObject], { stdio: "pipe" });
  execFileSync(compiler, [...compileArguments, "-c", cpp, "-o", fixtureObject], { stdio: "pipe" });
  execFileSync(compiler, [productionObject, fixtureObject, "-o", bin], { stdio: "pipe" });
  const cases = [];
  for (const scenario of ["matching", "foreign", "invalid-image", "summary-missing", "summary-error",
    "allocation-failure", "text-allocation-failure", "no-image"])
    for (const reason of [3, 4]) cases.push({ scenario, reason });
  for (const reason of [1, 5, 6, 9, 14, 15]) cases.push({ scenario: "no-image", reason });
  for (const scenario of ["empty-identity", "short-identity", "invalid-identity", "upper-identity",
    "nonterminated-fields", "deep-backtrace", "huge-depth"]) cases.push({ scenario, reason: 3 });
  const faults = new Set([4, 5, 6, 7, 9, 14, 15]);
  for (const { scenario, reason } of cases) {
    const row = JSON.parse(execFileSync(bin, [scenario, String(reason)], { encoding: "utf8" }));
    const label = `${scenario}/reset=${reason}`;
    const image = scenario !== "no-image", foreign = scenario === "foreign";
    const summary = image && !["invalid-image", "summary-missing", "summary-error", "allocation-failure", "foreign"].includes(scenario);
    assert.equal(row.reset_calls, 1, `${label}: exactly one boot capture`);
    assert.equal(row.erase_calls, 0, `${label}: boot capture may never erase evidence`);
    assert.equal(row.text_allocation_failures, scenario === "text-allocation-failure" ? 1 : 0,
      `${label}: the targeted production string allocation was reached`);
    if (scenario === "text-allocation-failure") {
      assert.match(row.log, /diagnostic text unavailable \(OOM\); cached reset and stored evidence retained/,
        `${label}: boot continues with a fixed fallback and intact cached facts`);
    }
    assert.equal(row.flash_unchanged, true, `${label}: flash bytes must be preserved`);
    assert.equal(row.presence_unchanged, true, `${label}: physical presence must be preserved`);
    assert.equal(row.summary_unchanged, true, `${label}: stored summary must be preserved`);
    assert.equal(row.physical_image, image, label);
    assert.equal(row.image_calls, 3, `${label}: boot and two cheap presence accessors`);
    assert.equal(row.check_calls, image ? 1 : 0, label);
    const allocated = image && scenario !== "invalid-image";
    assert.equal(row.allocation_calls, allocated ? 1 : 0, `${label}: production summary allocation was intercepted`);
    assert.equal(row.allocation_bytes, allocated ? row.summary_size : 0, `${label}: only the SDK summary allocation`);
    assert.equal(row.summary_calls, image && !["invalid-image", "allocation-failure"].includes(scenario) ? 1 : 0, `${label}: summary only parsed once`);
    assert.equal(row.hash_calls, image && !["invalid-image", "summary-missing", "summary-error", "allocation-failure"].includes(scenario) ? 1 : 0, label);
    assert.equal(row.have_summary, summary, label);
    assert.equal(row.downloadable, image && !foreign, label);
    assert.equal(row.notable, (image && !foreign) || faults.has(reason), label);
    for (const report of [row.cached, row.live]) {
      assert.equal(report.reason_code, reason, `${label}: reset is the current boot's reason`);
      assert.equal(report.fault, faults.has(reason), `${label}: stored report cannot invent a current fault`);
      assert.equal(report.coredump, image && !foreign, label);
      assert.equal(Object.hasOwn(report, "task"), summary, label);
      assert.equal(Object.hasOwn(report, "pc"), summary, label);
      if (summary) {
        assert.equal(report.task, scenario === "nonterminated-fields" ? "T".repeat(15) : "stored_task", label);
        assert.equal(report.pc, "0x42001234", `${label}: PC comes from the stored report`);
        assert.equal(report.corrupted, true, label);
        assert.equal(report.backtrace.length, scenario === "deep-backtrace" ? 16 : scenario === "huge-depth" ? 0 : 3, label);
        assert.deepEqual(report.backtrace,
          Array.from({ length: report.backtrace.length }, (_, i) =>
            "0x" + (0x42001000 + 4 * i).toString(16).padStart(8, "0")),
          `${label}: every frame comes from the SDK summary in order`);
        if (scenario === "matching") assert.equal(report.elf_sha256, "abcdef012", `${label}: actual 9-character SDK prefix`);
        if (scenario === "nonterminated-fields") assert.equal(report.elf_sha256, "abcdef0123", `${label}: bounded SDK prefix from a longer-hash dump`);
        if (scenario === "empty-identity") assert.equal(Object.hasOwn(report, "elf_sha256"), false, label);
      } else {
        assert.equal(Object.hasOwn(report, "elf_sha256"), false, label);
        assert.equal(row.text.includes("stored_task"), false, label);
      }
    }
    if (foreign) assert.match(row.log, /foreign core dump.*preserved, suppressed/, label);
    assert.equal(row.mqtt === "", !row.notable, `${label}: normal/no-image boot has no crash payload`);
    if (row.mqtt) assert.deepEqual(JSON.parse(row.mqtt), row.live, label);
    console.log(`crash capture ${label}: passed; erase=0, bytes preserved`);
  }
  console.log(`${cases.length} production crash-capture cases passed with flash enabled and DATA_FORMAT_ELF undefined`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
