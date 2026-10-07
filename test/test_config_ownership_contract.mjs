// Source-boundary regression test for concurrent configuration ownership (tracker card CFG-04).
//
// test/test_logic.cpp proves what logic/config_model.hpp DECIDES: an X10A /set_hp save of a snapshot
// that a detection commit has overtaken is Stale, a service save carries detection forward, and
// set_hp_apply_x10a re-judges the patch against whichever snapshot it is given. The runtime harness
// replays the interleaving with that same decision. Neither can prove that the firmware still
// CALLS the decision where it matters, which is what this file pins:
//
//   1. config.cpp decides through config_save_revision and refuses a Stale save before it copies,
//      serializes or writes anything;
//   2. only /set_hp owns the link, and its X10A path saves through config_save_link, never through
//      the reconciling whole-struct config_save;
//   3. every attempt of /set_hp reads a fresh config() and applies the parsed patch to it, and a
//      Stale result re-runs that derivation instead of reporting success or committing the old one;
//   4. the runtime harness uses the production decision rather than a private copy.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Index of the first match of `re` at or after `from`, or -1. Declarations are column-aligned by
// clang-format, so their whitespace is not pinned.
const at = (text, re, from = 0) => {
  if (from < 0) return -1;
  const i = text.slice(from).search(re);
  return i < 0 ? -1 : from + i;
};
const config = read("main/config.cpp");
const configHeader = read("main/config.hpp");
const http = read("main/http_config.cpp");
const harness = read("test/runtime/fake_runtime.hpp");

// 1. The save decision and its position before every side effect.
const saveStart = config.indexOf("static ConfigSaveResult save_whole(const Config& requested, bool owns_link)");
const saveEnd = config.indexOf("\nbool config_save(const Config& c)", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "the one whole-struct save must remain identifiable");
const save = config.slice(saveStart, saveEnd);
const lock = save.indexOf("Lock lk(g_mtx);");
const decision = at(save,
  /config_save_revision\(\s*owns_link,\s*requested\.runtime_revision,\s*g_cfg\.runtime_revision\)/);
const staleReturn = at(save,
  /if \(revision == ConfigSaveRevision::Stale\) return ConfigSaveResult::Stale;/, decision);
const copy = at(save, /Config\s+c\s*=\s*requested;/, staleReturn);
const reconcile = at(save,
  /if \(revision == ConfigSaveRevision::ReconcileDetected\)\s*reconcile_detected_config\(c, g_cfg\);/,
  copy);
const firstWrite = save.indexOf("nvs_set_blob(");
assert.ok(lock >= 0 && decision > lock,
  "the revision must be compared under the config mutex that detection commits under");
assert.ok(staleReturn > decision && copy > staleReturn && reconcile > copy && firstWrite > reconcile,
  "a Stale save must return before any copy, serialization or NVS write");
assert.doesNotMatch(save, /runtime_revision\s*!=\s*g_cfg\.runtime_revision/,
  "the revision rule must not be re-derived beside config_save_revision");
assert.match(config,
  /bool config_save\(const Config& c\) \{\s*return save_whole\(c, \/\*owns_link=\*\/false\) == ConfigSaveResult::Saved;\s*\}/,
  "service saves must own no link and reconcile detection");
assert.match(config,
  /ConfigSaveResult config_save_link\(const Config& c\) \{ return save_whole\(c, \/\*owns_link=\*\/true\); \}/,
  "the X10A save must own the link");
assert.match(configHeader, /\[\[nodiscard\]\] bool config_save\(const Config& c\);/,
  "config_save must no longer accept a caller-chosen link ownership flag");
assert.match(configHeader, /\[\[nodiscard\]\] ConfigSaveResult config_save_link\(const Config& c\);/,
  "the X10A save result must stay impossible to ignore");

// 2. Exactly one owner of the link, and no reconciling save on its X10A path.
const linkSaves = [...http.matchAll(/config_save_link\(/g)].length;
assert.equal(linkSaves, 1, "/set_hp must be the only HTTP writer that owns the X10A link");
for (const path of ["main/wifi.cpp", "main/hp_modbus.cpp", "main/hp_poll.cpp", "main/main.cpp"])
  assert.doesNotMatch(read(path), /config_save_link\(/, `${path} must not own the X10A link`);

// 3. Fresh snapshot per attempt, Stale re-derives, success alone reaches the side effects.
const setHpStart = http.indexOf("static esp_err_t set_hp(");
const setHpEnd = http.indexOf("static esp_err_t discover_homehub_now", setHpStart);
assert.ok(setHpStart >= 0 && setHpEnd > setHpStart, "the /set_hp handler must remain identifiable");
const setHp = http.slice(setHpStart, setHpEnd);
const snapshotRe = /Config\s+c\s*=\s*config\(\);/;
const parsed = at(setHp, /SetHpX10aPatch\s+x10a;/);
const released = at(setHp, /j\.reset\(\);\s*for \(int attempt = 1;; \+\+attempt\) \{/, parsed);
const snapshot = at(setHp, snapshotRe, released);
const derive = at(setHp, /set_hp_apply_x10a\(c, x10a, reset_checkup\)/, snapshot);
const linkSave = at(setHp, /const ConfigSaveResult\s+saved\s*=\s*config_save_link\(c\);/, derive);
const retry = at(setHp, /if \(attempt < SET_HP_SAVE_ATTEMPTS\) continue;/, linkSave);
const conflict = at(setHp, /send_err\(req, "409 Conflict"/, retry);
const failed = at(setHp, /if \(saved != ConfigSaveResult::Saved\)/, conflict);
const reconfigure = at(setHp, /hp_poll_reconfigure\(\);/, failed);
assert.ok(parsed >= 0 && released > parsed,
  "the request must be parsed once and its JSON released before the attempts");
assert.ok(snapshot > released && derive > snapshot && linkSave > derive,
  "each attempt must derive the X10A patch from its own fresh config() snapshot");
assert.ok(retry > linkSave && conflict > retry && failed > conflict && reconfigure > failed,
  "a Stale save must retry or answer 409, and only a saved request may reconfigure the poll task");
assert.equal([...setHp.matchAll(new RegExp(snapshotRe.source, "g"))].length, 1,
  "/set_hp must not derive from a snapshot read outside its attempt loop");
assert.doesNotMatch(setHp, /set_hp_resets_checkup|set_hp_clears_fingerprint|set_hp_profile_compatible/,
  "the handler must not re-implement set_hp_apply_x10a's snapshot-relative rules inline");
assert.match(http, /static constexpr int SET_HP_SAVE_ATTEMPTS = [1-9];/,
  "the Stale retry must stay bounded");

// 4. The harness replays the production decision.
assert.match(harness,
  /bool save_http\(RuntimeConfigSnapshot requested, bool owns_link\) \{\s*switch \(daik::config_save_revision\(owns_link, requested\.revision, current_\.revision\)\)/,
  "the runtime harness must use the production revision decision, not a private copy");

console.log("config ownership: X10A /set_hp saves are revision-checked and re-derived on conflict");
