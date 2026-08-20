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
// short retry when the last-moment headroom gate refuses. Those are whole-component claims, so this test
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
const hpPoll = code("main/hp_poll.cpp");
const snapshot = code("main/logic/x10a_snapshot.hpp");
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
assert.ok(publish.indexOf("prepare_x10a_buffers(config.profile)") >= 0 &&
          publish.indexOf("fill_x10a_values(config)") >= 0,
  "the cycle must use the prepared stable snapshot layout, not build fresh vectors");
assert.ok(publish.indexOf("grouped_json_size(s_x10a_grouped)") >= 0,
  "the exact-size counting pass must run before the write");
assert.ok(publish.indexOf("append_grouped_json(s_x10a_json, s_x10a_grouped)") >= 0,
  "the payload must be written into the reused buffer via the bounded append");
assert.ok(publish.indexOf("fnv1a64(std::string_view(s_x10a_json.data(), s_x10a_json.size()))") >= 0,
  "the dedup guard must compare the digest of the built payload");
assert.ok(publish.indexOf("build_grouped_json") < 0,
  "the owning one-shot builder must not run on the per-second publish path");
assert.ok(publish.indexOf("need > X10A_GROUPED_JSON_MAX_BYTES") >= 0 &&
          publish.indexOf("reserve(need)") < 0,
  "the device path must refuse an oversized payload instead of growing its fixed buffer");
assert.match(publish,
  /if\s*\(\s*!mqtt_publish\(s_x10a[\s\S]*?\)\s*\)\s*return false;\s*s_last_x10a_digest\s*=\s*digest;/,
  "a failed broker publish must return before committing the digest, so the next cycle retries");
const x10aStage = mqtt.indexOf('publish_stage = "x10a"');
const x10aStageEnd = mqtt.indexOf('publish_stage = "modbus"', x10aStage);
assert.ok(x10aStage >= 0 && x10aStageEnd > x10aStage &&
          mqtt.slice(x10aStage, x10aStageEnd).includes("const std::string& prof = ref_config.profile"),
  "the per-second x10a stage must borrow the already-copied profile string, not allocate another one");

// ── The dedup guard is a digest, not a retained copy of the payload ────────────────────────────
assert.match(mqtt, /static\s+uint64_t\s+s_last_x10a_digest\s*=\s*0;/,
  "the X10A dedup guard must be the 8-byte digest (0 = nothing published yet)");
assert.doesNotMatch(mqtt, /s_last_x10a_json/,
  "no full-payload dedup copy may remain anywhere in the publisher");
assert.match(mqtt, /static\s+std::vector<CachedValue>\s+s_x10a_cache;/,
  "the snapshot cache must be task-owned and persistent");
assert.match(mqtt, /static\s+std::vector<X10aGroupedSlot>\s+s_x10a_grouped;/,
  "the grouped snapshot must be task-owned and persistent");
assert.match(mqtt,
  /static\s+std::array<char,\s*X10A_GROUPED_JSON_MAX_BYTES\s*\+\s*1>\s+s_x10a_json_storage\s*\{\s*\};/,
  "the payload bytes must live in fixed static storage, not a large heap string");
assert.match(mqtt,
  /static\s+BoundedJsonBuffer\s+s_x10a_json\s*\(\s*s_x10a_json_storage\.data\(\),\s*X10A_GROUPED_JSON_MAX_BYTES\s*\);/,
  "the device serializer must expose the fixed storage through the bounded sink");
