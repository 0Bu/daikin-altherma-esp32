// Persistence/privacy source boundary: one config authority, serialized factory erasure, and
// generation-safe X10A identity publication. Pure host tests cannot observe these IDF call sites.
// FACTORY_RESET_CONTRACT_ROOT points the same assertions at a mutated copy of the tree, which is how
// the negative controls for the factory-reset section below are run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.FACTORY_RESET_CONTRACT_ROOT || defaultRoot);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (rel) => read(rel).split("\n")
  .filter((line) => !line.trim().startsWith("//")).join("\n");

// ── Source scanner for the whole-component claims ────────────────────────────────────────────
// `structure` blanks comments AND string/char literals (raw strings included) to spaces, keeping
// every newline and index, so braces, calls and keywords found in it are real code. `text` blanks
// only the comments, for reading a branch's diagnostic wording at the same indices.
function scan(src) {
  const structure = [];
  const text = [];
  const keep = (ch, inLiteral) => { structure.push(inLiteral && ch !== "\n" ? " " : ch); text.push(ch); };
  const blank = (ch) => { const b = ch === "\n" ? "\n" : " "; structure.push(b); text.push(b); };
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") blank(src[i++]);
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      while (i < stop) blank(src[i++]);
    } else if (c === "R" && d === '"' && !/[\w]/.test(src[i - 1] || "")) {
      const open = src.indexOf("(", i + 2);
      const close = src.indexOf(")" + src.slice(i + 2, open) + '"', open);
      const stop = close + open - i - 2 + 2;   // past `)delim"`
      keep(src[i++], false); keep(src[i++], false);
      while (i < stop - 1) keep(src[i++], true);
      keep(src[i++], false);
    } else if (c === '"' || (c === "'" && !/[0-9]/.test(src[i - 1] || ""))) {
      keep(src[i++], false);
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") keep(src[i++], true);
        keep(src[i++], true);
      }
      if (i < src.length) keep(src[i++], false);
    } else {
      keep(src[i++], false);
    }
  }
  return { structure: structure.join(""), text: text.join("") };
}
const scanned = new Map();
const source = (rel) => {
  if (!scanned.has(rel)) scanned.set(rel, scan(read(rel)));
  return scanned.get(rel);
};
// Every C/C++ source under main/, as repository-relative paths.
const mainSources = (() => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(c|cpp|h|hpp)$/.test(entry.name)) out.push(rel);
    }
  };
  walk("main");
  return out.sort();
})();
// Index of the bracket that closes the one opened at `open` (`{`/`(`), in structure text.
function matching(s, open) {
  const pair = { "{": "}", "(": ")" }[s[open]];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === pair && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${s[open]} at ${open}`);
}
// Every `{` that encloses `at`, innermost first, each with the text that introduces it.
function enclosingBraces(s, at) {
  const out = [];
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (s[i] === "}") depth++;
    else if (s[i] === "{") {
      if (depth > 0) depth--;
      else {
        const head = s.slice(Math.max(0, s.lastIndexOf(";", i), s.lastIndexOf("}", i),
                                      s.lastIndexOf("{", i - 1)) + 1, i);
        out.push({ open: i, close: matching(s, i), head });
      }
    }
  }
  return out;
}
// The body of the function that contains `at`: the outermost enclosing brace that is not a
// namespace (lambda and block braces nest inside it). Its name is the identifier before `(`.
function enclosingFunction(s, at) {
  const braces = enclosingBraces(s, at).filter((b) => !/\b(namespace|extern)\b/.test(b.head));
  assert.ok(braces.length > 0, `no enclosing function at ${at}`);
  const body = braces[braces.length - 1];
  const head = body.head.replace(/__attribute__\s*\(\([^]*?\)\)|\[\[[^]*?\]\]/g, " ");
  const name = /(~?\w+)\s*\([^]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->[^{]*)?$/.exec(head);
  return { ...body, name: name ? name[1] : "" };
}
// `if (<cond>) <stmt-or-block>` statements inside [from, to): condition text and controlled body.
function ifStatements(s, from, to) {
  const out = [];
  const re = /\bif\s*\(/g;
  re.lastIndex = from;
  for (let m; (m = re.exec(s)) && m.index < to;) {
    const condOpen = m.index + m[0].length - 1;
    const condClose = matching(s, condOpen);
    let bodyAt = condClose + 1;
    while (/\s/.test(s[bodyAt])) bodyAt++;
    const bodyEnd = s[bodyAt] === "{" ? matching(s, bodyAt) + 1 : s.indexOf(";", bodyAt) + 1;
    out.push({ at: m.index, cond: s.slice(condOpen + 1, condClose).trim(), bodyAt, bodyEnd });
  }
  return out;
}
const calls = (s, name) => [...s.matchAll(new RegExp(`(?<![\\w:.>])${name}\\s*\\(`, "g"))]
  .map((m) => m.index);
// A declaration or definition of the function named at `at` (its return type directly before it on
// the same line), not a call.
const isDeclaration = (s, at) =>
  /^\s*(?:\[\[nodiscard\]\]\s*)?(?:(?:static|inline)\s+)*(?:esp_err_t|bool|void)\s+$/
    .test(s.slice(s.lastIndexOf("\n", at - 1) + 1, at));

const wifi = code("main/wifi.cpp");
const initAt = wifi.indexOf("bool wifi_init_sta_driver(bool& rollback_pending)");
const waitAt = wifi.indexOf("bool wifi_wait_sta_connected(bool rollback_pending)");
assert.ok(initAt >= 0 && waitAt > initAt, "the bounded STA driver helper must exist");
const staInit = wifi.slice(initAt, waitAt);
assert.ok(staInit.indexOf("esp_wifi_init(&ic)") >= 0 &&
          staInit.indexOf("esp_wifi_init(&ic)") < staInit.indexOf("WIFI_STORAGE_RAM") &&
          staInit.indexOf("WIFI_STORAGE_RAM") < staInit.indexOf("esp_wifi_set_config("),
  "STA credentials must be configured only after selecting RAM-only WiFi storage");
assert.doesNotMatch(staInit, /config_save\s*\(/,
  "driver initialization must return before credential persistence consumes the startup stack");
const staStart = wifi.slice(wifi.indexOf("bool wifi_start_sta()"),
                            wifi.indexOf("esp_err_t wifi_forget_persisted_config()"));
assert.match(staStart, /wifi_init_sta_driver\(rollback_pending\)[\s\S]*?wifi_wait_sta_connected\(rollback_pending\)[\s\S]*?wifi_finish_sta_rollback\(\)/,
  "the scalar startup coordinator must finish initialization before wait and rollback persistence");

const provisioning = code("main/provisioning.cpp");
assert.ok(provisioning.indexOf("esp_wifi_init(&ic)") < provisioning.indexOf("WIFI_STORAGE_RAM") &&
          provisioning.indexOf("WIFI_STORAGE_RAM") < provisioning.indexOf("esp_wifi_set_config("),
  "the setup AP must also avoid IDF's default FLASH-backed configuration");
assert.match(wifi, /wifi_forget_persisted_config\([\s\S]*?WIFI_STORAGE_FLASH[\s\S]*?esp_wifi_restore\(\)/,
  "factory reset must erase legacy WiFi-driver persistent settings, including Ethernet-only boots");

const nvs = code("main/nvs_storage.cpp");
for (const setter of ["nvs_set_str", "nvs_set_i32", "nvs_set_blob"]) {
  const at = nvs.indexOf(`esp_err_t ${setter}(`);
  const next = nvs.indexOf("\nesp_err_t ", at + 1);
  const body = nvs.slice(at, next < 0 ? nvs.length : next);
  assert.match(body, /Lock lk\(s_write_mtx\)[\s\S]*?s_writes_disabled\.load[\s\S]*?nvs_open/,
    `${setter} must serialize with and fail behind the factory-reset latch`);
}
const erase = nvs.slice(nvs.indexOf("esp_err_t nvs_erase_all()"),
                        nvs.indexOf("bool nvs_get_blob", nvs.indexOf("esp_err_t nvs_erase_all()")));
assert.ok(erase.indexOf("Lock lk(s_write_mtx)") < erase.indexOf("s_writes_disabled.store(true") &&
          erase.indexOf("s_writes_disabled.store(true") < erase.indexOf("nvs_open("),
  "factory erase must wait out old writers and latch new writers before opening NVS");
const main = code("main/main.cpp");
assert.ok(main.indexOf("nvs_storage_init(") < main.indexOf("config_load()"),
  "the NVS write mutex must exist before config loading or producer tasks");
// Not just main.cpp: an automatic partition erase anywhere in the firmware (a "self-healing" init
// path in nvs_storage.cpp, say) destroys the configuration the same way.
for (const rel of mainSources) {
  assert.doesNotMatch(source(rel).structure, /\bnvs_flash_erase\w*\s*\(/,
    `${rel}: a failed NVS initialization must preserve the partition, including full/new-version ` +
    "errors; no firmware path may erase it");
}
assert.match(nvs, /xSemaphoreCreateMutexStatic\(&s_write_mtx_storage\)/,
  "the NVS write lock must be available without heap allocation before the crash counter");
for (const risky of ["esp_netif_init()", "ota_update_init()", "config_load()",
                    "status_led_start()", "recovery_button_start()"]) {
  assert.ok(main.indexOf("safe_mode_begin()") >= 0 &&
            main.indexOf("safe_mode_begin()") < main.indexOf(risky),
    `the crash guard must record this boot before ${risky}`);
}

assert.match(main, /nvs_storage_init\(nvs_err == ESP_OK\)/,
  "WiFi must know whether NVS initialized before choosing its driver storage");
for (const source of [wifi, provisioning]) {
  const driverStorage = source.search(/ic\.nvs_enable\s*=\s*nvs_storage_available\(\)/);
  assert.ok(driverStorage >= 0 && driverStorage < source.indexOf("esp_wifi_init(&ic)"),
    "failed NVS initialization must disable driver NVS before starting station or setup AP");
}

// ── The factory reset: one route, one fail-closed order, one restart ─────────────────────────
// The erase primitives and the one post-erase write are called from recovery_button.cpp alone. That
// pins the absence of any REMOTE reset route (HTTP, MQTT, MCP): adding one means calling these.
const ERASE_STEPS = ["nvs_erase_all", "wifi_forget_persisted_config", "history_flash_forget",
                     "dwell_forget", "diag_crash_forget", "mqtt_retirement_forget"];
const RESET_ONLY = [...ERASE_STEPS, "nvs_set_blob_after_factory_reset"];
for (const rel of mainSources) {
  const s = source(rel).structure;
  for (const name of RESET_ONLY) {
    for (const at of calls(s, name)) {
      if (isDeclaration(s, at)) continue;
      assert.equal(rel, "main/recovery_button.cpp",
        `${rel} calls ${name}(): only the physical recovery button may erase stored data or write ` +
        "behind the factory-reset latch");
    }
  }
  // The raw IDF namespace erases live only inside the two reset primitives that own them.
  for (const m of s.matchAll(/\bnvs_erase_(?:all|key)\s*\(/g)) {
    if (s[m.index - 1] !== ":" || s[m.index - 2] !== ":") continue; // the daik:: wrapper, above
    const owner = `${rel}:${enclosingFunction(s, m.index).name}`;
    assert.ok(["main/nvs_storage.cpp:nvs_erase_all",
               "main/mqtt_retirement_store.cpp:mqtt_retirement_forget"].includes(owner),
      `${owner}: a raw NVS namespace/key erase outside the factory-reset primitives`);
  }
}

const recoverySource = source("main/recovery_button.cpp");
const recovery = recoverySource.structure;
assert.equal(calls(recovery, "esp_restart").length, 1,
  "recovery_button.cpp restarts exactly once: after the completed reset");
const resetAt = recovery.search(/\bvoid\s+factory_reset\s*\(\s*\)\s*\{/);
assert.ok(resetAt >= 0, "factory_reset() must exist");
const resetOpen = recovery.indexOf("{", resetAt);
const resetEnd = matching(recovery, resetOpen);
const reset = recovery.slice(0, resetEnd); // indices stay file-absolute
const firstCall = (name) => {
  const at = calls(reset, name).find((i) => i > resetOpen);
  assert.ok(at !== undefined, `factory_reset() must call ${name}()`);
  return at;
};
const order = ["config_factory_seed_blob", ...ERASE_STEPS].map(firstCall);
assert.ok(order.every((at, i) => i === 0 || order[i - 1] < at),
  "factory reset must build the board seed first, then erase every persisted user-data domain " +
  "in the fail-closed order, the MQTT retirement record after the coredump");
// Each step's result variable, so the branch conditions can be checked by name.
const resultOf = (name) => {
  const at = firstCall(name);
  const decl = reset.slice(reset.lastIndexOf(";", at) + 1, at);
  const m = /^\s*(?:const\s+)?[\w:]+\s+(\w+)\s*=(?!=)/.exec(decl);
  assert.ok(m, `${name}()'s result must be kept in a named variable`);
  return m[1];
};
const failedOn = resultOf("nvs_erase_all");
const pending = ["wifi_forget_persisted_config", "history_flash_forget", "diag_crash_forget",
                 "mqtt_retirement_forget"].map(resultOf);
// Slice every branch that reports a FAILED or INCOMPLETE reset, by its diagnostic wording.
const branches = ifStatements(reset, resetOpen, resetEnd)
  .map((b) => ({ ...b, body: reset.slice(b.bodyAt, b.bodyEnd),
                 words: recoverySource.text.slice(b.bodyAt, b.bodyEnd) }))
  .filter((b) => /factory reset (FAILED|INCOMPLETE)/.test(b.words));
const failed = branches.filter((b) => /factory reset FAILED/.test(b.words));
const incomplete = branches.filter((b) => /factory reset INCOMPLETE/.test(b.words));
assert.equal(failed.length, 1, "exactly one FAILED branch, for the namespace erase");
assert.match(failed[0].cond, new RegExp(`^${failedOn}\\s*!=\\s*ESP_OK$`),
  "the FAILED branch is taken on the namespace erase's error");
assert.ok(incomplete.length >= 1, "an INCOMPLETE branch must exist");
for (const b of branches) {
  assert.match(b.body, /\breturn\s*;/, "a FAILED/INCOMPLETE reset must stay in this boot");
  assert.doesNotMatch(b.body, /\besp_restart\s*\(/,
    "a FAILED/INCOMPLETE reset must not reboot: the next boot would look like a finished reset");
}
const incompleteConds = incomplete.map((b) => b.cond).join(" || ");
for (const variable of pending) {
  assert.match(incompleteConds, new RegExp(`(?:!\\s*${variable}\\b|\\b${variable}\\s*!=\\s*ESP_OK)`),
    `a failed ${variable} must make the reset INCOMPLETE (no seed write, no reboot)`);
}
// Only after every required erase: the seed write (best effort), then the one restart.
const lastBranchEnd = Math.max(...branches.map((b) => b.bodyEnd));
const seedWrite = firstCall("nvs_set_blob_after_factory_reset");
const restart = calls(reset, "esp_restart")[0];
assert.ok(lastBranchEnd < seedWrite && seedWrite < restart,
  "the board seed is written only after every required erase succeeded, and before the restart");
assert.ok(!ifStatements(reset, seedWrite, restart).some((b) => /\breturn\b/.test(
  reset.slice(b.bodyAt, b.bodyEnd))),
  "a failed seed write is reported, never a reason to skip the completed reset's restart");

// ── Every OTHER restart refuses while the factory-reset latch is set ──────────────────────────
// A restart after nvs_erase_all() latched would boot a partially erased device that looks like a
// finished reset. A site passes when, in its own function, an `if (nvs_factory_reset_latched())`
// whose body leaves (return/continue/break) sits in a block that also contains the restart, and no
// vTaskDelay separates the last such check from the restart: the latch is re-read after any wait.
// There is no exception: even wifi.cpp's credential-rollback restart, which only follows a
// config_save() the latch refuses, re-checks after its syslog drain, because a save that landed
// just before the latch would otherwise restart into the erase.
function refusalGuards(s, at) {
  const fn = enclosingFunction(s, at);
  const refusals = ifStatements(s, fn.open, at)
    .filter((b) => /^nvs_factory_reset_latched\(\)$/.test(b.cond.replace(/\s+/g, "")) &&
                   /\b(return|continue|break)\b/.test(s.slice(b.bodyAt, b.bodyEnd)) &&
                   b.bodyEnd <= at)
    .filter((b) => {
      const block = enclosingBraces(s, b.at)[0];
      return block.open < at && at < block.close;
    });
  if (refusals.length === 0) return "no `if (nvs_factory_reset_latched())` refusal precedes it";
  const last = refusals[refusals.length - 1];
  if (/\bvTaskDelay\s*\(/.test(s.slice(last.bodyEnd, at)))
    return "a vTaskDelay separates the last latch check from the restart";
  return "";
}
for (const rel of mainSources) {
  const s = source(rel).structure;
  const sites = calls(s, "esp_restart");
  if (rel === "main/recovery_button.cpp" || sites.length === 0) continue;
  for (const at of sites) {
    const problem = refusalGuards(s, at);
    if (problem) assert.fail(`${rel}: esp_restart() reachable during a factory reset — ${problem}`);
  }
}

const poll = code("main/hp_poll.cpp");
assert.match(poll, /poll_detect\(\)[\s\S]*?cycle_generation\s*=\s*hp_poll_generation\(\)[\s\S]*?expected\s*=\s*config\(\)[\s\S]*?hp_detect_run\(\)/,
  "detection must capture both generation and config revision before the bus sweep");
assert.match(poll, /Lock lk\(s_mtx\)[\s\S]*?s_target_generation\.load[\s\S]*?config_commit_detected_link\([\s\S]*?history_reset_on_detect\([\s\S]*?config_commit_detected_model\(/,
  "detected link, observer resets and model publication must share the reconfigure barrier");
assert.match(poll, /if \(!first_no_match\) \{\s*committed = config_commit_detected_link\(/,
  "one unconfirmed generic sweep must not persist a replacement X10A identity");

const config = code("main/config.cpp");
assert.match(config, /config_commit_detected_link\([\s\S]*?Lock lk\(g_mtx\)[\s\S]*?config_commit_detected_link_transaction\(\s*g_cfg,\s*expected\.runtime_revision/,
  "the detection link commit must run its transaction on the live config under the config mutex");
assert.match(code("main/logic/config_transaction.hpp"),
  /config_commit_detected_link_transaction\([\s\S]*?live\.runtime_revision != expected_revision[\s\S]*?store\.write_blob\(CONFIG_KEY_LINK/,
  "the detection link write must be a revision-checked config transaction");
const httpConfig = code("main/http_config.cpp");
assert.match(httpConfig, /reset_checkup && c\.profile != "auto"[\s\S]*?history_x10a_identity\([\s\S]*?if \(c\.x10a_identity_fp != 0\)[\s\S]*?history_reset_on_detect\(c\.x10a_identity_fp\)/,
  "manual concrete-profile or wiring-only updates must install a nonzero history scope");

const modbus = code("main/hp_modbus.cpp");
const mbPoll = modbus.slice(modbus.indexOf("static void mb_poll_once()"),
                            modbus.indexOf("void mb_start()"));
assert.ok(mbPoll.indexOf("history_modbus_reset(logic::history_homehub_target_fingerprint(") <
          mbPoll.indexOf("history_generation = history_modbus_generation()"),
  "the first cycle for a corrected HomeHub target must capture the post-reset history generation");

console.log("factory reset: RAM-only WiFi, serialized erase latch and generation-scoped X10A commits pinned");
