#!/usr/bin/env node
// Prove test/test_ota_heap_contract.mjs still detects removal of every load-bearing protection.
// Each mutation runs in an isolated throwaway tree and must turn the real CI contract red.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = path.join(root, "test/test_ota_heap_contract.mjs");
const files = [
  "sdkconfig.defaults",
  "main/ota_update.cpp",
  "main/hp_poll.cpp",
  "main/logic/ota_headroom.hpp",
  "main/logic/ota_transport.hpp",
];
const pristine = new Map(files.map((rel) => [rel, fs.readFileSync(path.join(root, rel), "utf8")]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ota-contract-"));

const restore = () => {
  for (const [rel, contents] of pristine) {
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};
const run = () => spawnSync(process.execPath, [contract], {
  cwd: root,
  env: { ...process.env, OTA_CONTRACT_ROOT: tmp },
  encoding: "utf8",
});
const replaceOnce = (rel, before, after) => {
  const target = path.join(tmp, rel);
  const old = fs.readFileSync(target, "utf8");
  const changed = old.replace(before, after);
  assert.notEqual(changed, old, `selftest mutation no longer reaches ${rel}: ${String(before)}`);
  fs.writeFileSync(target, changed);
};

try {
  restore();
  const baseline = run();
  if (baseline.status !== 0) {
    process.stderr.write(baseline.stdout + baseline.stderr);
    throw new Error("OTA contract is already red on the unmodified tree");
  }

  const cases = [
    ["signed-on-update is disabled", () =>
      replaceOnce("sdkconfig.defaults", "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y",
        "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=n")],
    ["the contiguous-block half of the headroom predicate is inverted", () =>
      replaceOnce("main/logic/ota_headroom.hpp",
        "largest_free_block >= OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES",
        "largest_free_block <= OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES")],
    ["an HTTP redirect is admitted as if it were HTTPS", () =>
      replaceOnce("main/logic/ota_transport.hpp",
        "if (ota_url_is_absolute_https(value)) return true;",
        "if (ota_url_is_absolute_https(value) || ota_ascii_prefix_ieq(value, \"http://\")) return true;")],
    ["one initial OTA URL skips the absolute-HTTPS gate", () =>
      replaceOnce("main/ota_update.cpp", "if (!ota_url_is_absolute_https(url))",
        "if (!ota_url_is_https_or_relative(url))")],
    ["one OTA client no longer forces the SSL transport", () =>
      replaceOnce("main/ota_update.cpp", "transport_type    = HTTP_TRANSPORT_OVER_SSL",
        "transport_type    = HTTP_TRANSPORT_UNKNOWN")],
    ["the firmware client silently re-enables automatic redirects", () =>
      replaceOnce("main/ota_update.cpp", "http.disable_auto_redirect = true;",
        "http.disable_auto_redirect = false;")],
    ["redirect Location validation is bypassed", () =>
      replaceOnce("main/ota_update.cpp", "ota_redirect_location_observe(*policy, event->header_value);",
        "policy->location_count = 1; policy->location_secure = true;")],
    ["duplicate Location lets an insecure first header hide behind a secure last header", () => {
      replaceOnce("main/logic/ota_transport.hpp", "else\n        state.location_secure = false;",
        "else\n        state.location_secure = ota_url_is_https_or_relative(value);");
      replaceOnce("main/logic/ota_transport.hpp", "state.location_count == 1 && state.location_secure",
        "state.location_count >= 1 && state.location_secure");
    }],
    ["duplicate Location lets a secure first header hide an insecure last header", () => {
      replaceOnce("main/logic/ota_transport.hpp", "else\n        state.location_secure = false;",
        "else\n        state.location_secure = state.location_secure;");
      replaceOnce("main/logic/ota_transport.hpp", "state.location_count == 1 && state.location_secure",
        "state.location_count >= 1 && state.location_secure");
    }],
    ["the redirect socket is reopened without being closed", () =>
      replaceOnce("main/ota_update.cpp",
        /(e = esp_http_client_set_redirection\(client\);[\s\S]{0,600}?)esp_http_client_close\(client\);/,
        "$1esp_http_client_redirect_socket_left_open(client);")],
    ["the redirect response is reused without cleanup", () =>
      replaceOnce("main/ota_update.cpp", "esp_http_client_clear_response_buffer(client);",
        "esp_http_client_response_buffer_left_live(client);")],
    ["one of the two headroom gates is bypassed", () =>
      replaceOnce("main/ota_update.cpp",
        /wait_for_ota_verify_headroom\(([^;]+)\);/,
        "ota_headroom_gate_bypassed($1);")],
    ["HTTP cleanup before validation disappears", () =>
      replaceOnce("main/ota_update.cpp", "buffer = nullptr;\n    close_http_client(client);",
        "buffer = nullptr;\n    close_http_client_after_validation(client);")],
    ["the signed-image verifier is bypassed", () =>
      replaceOnce("main/ota_update.cpp", "esp_ota_end(ota_handle)",
        "esp_ota_end_bypassed(ota_handle)")],
    ["validation is again mislabeled as a bad signature", () =>
      replaceOnce("main/ota_update.cpp", "Update rejected: image validation failed",
        "Update rejected: bad signature")],
    ["the memory refusal no longer tells the operator how to retry", () =>
      replaceOnce("main/ota_update.cpp", " — retry after reboot", "")],
    ["an image-size overrun is mislabeled as a read failure", () =>
      replaceOnce("main/ota_update.cpp",
        "transfer_failure = OtaTransferFailure::Size;",
        "transfer_failure = OtaTransferFailure::Read;")],
    ["the held X10A task no longer acknowledges quiescence", () =>
      replaceOnce("main/hp_poll.cpp",
        "s_ota_quiesced.store(true, std::memory_order_release);",
        "s_ota_quiesced.store(false, std::memory_order_release);")],
    ["OTA starts without waiting for the X10A acknowledgement", () =>
      replaceOnce("main/ota_update.cpp", "if (!wait_for_poll_quiesce())",
        "if (false)")],
    ["the X10A poll no longer enters the bounded OTA quiesce", () =>
      replaceOnce("main/hp_poll.cpp", "ota_quiesce_step(ota_quiesce, ota_active)",
        "ota_quiesce_bypassed(ota_quiesce, ota_active)")],
  ];

  let caught = 0;
  for (const [name, mutate] of cases) {
    restore();
    mutate();
    const result = run();
    if (result.status === 0) throw new Error(`OTA contract missed mutation: ${name}`);
    caught++;
    console.log(`ota selftest: detected — ${name}`);
  }
  console.log(`ota selftest: all ${caught} seeded regressions caught`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
