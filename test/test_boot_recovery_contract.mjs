// Boot recovery source boundary: one early boot classification shared by the crash counter and the
// heap watchdog's restart ladder, the watchdog's RAM marker set only immediately before its own
// restart, the factory-reset hold on that restart, the abort() ending of a throwing boot, and the
// recovery facts the syslog boot record carries. test_logic.cpp proves what the pure rules in
// logic/boot_guard.hpp DECIDE; only the source text can show that the glue calls them once, in this
// order, from these places.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Blank comments AND string contents (keeping their length and quotes), so neither prose nor
// diagnostic copy can satisfy an assertion, and braces inside either cannot break body matching.
// `keepStrings` blanks comments only, for the one assertion about a string key.
const tokens = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const blank = (m) => m.replace(/[^\n]/g, " ");
const code = (rel) => read(rel).replace(tokens,
  (m) => (m[0] === '"' || m[0] === "'") ? m[0] + " ".repeat(m.length - 2) + m[m.length - 1] : blank(m));
const keepStrings = (rel) => read(rel).replace(tokens,
  (m) => (m[0] === '"' || m[0] === "'") ? m : blank(m));

// The body of the ONE definition of `name` (a function whose parameter list has no nested parens).
function body(src, name, what) {
  const defs = [...src.matchAll(new RegExp(`\\b${name}\\([^;{}()]*\\)\\s*(?:noexcept\\s*)?\\{`, "g"))];
  assert.equal(defs.length, 1, `${what}: expected exactly one definition of ${name}()`);
  const start = defs[0].index + defs[0][0].length;
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    depth += (src[i] === "{") - (src[i] === "}");
    if (depth === 0) return src.slice(start, i);
  }
  assert.fail(`${what}: unclosed body of ${name}()`);
}

const count = (src, re) => (src.match(re) || []).length;

const mainCpp = code("main/main.cpp");
const safeMode = code("main/safe_mode.cpp");
const heapGuard = code("main/heap_guard.cpp");
const syslog = code("main/syslog.cpp");

// Every first-party translation unit outside the pure logic headers: where a second classifier, a
// second marker reader or a second marker writer would have to live.
const firmwareSources = fs.readdirSync(path.join(root, "main"))
  .filter((f) => f.endsWith(".cpp"))
  .map((f) => [f, code(`main/${f}`)]);
const callers = (re) => firmwareSources.filter(([, src]) => re.test(src)).map(([f]) => f);

// ── 1. Order: the crash guard records this boot before anything that can crash ──────────────────
const boot = body(mainCpp, "boot_sequence", "main.cpp");
const at = (needle) => {
  const i = boot.indexOf(needle);
  assert.ok(i >= 0, `boot_sequence must call ${needle}`);
  return i;
};
assert.ok(at("nvs_storage_init(") < at("safe_mode_begin()"),
  "safe_mode_begin() needs the NVS write lock, so it runs after nvs_storage_init()");
assert.ok(at("safe_mode_begin()") < at("config_load()"),
  "safe_mode_begin() must classify and count this boot BEFORE config_load(), the first risky step");
assert.ok(at("safe_mode_begin()") < at("heap_guard_begin()"),
  "heap_guard_begin() applies safe_mode_begin()'s classification, so it must run after it");
assert.ok(at("heap_guard_begin()") < at("safe_mode_active()"),
  "heap_guard_begin() must decide the minimal boot before main.cpp's safe-mode gate");
