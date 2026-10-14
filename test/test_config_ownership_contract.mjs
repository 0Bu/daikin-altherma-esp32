// Source-boundary regression test for configuration ownership: concurrent writers (tracker card
// CFG-04) and what an X10A save is allowed to write (CFG-03).
//
// test/test_logic.cpp proves what logic/config_model.hpp DECIDES and runs the save transactions of
// logic/config_transaction.hpp over a recording store; the runtime harness replays the failure
// boundaries and the interleavings over a fake NVS with the same transactions. Neither can prove
// that the firmware still CALLS them where it matters, which is what this file pins:
//
//   1. the transaction decides through config_save_revision, refuses a Stale save before it copies,
//      serializes or writes anything, stages everything before its first write, and writes the
//      service blob only for a save that does not own the link;
//   2. config.cpp reaches NVS for these two paths only through the transactions, on the live config,
//      under the config mutex;
//   3. only /set_hp owns the link, and its X10A path saves through config_save_link, never through
//      the reconciling whole-struct config_save;
//   4. every attempt of /set_hp reads a fresh config() and applies the parsed patch to it, and a
//      Stale result re-runs that derivation instead of reporting success or committing the old one;
//   5. the runtime harness executes the production transactions and holds no sequence of its own;
//   6. a stored "cfg" blob config_load could not use (CFG-05/a) is kept: the verdict sets one flag,
//      only a landed explicit service save clears it, and every AUTOMATIC writer of the blob asks it
//      before writing, while the explicit /set_* handlers do not;
//   7. a refused /set_board save maps to a conflict and the preset offer list withholds detected
//      Ethernet pads (CFG-08/b, CFG-08/c).
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
const count = (text, re) => [...text.matchAll(new RegExp(re.source, "g"))].length;
const config = read("main/config.cpp");
const configHeader = read("main/config.hpp");
const transaction = read("main/logic/config_transaction.hpp");
const http = read("main/http_config.cpp");
const harness = read("test/runtime/fake_runtime.hpp");
const harnessTests = read("test/runtime/runtime_integration_tests.cpp");

// 1. The save transaction: its decision and its position before every side effect.
const saveStart = transaction.indexOf("ConfigSaveOutcome config_save_transaction(");
const saveEnd = transaction.indexOf("\ntemplate <class Store>", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "the one whole-struct save transaction must remain identifiable");
const save = transaction.slice(saveStart, saveEnd);
const decision = at(save,
  /config_save_revision\(\s*owns_link,\s*requested\.runtime_revision,\s*live\.runtime_revision\)/);
const staleReturn = at(save,
  /if \(revision == ConfigSaveRevision::Stale\) \{\s*out\.result = ConfigSaveResult::Stale;\s*return out;\s*\}/,
  decision);
const copy = at(save, /Config\s+c\s*=\s*requested;/, staleReturn);
const reconcile = at(save,
  /if \(revision == ConfigSaveRevision::ReconcileDetected\)\s*reconcile_detected_config\(c, live\);/,
  copy);
// CFG-08/b: a reconciled link that lands on a requested local pin refuses the save, after the
// reconcile and before anything is serialized or written.
const localPins = at(save,
  /if \(config_reconcile_breaks_local_pins\(requested, c\)\) \{\s*out\.result = ConfigSaveResult::Stale;\s*return out;\s*\}/,
  reconcile);
assert.ok(localPins > reconcile,
  "a service save must refuse a reconciled link that collides with its local pins");
