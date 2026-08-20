// Source-boundary contract for the bounded X10A publish path and the weather fetch headroom gate
// (private issue 10: recurring `publish skipped at x10a (std::bad_alloc)` + the 800 B heap
// low-water at a weather TLS fetch).
//
// The host C++ suite proves the pure parts — the counting pass writes the exact bytes the old
// builder wrote, the digest is FNV-1a 64, the headroom predicate has the right floors — but it
// cannot link ESP-IDF and therefore cannot prove the load-bearing call sites: the per-second X10A
// cycle must go through the reused buffers and the bounded builder (never the owning one-shot form),
// the dedup guard must be the digest (not a retained full-payload copy), the publish-skip catch
// must carry the allocation-free heap snapshot, and the weather fetch must stand down for one
// raster period when the headroom gate refuses. Those are whole-component claims, so this test
// reads the production call sites.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.OTA_CONTRACT_ROOT || defaultRoot);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const occurrences = (text, token) => text.split(token).length - 1;

const mqtt = code("main/mqtt_ha.cpp");
const weather = code("main/weather_forecast.cpp");
const group = code("main/logic/mqtt_group.hpp");

// ── The per-second X10A cycle owns its buffers and the bounded builder ─────────────────────────
// The owning build_grouped_json allocates a fresh string per call and is the churn this fix
// removes; the cycle must run on the task-owned vectors, the counting pass and the append into the
// reusable buffer. A stray call to the owning form on this path silently reintroduces the
// per-cycle allocation this contract exists to prevent.
const publishStart = mqtt.indexOf("static bool publish_x10a_state(");
const publishEnd = mqtt.indexOf("static void publish_modbus_state()", publishStart);
assert.ok(publishStart >= 0 && publishEnd > publishStart,
  "the X10A publish boundary must remain identifiable");
const publish = mqtt.slice(publishStart, publishEnd);
assert.ok(publish.indexOf("fill_x10a_values(s_x10a_cache, s_x10a_grouped)") >= 0,
  "the cycle must fill the task-owned snapshot buffers, not build fresh vectors");
assert.ok(publish.indexOf("grouped_json_size(s_x10a_grouped)") >= 0,
  "the exact-size counting pass must run before the write");
assert.ok(publish.indexOf("append_grouped_json(s_x10a_json, s_x10a_grouped)") >= 0,
  "the payload must be written into the reused buffer via the bounded append");
assert.ok(publish.indexOf("fnv1a64(s_x10a_json)") >= 0,
  "the dedup guard must compare the digest of the built payload");
assert.ok(publish.indexOf("build_grouped_json") < 0,
  "the owning one-shot builder must not run on the per-second publish path");

// ── The dedup guard is a digest, not a retained copy of the payload ────────────────────────────
assert.match(mqtt, /static\s+uint64_t\s+s_last_x10a_digest\s*=\s*0;/,
  "the X10A dedup guard must be the 8-byte digest (0 = nothing published yet)");
assert.doesNotMatch(mqtt, /s_last_x10a_json/,
  "no full-payload dedup copy may remain anywhere in the publisher");
assert.match(mqtt, /static\s+std::vector<CachedValue>\s+s_x10a_cache;/,
  "the snapshot cache must be task-owned and persistent");
assert.match(mqtt, /static\s+std::vector<GroupedValue>\s+s_x10a_grouped;/,
  "the grouped snapshot must be task-owned and persistent");
assert.match(mqtt, /static\s+std::string\s+s_x10a_json;/,
  "the payload buffer must be task-owned and persistent");

// fill_x10a_values re-slugs keys into reused slots instead of allocating one object-id temporary
// per row; the into-slot slug must therefore sit on the production fill path.
const fillStart = mqtt.indexOf("static size_t fill_x10a_values(");
const fillEnd = mqtt.indexOf("static std::vector<GroupedValue> current_modbus_values(bool& live)", fillStart);
assert.ok(fillStart >= 0 && fillEnd > fillStart, "the snapshot fill must remain identifiable");
const fill = mqtt.slice(fillStart, fillEnd);
assert.ok(fill.indexOf("ha_slug_into(g.key, cache[i].label)") >= 0,
  "row keys must be re-slugged into reused slots, without a per-row temporary");

// ── The publish-skip catch carries the allocation-free heap snapshot ───────────────────────────
// Both heap samplers must sit inside the catch handlers (the two-sampler pair is the evidence that
// identifies the collision partner at the throw second), and the counter must still be incremented
// BEFORE the allocating log line.
const catchStart = mqtt.indexOf("} catch (const std::exception& e) {");
assert.ok(catchStart >= 0, "the publish-skip catch must remain identifiable");
const catchRegion = mqtt.slice(catchStart, mqtt.indexOf("vTaskDelay(pdMS_TO_TICKS(delay_s * 1000))", catchStart));
assert.ok(catchRegion.indexOf("s_mqtt_skipped.fetch_add(1") >= 0 &&
          catchRegion.indexOf("heap_caps_get_free_size(") >= 0 &&
          catchRegion.indexOf("heap_largest_internal_block()") >= 0,
  "the catch must count first and log the heap snapshot on the same line");
assert.equal(occurrences(mqtt, "publish skipped at"), 2,
  "the heap snapshot must be logged from both the std::exception and the unknown-exception handler");

// ── The weather fetch stands down for one raster period below the headroom floors ──────────────
assert.ok(weather.indexOf("weather_fetch_headroom_ok(headroom.free_internal, headroom.largest_internal)") >= 0,
  "the weather task must gate the fetch on the headroom predicate");
assert.ok(weather.indexOf("const HttpClientProbe headroom = http_client_probe();") >= 0,
  "the gate must read the allocation-free heap probe, not an allocating status path");
const probeAt = weather.indexOf("http_client_probe()");
const fetchAt = weather.indexOf("fetch_forecast(cfg, sample, error)");
assert.ok(probeAt >= 0 && fetchAt > probeAt,
  "the headroom probe must precede the TLS fetch");
assert.match(weather, /s_status\.reason\s*=\s*"heap_headroom";/,
  "a refused fetch must state the heap-headroom reason");
const skipBranch = weather.indexOf('"heap_headroom"');
const skipWait = weather.indexOf("WEATHER_FETCH_INTERVAL_S * 1000u", skipBranch);
assert.ok(skipWait > skipBranch && skipWait < fetchAt,
  "the refused fetch must skip one full raster period, then retry on schedule");

// ── The bounded builder keeps ONE encoder and the owning form wraps it ─────────────────────────
const owning = group.indexOf("inline std::string build_grouped_json(");
assert.ok(owning >= 0 && group.indexOf("grouped_json_size(vals)", owning) >= 0 &&
          group.indexOf("append_grouped_json(j, vals)", owning) >= 0,
  "build_grouped_json must be the counting pass + reserve + append, not a second encoder");
assert.match(group, /inline\s+size_t\s+grouped_json_size\(/,
  "the counting pass must be exposed for the device call site");
assert.match(group, /inline\s+void\s+append_grouped_json\(/,
  "the bounded append must be exposed for the device call site");
assert.match(group, /inline\s+uint64_t\s+fnv1a64\(/,
  "the dedup digest must be a pure, host-tested function");