assert.doesNotMatch(mqtt, /s_x10a_json\.reserve\s*\(/,
  "the fixed X10A payload must never reserve a heap block");

// Profile preparation creates every base/companion slot and reserves value capacity once. The
// per-cycle fill only updates presence/views from the allocation-free aligned snapshot.
const prepareStart = mqtt.indexOf("static void prepare_x10a_buffers(");
const fillStart = mqtt.indexOf("static bool fill_x10a_values(", prepareStart);
const fillEnd = mqtt.indexOf("static std::vector<GroupedValue> current_modbus_values(bool& live)", fillStart);
assert.ok(prepareStart >= 0 && fillStart > prepareStart && fillEnd > fillStart,
  "the profile preparation and snapshot fill must remain identifiable");
const prepare = mqtt.slice(prepareStart, fillStart);
const fill = mqtt.slice(fillStart, fillEnd);
assert.ok(prepare.indexOf("s_x10a_json.reserve") < 0 &&
          prepare.indexOf("ha_slug_into(base.key, d.label)") >= 0,
  "profile preparation may allocate row slots, but the fixed JSON bytes must already be static");
assert.ok(fill.indexOf("hp_values_snapshot_aligned") >= 0 &&
          fill.indexOf("slot.present") >= 0 &&
          fill.indexOf("resize(") < 0 && fill.indexOf("reserve(") < 0,
  "the per-cycle fill must update stable slots without resizing or reserving");
assert.ok(fill.indexOf("hp_values_capacity") < 0,
  "the per-cycle X10A stage must not copy Config merely to size its snapshot");
assert.match(hpPoll,
  /x10a_snapshot_source_matches\(s_cache_profile,\s*s_cache_identity_fp,\s*expected_profile,\s*expected_identity_fp\)[\s\S]{0,200}?x10a_snapshot_align\(out, count, s_cache\.data\(\), s_cache\.size\(\)\)/,
  "the cache lock must delegate to the host-tested aligned snapshot primitive");
assert.ok(snapshot.indexOf("source[src].value.size() > out[dst].value.capacity()") >= 0 &&
          snapshot.indexOf("out[dst].value.assign(") >= 0 &&
          snapshot.indexOf("resize(") < 0 && snapshot.indexOf("reserve(") < 0,
  "the aligned primitive must refuse an undersized slot rather than allocate while held");

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

// ── Weather quiesces both publishers and gates after URL construction, directly before TLS ───
const downloadStart = weather.indexOf("bool download_json(");
const downloadEnd = weather.indexOf("bool json_number_array(", downloadStart);
assert.ok(downloadStart >= 0 && downloadEnd > downloadStart,
  "the weather download boundary must remain identifiable");
const download = weather.slice(downloadStart, downloadEnd);
const reserveAt = download.indexOf("out.reserve(kPayloadMax)");
const urlAt = download.indexOf("open_meteo_url(weather)");
const probeAt = download.indexOf("http_client_probe()");
const gateAt = download.indexOf("weather_fetch_headroom_ok(", probeAt);
const clientAt = download.indexOf("esp_http_client_init(", gateAt);
assert.ok(reserveAt >= 0 && urlAt > reserveAt && probeAt > urlAt &&
          gateAt > probeAt && clientAt > gateAt,
  "response and URL allocations must finish before the final gate and client/TLS setup");
assert.ok(download.indexOf("HttpClientCleanup cleanup(client)", clientAt) > clientAt &&
          download.indexOf("out.reserve(", reserveAt + 1) < 0,
  "the live HTTP client must be unwind-safe and the capped response must not grow under TLS");
const parseStart = weather.indexOf("bool parse_forecast(");
const parseEnd = weather.indexOf("bool fetch_forecast(", parseStart);
assert.ok(parseStart >= 0 && parseEnd > parseStart &&
          weather.slice(parseStart, parseEnd).includes("JsonCleanup cleanup(root)"),
  "the cJSON tree must be released when parse-time vector or error allocations throw");
const fetchAt = weather.indexOf("fetch_forecast(cfg, sample, error");
const quiesceAt = weather.indexOf("vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs))");
const pollBarrierAt = weather.indexOf("hp_poll_network_quiesced()", quiesceAt);
const mqttBarrierAt = weather.indexOf("mqtt_publish_network_quiesced()", pollBarrierAt);
assert.ok(quiesceAt >= 0 && pollBarrierAt > quiesceAt &&
          mqttBarrierAt > pollBarrierAt && fetchAt > mqttBarrierAt,
  "weather must wait for both X10A and MQTT allocation paths before entering the gated fetch");
assert.match(mqtt,
  /ota_quiesce_step\(network_quiesce, network_busy\)[\s\S]{0,600}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)[\s\S]{0,200}?continue;/,
  "the held MQTT cycle must acknowledge weather before sleeping");