const serviceStage = at(save,
  /if \(!owns_link\) \{\s*const ConfigBlob b = config_blob_from\(c\);\s*if \(!config_blob_strings_fit\(b\)\)/,
  localPins);
const linkStage = at(save, /link_blob_serialize\(/, serviceStage);
const published = at(save, /Config\s+published\s*=\s*std::move\(c\);/, linkStage);
const firstWrite = save.indexOf("store.write_blob(");
assert.ok(decision >= 0, "the revision must be decided through config_save_revision");
assert.ok(staleReturn > decision && copy > staleReturn && reconcile > copy && serviceStage > reconcile,
  "a Stale save must return before any copy, serialization or write");
assert.ok(linkStage > serviceStage && published > linkStage && firstWrite > published,
  "every serialization and the RAM successor must be staged before the first durable write");
assert.doesNotMatch(save, /runtime_revision\s*!=\s*live\.runtime_revision/,
  "the revision rule must not be re-derived beside config_save_revision");

// The service blob is neither built nor written for a save that owns the link (CFG-03/a): the RAM
// view of an X10A save also carries what config_load sanitised without persisting.
assert.equal(count(save, /config_blob_from\(/), 1,
  "the service blob may be built in exactly one place, behind the ownership guard");
assert.equal(count(save, /store\.write_blob\(CONFIG_KEY_SERVICE/), 1,
  "the transaction must have exactly one service write");
assert.match(save,
  /if \(!owns_link\) \{\s*const int service_err =\s*store\.write_blob\(CONFIG_KEY_SERVICE,/,
  "the service write must be guarded by !owns_link");
assert.equal(count(save, /store\.write_blob\(CONFIG_KEY_LINK/), 1,
  "the transaction must have exactly one link write");
const serviceWrite = at(save, /store\.write_blob\(CONFIG_KEY_SERVICE/, published);
const linkWrite = at(save, /store\.write_blob\(CONFIG_KEY_LINK/, serviceWrite);
const publish = at(save, /live\s*=\s*std::move\(published\)/, linkWrite);
assert.ok(serviceWrite === firstWrite && linkWrite > serviceWrite && publish > linkWrite,
  "the service write comes first, the link write second, and RAM is published last");
assert.match(save, /static_assert\(std::is_nothrow_move_assignable_v<Config>/,
  "the only post-write Config publication must be statically non-throwing");
assert.match(save,
  /config_save_succeeded\(\/\*blob_ok=\*\/true, link_err == 0, owns_link\)/,
  "the X10A save must succeed exactly when its link entry landed");

// The key spelling the writers use is the one config_load reads.
assert.match(transaction, /CONFIG_KEY_SERVICE = "cfg";/, "the service entry key is on-flash format");
assert.match(transaction, /CONFIG_KEY_LINK\s*=\s*"link";/, "the link entry key is on-flash format");
// The tri-state read: "no entry" and "an entry this build cannot use" must stay distinguishable.
assert.match(config, /nvs_read_blob\("cfg", raw\)/, "config_load must read the service entry");
assert.match(config, /nvs_read_blob\("link", link_raw\)/, "config_load must read the link entry");
assert.doesNotMatch(config, /nvs_get_blob\(/,
  "config_load must not collapse a missing entry and an unreadable one into one false");

// 2. config.cpp reaches NVS for these paths only through the transactions.
assert.equal(count(config, /nvs_set_blob\(/), 1,
  "config.cpp may write NVS blobs only through the transaction store adapter");
assert.match(config,
  /struct NvsBlobStore \{\s*int write_blob\(const char\* key, const uint8_t\* data, size_t len\) \{\s*return nvs_set_blob\(key, data, len\);\s*\}\s*\};/,
  "the store adapter must forward the write unchanged");
const saveWholeStart = config.indexOf("static ConfigSaveResult save_whole(const Config& requested, bool owns_link)");
const saveWholeEnd = config.indexOf("\nbool config_save(const Config& c)", saveWholeStart);
assert.ok(saveWholeStart >= 0 && saveWholeEnd > saveWholeStart, "the one whole-struct save must remain identifiable");
const saveWhole = config.slice(saveWholeStart, saveWholeEnd);
const lock = at(saveWhole, /Lock\s+lk\(g_mtx\);/);
const run = saveWhole.indexOf("config_save_transaction(g_cfg, requested, owns_link, store)");
assert.ok(lock >= 0 && run > lock,
  "the transaction must run on the live config under the mutex that detection commits under");
assert.doesNotMatch(saveWhole, /g_cfg\s*=|runtime_revision|nvs_set_blob\(/,
  "save_whole must not publish, version or write anything itself");
const commitStart = config.indexOf("bool config_commit_detected_link(");
const commitEnd = config.indexOf("\nbool config_commit_detected_model(", commitStart);
const commit = config.slice(commitStart, commitEnd);
const commitLock = at(commit, /Lock\s+lk\(g_mtx\);/);
assert.ok(commitStart >= 0 && commitEnd > commitStart && commitLock >= 0 &&
  at(commit, /config_commit_detected_link_transaction\(\s*g_cfg,\s*expected\.runtime_revision/, commitLock) >
    commitLock,
  "the detection link commit must run its transaction on the live config under the mutex");
assert.doesNotMatch(commit, /g_cfg\.|nvs_set_blob\(/,
  "the detection link commit must not touch the config or NVS outside its transaction");
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

// 3. Exactly one owner of the link, and no reconciling save on its X10A path.
const linkSaves = [...http.matchAll(/config_save_link\(/g)].length;
assert.equal(linkSaves, 1, "/set_hp must be the only HTTP writer that owns the X10A link");
for (const path of ["main/wifi.cpp", "main/hp_modbus.cpp", "main/hp_poll.cpp", "main/main.cpp"])
  assert.doesNotMatch(read(path), /config_save_link\(/, `${path} must not own the X10A link`);

// 4. Fresh snapshot per attempt, Stale re-derives, success alone reaches the side effects.
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
// A request that mixes X10A and HomeHub fields is refused before any attempt: the link-only X10A
// save would publish the HomeHub fields to RAM without ever writing them to "cfg".
const mixedReject = at(setHp,
  /if \(!set_hp_update_domains_compatible\(x10a_sent, homehub_sent\)\) \{\s*j\.reset\(\);\s*return send_err\(req, "400 Bad Request",\s*"update X10A and HomeHub in separate requests"\);\s*\}/,
  parsed);
assert.ok(mixedReject > parsed && released > mixedReject,
  "a mixed X10A + HomeHub /set_hp must answer 400 before the save attempts begin");
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

// 5. The harness executes the production transactions and holds no sequence of its own: its
// coordinator forwards to them, and neither harness file decides a revision, builds or serializes a
// blob, reconciles detection, or versions the config itself.
assert.match(harness,
  /daik::config_save_transaction\(\s*live_,\s*requested,\s*owns_link,\s*store\)/,
  "the runtime harness must run the production save transaction");
assert.match(harness,
  /daik::config_commit_detected_link_transaction\(\s*live_,\s*expected_revision,\s*rx,\s*tx,\s*proto,\s*identity_fp,\s*store,/,
  "the runtime harness must run the production detected-link transaction");
assert.match(harness,
  /daik::config_commit_detected_model_if_current\(\s*live_,\s*expected_revision,/,
  "the runtime harness must run the production detected-model commit");
for (const [file, text] of [["fake_runtime.hpp", harness], ["runtime_integration_tests.cpp", harnessTests]])
  assert.doesNotMatch(text,
    /config_save_revision\(|reconcile_detected_config\(|config_blob_serialize\(|link_blob_serialize\(|config_blob_strings_fit\(|config_blob_from\(|apply_link\(|apply_model\(|config_next_revision\(/,
    `${file} must not carry a private copy of the save or commit sequence`);
assert.doesNotMatch(harness, /runtime_revision\s*(?:=[^=]|\+\+|\+=)/,
  "the harness must not version the config itself; only the transactions bump the revision");

// 6. A stored blob this boot could not use is kept until an explicit save.
const loadStart = config.indexOf("void config_load()");
const loadEnd = config.indexOf("\n// The NVS side of the logic/config_transaction.hpp transactions", loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart, "config_load must remain identifiable");
const load = config.slice(loadStart, loadEnd);
const cfgRead = at(load, /nvs_read_blob\("cfg", raw\)/);
const verdict = at(load, /config_load_verdict\(stored_entry_read\(cfg_read\), blob_loaded\)/, cfgRead);
const flagSet = at(load,
  /s_cfg_blob_unreadable\.store\(!config_load_allows_automatic_writes\(cfg_verdict\),/, verdict);
assert.ok(cfgRead >= 0 && verdict > cfgRead && flagSet > verdict,
  "config_load must derive the keep-stored flag from the verdict of the service read");
assert.equal(count(config, /s_cfg_blob_unreadable\.store\(/), 2,
  "only config_load (set) and a landed service save (clear) may change the keep-stored flag");
assert.match(saveWhole,
  /if \(!owns_link && out\.result == ConfigSaveResult::Saved\)\s*s_cfg_blob_unreadable\.store\(false,/,
  "only a landed explicit service save may clear the keep-stored flag");
assert.match(config,
  /bool config_stored_blob_unreadable\(\) \{\s*return s_cfg_blob_unreadable\.load\(std::memory_order_acquire\);\s*\}/,
  "the automatic writers must read the flag config_load set");

// Every automatic writer of the service blob asks before its config_save; none of them may write
// first and ask afterwards.
const modbus = read("main/hp_modbus.cpp");
const discoveryStart = modbus.indexOf("void mb_autodiscover_initial()");
const discoveryEnd = modbus.indexOf("// Non-blocking connect", discoveryStart);
assert.ok(discoveryStart >= 0 && discoveryEnd > discoveryStart, "initial discovery must remain identifiable");
const discovery = modbus.slice(discoveryStart, discoveryEnd);
const discoveryGate = at(discovery, /if \(config_stored_blob_unreadable\(\)\) \{[^}]*return;\s*\}/);
assert.ok(discoveryGate >= 0 &&
          discoveryGate < discovery.indexOf("discover_homehub_bounded(") &&
          discoveryGate < discovery.indexOf("config_save(c)"),
  "the initial HomeHub search must skip, before searching or saving, when the stored blob is kept");
const wifi = read("main/wifi.cpp");
const rollbackStart = wifi.indexOf("void wifi_finish_sta_rollback()");
const successStart = wifi.indexOf("void wifi_finish_sta_success()", rollbackStart);
const successEnd = wifi.indexOf("\nbool wifi_start_sta()", successStart);
assert.ok(rollbackStart >= 0 && successStart > rollbackStart && successEnd > successStart,
  "the WiFi boot-time saves must remain identifiable");
const rollback = wifi.slice(rollbackStart, successStart);
const success = wifi.slice(successStart, successEnd);
assert.match(rollback,
  /const bool keep_stored = config_stored_blob_unreadable\(\);\s*if \(!keep_stored && config_save\(rollback_cfg\)\)/,
  "the rollback restore must not persist over a kept stored blob");
assert.equal(count(rollback, /config_save\(/), 1, "the rollback restore has exactly one save");
const successGate = at(success, /if \(config_stored_blob_unreadable\(\)\) \{[\s\S]*?return;\s*\}/);
assert.ok(successGate >= 0 && successGate < success.indexOf("config_save(success_cfg)"),
  "clearing the rollback backup must not persist over a kept stored blob");
// Explicit owner saves are exactly what may replace a kept blob: no HTTP handler consults the flag.
assert.doesNotMatch(http, /config_stored_blob_unreadable/,
  "explicit /set_* saves must stay able to replace a stored blob this boot could not use");

// The load-path repairs run where the host-tested helpers assume (CFG-08/a and CFG-08/c): a stored
// non-canonical "absent" is normalized before the board check can revoke the board, and the
// indicator/button yield to the FINAL X10A pair — after the link fallback, before ENV III's re-check.
const normalize = at(load, /config_normalize_absent_local_pins\(c\)/);
const boardCheck = at(load, /board_hw_valid\(probe, why,/);
assert.ok(normalize >= 0 && boardCheck > normalize,
  "config_load must normalize a stored GPIO below -1 before the board check");
const linkFallback = at(load, /c\.rx_pin = CONFIG_DAIKIN_RX_PIN;\s*c\.tx_pin = CONFIG_DAIKIN_TX_PIN;/);
const yieldPins = at(load, /config_yield_local_pins_to_link\(c\)/, linkFallback);
const envRecheck = at(load, /if \(c\.env3_enabled\) \{/, yieldPins);
assert.ok(linkFallback >= 0 && yieldPins > linkFallback && envRecheck > yieldPins,
  "config_load must yield the indicator/button to the final X10A pair right after its fallback");

// 7. /set_board answers a refused (Stale) save as a conflict, re-checking the live link without a
// third Config copy; the preset rows honour detected Ethernet pads like the pin lists.
const setBoardStart = http.indexOf("static esp_err_t set_board(");
const setBoardEnd = http.indexOf("static esp_err_t set_env3(", setBoardStart);
assert.ok(setBoardStart >= 0 && setBoardEnd > setBoardStart, "the /set_board handler must remain identifiable");
const setBoard = http.slice(setBoardStart, setBoardEnd);
assert.match(setBoard,
  /if \(!config_save\(c\)\) \{[\s\S]*?config_link_snapshot\(\);[\s\S]*?if \(config_local_pins_collide_with_link\(c\)\)\s*return send_err\(req, "409 Conflict",[\s\S]*?return send_err\(req, "500 Internal Server Error", "config write failed"\);\s*\}/,
  "a /set_board save refused for a link collision must answer 409, a failed write 500");
const status = read("main/http_status.cpp");
assert.match(status,
  /board_presets_offerable\(presets, BOARD_PRESETS_MAX, hw_octal_spi\(\),\s*config_board_reserved_pins\(c, net_eth_reserved_pins\(\)\)\)/,
  "the board preset rows must withhold detected Ethernet pads like the pin pickers");

console.log("config ownership: X10A /set_hp saves are link-only, revision-checked and re-derived on conflict");