assert.equal(count(boot, /\bsafe_mode_begin\s*\(/g), 1, "safe_mode_begin() runs exactly once");

// ── 2. ONE classification, made once, read by both counters ──────────────────────────────────────
const begin = body(safeMode, "safe_mode_begin", "safe_mode.cpp");
assert.deepEqual(callers(/\bboot_classify\s*\(/), ["safe_mode.cpp"],
  "boot_classify() must have exactly one firmware caller, safe_mode.cpp");
assert.equal(count(safeMode, /\bboot_classify\s*\(/g), 1, "the boot is classified exactly once");
assert.match(begin,
  /const bool heap_marker\s*=\s*heap_guard_take_restart_marker\(\);[\s\S]*?s_boot_kind\s*=\s*boot_classify\(reason,\s*heap_marker\);[\s\S]*?boot_crash_counter_step\(s_boot_kind,/,
  "safe_mode_begin() must take the marker, classify with it, and drive the crash counter from that classification");
assert.match(safeMode, /BootKind\s+safe_mode_boot_kind\(\)\s*\{\s*return s_boot_kind;\s*\}/,
  "safe_mode_boot_kind() must expose the stored classification itself, not a recomputation");
const guardBegin = body(heapGuard, "heap_guard_begin", "heap_guard.cpp");
assert.match(guardBegin,
  /=\s*safe_mode_boot_kind\(\);[\s\S]*?boot_heap_ladder_step\(kind,\s*stored\)/,
  "heap_guard_begin() must apply the heap half of safe_mode_begin()'s classification");
assert.doesNotMatch(guardBegin, /esp_reset_reason\s*\(|heap_guard_take_restart_marker\s*\(/,
  "heap_guard_begin() must not classify the boot a second time");
assert.equal(count(guardBegin, /nvs_set_i32\(HEAP_RESTARTS_KEY/g), 1,
  "heap_guard_begin() writes the heap counter in exactly one place");
assert.match(guardBegin, /if \(step\.clear\) \{\s*const esp_err_t err = nvs_set_i32\(HEAP_RESTARTS_KEY, 0\);/,
  "heap_guard_begin() may clear the heap counter only when the classification says so (a clean boot)");
assert.match(guardBegin, /heap_boot_must_be_minimal\(s_restarts\)\)\s*\{\s*safe_mode_latch_heap\(\);/,
  "the end of the heap ladder must still latch the minimal boot");
const healthy = body(safeMode, "healthy_timer_cb", "safe_mode.cpp");
assert.match(healthy, /nvs_set_i32\(BOOT_FAILS_KEY, 0\)/, "the healthy timer clears the crash counter");
assert.doesNotMatch(keepStrings("main/safe_mode.cpp"), /HEAP_RESTARTS_KEY|heap_rst/,
  "safe_mode.cpp, the healthy timer included, must never touch the heap counter");

// ── 3. The marker: read+cleared once per boot, armed only immediately before the watchdog's restart
assert.deepEqual(callers(/\bheap_guard_take_restart_marker\s*\(/).sort(), ["heap_guard.cpp", "safe_mode.cpp"],
  "only safe_mode.cpp may take the marker (heap_guard.cpp defines it)");
assert.equal(count(safeMode, /\bheap_guard_take_restart_marker\s*\(/g), 1,
  "safe_mode_begin() takes the marker exactly once");
assert.match(heapGuard, /bool heap_guard_take_restart_marker\(\)\s*\{\s*return heap_restart_marker_take\(s_restart_marker\);\s*\}/,
  "taking the marker must read AND clear it (heap_restart_marker_take)");
assert.match(heapGuard, /__NOINIT_ATTR volatile HeapRestartMarker s_restart_marker;/,
  "the marker must live in .noinit, or start-up would zero it before safe_mode_begin() reads it");
assert.deepEqual(callers(/\bheap_restart_marker_arm\s*\(/), ["heap_guard.cpp"],
  "only the heap watchdog may arm the marker");
assert.equal(count(heapGuard, /\bheap_restart_marker_arm\s*\(/g), 1, "the marker is armed in exactly one place");
const sample = body(heapGuard, "heap_guard_sample", "heap_guard.cpp");
assert.match(sample, /heap_restart_marker_arm\(s_restart_marker\);\s*esp_restart\(\);/,
  "the marker must be armed IMMEDIATELY before the heap watchdog's esp_restart()");
assert.equal(count(sample, /\besp_restart\s*\(/g), 1, "the heap watchdog has exactly one restart");

// ── 4. No heap-watchdog restart while a factory reset is erasing ─────────────────────────────────
const restartCase = sample.slice(sample.indexOf("case HeapAction::Restart:"));
assert.ok(restartCase.length < sample.length, "the Restart verdict must remain identifiable");
const guardRe = /if \(nvs_factory_reset_latched\(\)\) \{\s*note_restart_held_for_factory_reset\(\);\s*return;\s*\}/g;
const holds = [...restartCase.matchAll(guardRe)].map((m) => m.index);
const write = restartCase.indexOf("nvs_set_i32(HEAP_RESTARTS_KEY");
const drain = restartCase.indexOf("vTaskDelay(pdMS_TO_TICKS(300));");
const arm = restartCase.indexOf("heap_restart_marker_arm(s_restart_marker);");
assert.ok(write > 0 && drain > write && arm > drain, "breadcrumb write, drain and marker must stay in order");
assert.ok(holds.some((i) => i < write),
  "the factory-reset hold must come BEFORE the breadcrumb write (no count for a restart that never happens)");
assert.ok(holds.some((i) => i > drain && i < arm),
  "the factory-reset hold must be asked again after the drain, immediately before the marker and restart");

// ── 5. A throwing boot sequence ends in abort(), a COUNTED crash — never esp_restart() ──────────
const appMain = body(mainCpp, "app_main", "main.cpp");
assert.match(appMain,
  /try\s*\{\s*boot_sequence\(\);\s*\}\s*catch\s*\(const std::exception& e\)\s*\{\s*boot_failed\(e\.what\(\)\);\s*\}\s*catch\s*\(\.\.\.\)\s*\{\s*boot_failed\(/,
  "app_main must catch every exception from boot_sequence() and hand it to boot_failed()");
const failed = body(mainCpp, "boot_failed", "main.cpp");
assert.match(failed, /\babort\(\);\s*$/, "boot_failed() must end in abort(), which the crash counter counts");
assert.doesNotMatch(mainCpp, /\besp_restart\s*\(/,
  "main.cpp must not restart: a \"sw\" reset is a clean boot and would never accumulate");

// ── 6. The syslog boot record carries the recovery state decided before syslog existed ─────────
const replay = body(syslog, "syslog_replay_boot", "syslog.cpp");
for (const [field, source] of [["cause", "safe_mode_cause()"], ["crash_boots", "safe_mode_crash_boots()"],
                               ["heap_restarts", "heap_guard_restarts()"],
                               ["nvs_ok", "nvs_storage_available()"]]) {
  const assign = replay.search(new RegExp(`id\\.${field}\\s*=\\s*${source.replace(/[()]/g, "\\$&")};`));
  assert.ok(assign >= 0 && assign < replay.indexOf("build_boot_line(id)"),
    `the boot record must fill ${field} from ${source} before building the line`);
}

// ── 7. Start-up failures that used to be serial-only reach /diag ────────────────────────────────
const httpStart = body(code("main/http_server.cpp"), "http_start", "http_server.cpp");
assert.match(httpStart, /if \(start_err != ESP_OK\) \{[^}]*diag_printf\([^}]*return;\s*\}/,
  "a failed httpd_start() must be reported through diag_printf, not serial alone");
const ledStart = body(code("main/status_led.cpp"), "status_led_start", "status_led.cpp");
assert.match(ledStart, /xTaskCreate\(status_led_task[^;]*!=\s*pdPASS\)\s*\{[^}]*diag_printf\(/,
  "a failed indicator task start must be reported through diag_printf");
const envStart = body(code("main/env3.cpp"), "env3_start", "env3.cpp");
assert.match(envStart, /xTaskCreate\(task, [^;]*!=\s*pdPASS\)\s*\{[^}]*diag_printf\([^}]*return;\s*\}/,
  "a failed ENV III task start must be reported through diag_printf");

console.log("boot recovery: one early classification shared by both counters, marker armed only " +
            "before the watchdog's restart, factory-reset hold, abort() ending, boot record fields pinned");