assert.match(mqtt,
  /struct\s+MqttPublishActivity[\s\S]{0,500}?store\(false,\s*std::memory_order_release\)[\s\S]{0,300}?~MqttPublishActivity\(\)[\s\S]{0,200}?store\(true,\s*std::memory_order_release\)/,
  "an in-flight MQTT cycle must withdraw and unwind-safely restore the acknowledgement");
assert.match(mqtt,
  /case MQTT_EVENT_BEFORE_CONNECT:[\s\S]{0,120}?mqtt_transport_before_connect\(\)/,
  "the independent esp-mqtt transport task must enter the network-heap handshake before connect");
const transportGateStart = mqtt.indexOf("static void mqtt_transport_before_connect()");
const transportGateEnd = mqtt.indexOf("static void on_mqtt(", transportGateStart);
assert.ok(transportGateStart >= 0 && transportGateEnd > transportGateStart,
  "the MQTT transport handshake must remain identifiable");
const transportGate = mqtt.slice(transportGateStart, transportGateEnd);
assert.match(transportGate,
  /if\s*\(!s_publish_network_quiesced\.load\(std::memory_order_acquire\)\)[\s\S]{0,160}?s_transport_connecting\.store\(true,\s*std::memory_order_release\)[\s\S]{0,80}?return;/,
  "BEFORE_CONNECT must not wait under MQTT_API_LOCK when the firmware publisher already owns heap");
assert.match(transportGate,
  /s_transport_connecting\.store\(true,\s*std::memory_order_release\)[\s\S]{0,180}?competing_tls_active\(\)/,
  "transport must publish its claim and recheck both remote TLS owners before connecting");
assert.match(mqtt,
  /return s_publish_network_quiesced\.load\(std::memory_order_acquire\)\s*&&\s*!s_transport_connecting\.load\(std::memory_order_acquire\);/,
  "weather/OTA acknowledgement must include the asynchronous esp-mqtt handshake/reconnect");
const mqttStart = mqtt.indexOf("void mqtt_ha_start()");
const startupNotQuiesced = mqtt.indexOf(
  "MqttStartupActivity startup_activity", mqttStart);
const configAtStart = mqtt.indexOf("const Config& c = config()", mqttStart);
const startupGuard = mqtt.indexOf("struct MqttStartupActivity");
const guardNotQuiesced = mqtt.indexOf(
  "s_publish_network_quiesced.store(false, std::memory_order_release)", startupGuard);
const guardOwnerRecheck = mqtt.indexOf("if (!competing_tls_active()) return", guardNotQuiesced);
const guardYield = mqtt.indexOf(
  "s_publish_network_quiesced.store(true, std::memory_order_release)", guardOwnerRecheck);
const startupRunning = mqtt.indexOf(
  "startup_activity.hand_off()", mqttStart);
assert.ok(startupGuard >= 0 && guardNotQuiesced > startupGuard &&
          guardOwnerRecheck > guardNotQuiesced && guardYield > guardOwnerRecheck &&
          mqttStart >= 0 && startupNotQuiesced > mqttStart && configAtStart > startupNotQuiesced &&
          startupRunning > configAtStart,
  "startup must claim/recheck/yield behind an existing TLS owner before allocation, then hand off");
assert.match(mqtt,
  /esp_mqtt_client_stop\(s_client\)[\s\S]{0,600}?s_transport_connecting\.store\(false,\s*std::memory_order_release\)[\s\S]{0,600}?esp_mqtt_client_destroy\(s_client\)/,
  "promotion must clear the transport claim explicitly because client_stop emits no disconnect event");
assert.match(weather, /s_status\.reason\s*=\s*"heap_headroom";/,
  "a refused fetch must state the heap-headroom reason");
const skipBranch = weather.indexOf('"heap_headroom"');
const skipWait = weather.indexOf("WEATHER_RETRY_INTERVAL_S * 1000u", skipBranch);
assert.ok(skipWait > skipBranch,
  "a refused fetch must use the bounded retry interval instead of aging a forecast for 45 minutes");

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
