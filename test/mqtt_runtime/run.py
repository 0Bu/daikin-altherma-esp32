#!/usr/bin/env python3
"""Compile the complete production MQTT TU with real cJSON and semantic mutations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1], help='repository root')
parser.add_argument('--real-cjson', type=Path, required=True,
                    help='lock-resolved managed_components/espressif__cjson/cJSON directory')
parser.add_argument('--ubsan', action='store_true', help='build with undefined-behavior sanitizer')
args = parser.parse_args()
ROOT = args.root.resolve()
CJSON = (ROOT / args.real_cjson).resolve()
expected_cjson = (ROOT / 'managed_components/espressif__cjson/cJSON').resolve()
assert CJSON == expected_cjson, 'real cJSON must be this repository\'s lock-resolved managed component'
lock_path = ROOT / 'dependencies.lock'
lock = lock_path.read_text()
assert re.search(r'^  espressif/cjson:\n(?:(?!^  \S).)*?^    version: 1\.7\.19~2$',
                 lock, re.MULTILINE | re.DOTALL), 'expected locked cJSON 1.7.19~2'
assert (CJSON / 'cJSON.c').is_file() and (CJSON / 'cJSON.h').is_file(), \
    'resolve the managed cJSON dependency before running this host witness'
OUT = Path(tempfile.mkdtemp(prefix='daikin-mqtt-runtime-'))
SAN_FLAGS = ['-fsanitize=undefined', '-fno-sanitize-recover=all'] if args.ubsan else []

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

commands = []
def execute(command, expected=0):
    commands.append(shlex.join(map(str, command)))
    result = subprocess.run(list(map(str, command)), cwd=ROOT, text=True,
                            capture_output=True, timeout=60)
    if expected is not None and result.returncode != expected:
        raise RuntimeError(f'{shlex.join(map(str, command))}\n{result.stdout}{result.stderr}')
    return result

source_path = ROOT / 'main/mqtt_ha.cpp'
source = source_path.read_text()
source_input_sha = digest(source_path)
frozen = OUT / 'current-mqtt_ha.cpp'
frozen.write_text(source)
assert digest(frozen) == source_input_sha, 'the snapshot must match the complete production TU'
execute([os.environ.get('CC', 'cc'), '-std=c99', *SAN_FLAGS, '-I'+str(CJSON), '-c',
         CJSON/'cJSON.c', '-o', OUT/'cjson.o'])

deps = set()
def compile(name, source_file):
    dep = OUT / (name+'.d')
    binary = OUT / name
    command = [os.environ.get('CXX', 'c++'), '-std=c++17', *SAN_FLAGS,
               '-Wall', '-Wextra', '-Werror', '-Wno-unused-function',
               '-ffunction-sections', '-fdata-sections', '-MMD', '-MF', dep,
               f'-DMQTT_PRODUCTION_SOURCE="{source_file}"',
               '-I'+str(HERE/'stubs'), '-I'+str(CJSON), '-I'+str(ROOT/'main'),
               HERE/'fixture.cpp', OUT/'cjson.o',
               '-Wl,-dead_strip' if platform.system() == 'Darwin' else '-Wl,--gc-sections',
               '-o', binary]
    execute(command)
    dep_text = dep.read_text().replace('\\\n', ' ')
    deps.update(Path(value) for value in shlex.split(dep_text.split(':', 1)[1]))
    return binary

scenarios = ['startup_failure_recovery', 'event_registration_failure',
             'ref_oom_recovery', 'circulation_oom_recovery', 'reconfigure_config_oom',
             'failure_episodes', 'real_json_consumers', 'circulation_probe_postsubscribe_oom',
             'circulation_saved_postsubscribe_oom', 'circulation_saved_epoch_change',
             'circulation_saved_retry', 'circulation_saved_replacement_failure',
             'circulation_saved_reconnect_oom',
             'reference_saved_postsubscribe_oom',
             'reference_saved_final_owner_oom', 'reference_saved_partial_retry',
             'reference_saved_prior_owner_cleanup', 'reference_saved_prior_owner_retry',
             'reference_saved_reconnect_oom',
             'reference_saved_replacement_partial_failure', 'circulation_unsubscribe_rejection',
             'circulation_replace_unsubscribe_rejection', 'reference_unsubscribe_rejection',
             'reference_replace_unsubscribe_rejection', 'probe_unsubscribe_rejection',
             'probe_disabled_unsubscribe_rejection', 'shared_subscription_owners',
             'probe_active_replacement', 'probe_active_replacement_retire_rejection',
             'probe_saved_config_without_owner', 'probe_active_shared_prior_owner',
             'sdk_event_stack_owner', 'outgoing_heartbeat', 'outgoing_weather',
             'outgoing_curve', 'scalar_snapshot_helpers', 'discovery_topic_roundtrip',
             'callback_fragments', 'callback_payload_bounds', 'callback_epoch_cutover',
             'callback_queue_full', 'callback_timestamp_order', 'probe_capture_generation',
             'probe_proof_expiry']
binary = compile('production-mqtt', frozen)
deps.update([source_path, CJSON/'cJSON.c', CJSON/'cJSON.h', lock_path, HERE/'run.py'])
inputs_before = {path: digest(path) for path in deps if path.is_file()}
results = {}
for scenario in scenarios:
    result = execute([binary, scenario])
    results[scenario] = result.stdout.strip()
    print(result.stdout.strip())

mutations = [
    ('initial-start-task-deletion', 'startup_failure_recovery',
     'transport_resume.wait_s = transport_resume.backoff_s;',
     'vTaskDelete(nullptr);', 'START_FAILURE_KEEPS_PUBLISH_TASK_ALIVE', 1),
    ('initial-start-no-backoff', 'startup_failure_recovery',
     'transport_resume.wait_s = transport_resume.backoff_s;',
     '', 'INITIAL_START_FAILURE_DELAYS_FIRST_RETRY', 1),
    ('event-registration-rejection-ignored', 'event_registration_failure',
     'on_mqtt, nullptr) != ESP_OK', 'on_mqtt, nullptr) == ESP_OK',
     'REGISTRATION_FAILURE_CANNOT_START_UNOBSERVED_CLIENT', 1),
    ('probe-predecessor-generation', 'probe_capture_generation',
     'frame.probe_generation != s_circulation_probe.generation ||', '',
     'PRETEST_QUEUED_FRAME_CANNOT_PROVE_SUCCESSOR_TEST', 1),
    ('probe-original-observation-expiry', 'probe_proof_expiry',
     's_circulation_probe.clock.current(now_unix_s, now_ms, candidate.max_age_s) &&',
     '(static_cast<void>(now_unix_s), static_cast<void>(now_ms), true) &&',
     'PROOF_EXPIRES_WITH_ORIGINAL_OBSERVATION', 1),
    ('probe-arrival-as-now', 'probe_proof_expiry',
     '''frame.received_ms, now_unix_s,
                               static_cast<uint64_t>(esp_timer_get_time() / 1000),''',
     '''frame.received_ms, (static_cast<void>(now_unix_s), frame.received_unix_s),
                               frame.received_ms,''',
     'QUEUE_DELAY_CANNOT_REFRESH_STALE_PROBE_EVIDENCE', 1),
    ('heartbeat-wrong-topic', 'outgoing_heartbeat',
     'mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);',
     'mqtt_publish(s_crash, js.c_str(), static_cast<int>(js.size()), 0, 0);',
     'HEARTBEAT_USES_OWN_TOPIC_AND_NONRETAINED_PUBLISH', 1),
    ('heartbeat-retained', 'outgoing_heartbeat',
     'mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);',
     'mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 1);',
     'HEARTBEAT_USES_OWN_TOPIC_AND_NONRETAINED_PUBLISH', 1),
    ('heartbeat-aggregate-heap-as-largest', 'outgoing_heartbeat',
     'f.max_alloc = heap_largest_internal_block();',
     'f.max_alloc = esp_get_free_heap_size();',
     'HEARTBEAT_LARGEST_INTERNAL_BLOCK_ON_WIRE', 1),
    ('weather-allocating-accepted-cache', 'outgoing_weather',
     's_last_weather_json.swap(js);', 's_last_weather_json = js;',
     'WEATHER_ACCEPTED_PAYLOAD_COMMITTED_TO_CACHE', 1),
    ('weather-rejected-sdk-cache-advance', 'outgoing_weather',
     '''    if (js != s_last_weather_json &&
        mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1))''',
     '''    if (js != s_last_weather_json &&
        (mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1), true))''',
     'WEATHER_REJECTED_SDK_PUBLISH_RETAINS_LAST_ACCEPTED_CACHE', 1),
    ('weather-unchanged-payload-repeat', 'outgoing_weather',
     '''    if (js != s_last_weather_json &&
        mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1))''',
     '''    if (mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1))''',
     'WEATHER_UNCHANGED_ACCEPTED_PAYLOAD_SUPPRESSES_REPEAT', 1),
    ('weather-unconfigured-runtime-publish', 'outgoing_weather',
     'weather_mqtt_action(config_enabled, status.configured);',
     'weather_mqtt_action(config_enabled, true);',
     'WEATHER_ENABLE_TRANSITION_SUPPRESSES_UNCONFIGURED_RUNTIME', 1),
    ('weather-disable-forgets-cleanup', 'outgoing_weather',
     'if (action != WeatherMqttAction::Publish)',
     'if (config_enabled && action != WeatherMqttAction::Publish)',
     'WEATHER_DISABLE_REQUESTS_CLEANUP_WITHOUT_SYNTHETIC_FORECAST_OR_CACHE_RESET', 1),
    ('curve-wrong-topic', 'outgoing_curve',
     'mqtt_publish(s_heating_curve_topic, js.c_str(), static_cast<int>(js.size()), 0, 0);',
     'mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);',
     'CURVE_TELEMETRY_USES_OWN_NONRETAINED_DOMAIN_TOPIC', 1),
    ('curve-room-temperature-discarded', 'outgoing_curve',
     'f.room_temperature_c = room.temperature_c;',
     'f.room_temperature_c = 0;',
     'CURVE_ACCEPTED_ROOM_TEMPERATURE_ON_WIRE', 1),
    ('curve-disabled-consent-published', 'outgoing_curve',
     'if (!cfg.diagnostics_enabled) return;',
     '/* mutation: publish even after diagnostic consent was withdrawn */',
     'CURVE_DISABLED_CONSENT_SUPPRESSES_PUBLICATION', 1),
    ('scalar-hp-age-discarded', 'scalar_snapshot_helpers',
     'return mqtt_publish_gate_step(state, hp.connected, hp.last_ok_s, s_connected.load());',
     'return mqtt_publish_gate_step(state, hp.connected, 0, s_connected.load());',
     'SCALAR_HP_GATE_PRESERVES_CONFIRMED_SOURCE_WITHDRAWAL', 1),
    ('scalar-crash-notability-discarded', 'scalar_snapshot_helpers',
     'crash_is_notable(current) != s_crash_notable_pub;', 'false;',
     'SCALAR_CRASH_HELPER_DETECTS_NEW_NOTABILITY', 1),
    ('sdk-data-sample-missing', 'sdk_event_stack_owner',
     'id == MQTT_EVENT_BEFORE_CONNECT || id == MQTT_EVENT_CONNECTED || id == MQTT_EVENT_DATA)',
     'id == MQTT_EVENT_BEFORE_CONNECT || id == MQTT_EVENT_CONNECTED)',
     'SDK_OWNER_EVENT_RECORDS_OWN_STACK', 1),
    ('sdk-error-caller-misfiled', 'sdk_event_stack_owner',
     'id == MQTT_EVENT_BEFORE_CONNECT || id == MQTT_EVENT_CONNECTED || id == MQTT_EVENT_DATA)',
     'id == MQTT_EVENT_BEFORE_CONNECT || id == MQTT_EVENT_CONNECTED || id == MQTT_EVENT_DATA || id == MQTT_EVENT_ERROR)',
     'CALLER_EVENT_DOES_NOT_MISFILE_SDK_STACK', 1),
    ('activity-release', 'ref_oom_recovery',
     '~MqttPublishActivity() {\n        s_publish_network_quiesced.store(true, std::memory_order_release);\n    }',
     '~MqttPublishActivity() {\n        /* mutation: leave allocation ownership claimed */\n    }',
     'MQTT_ACTIVITY_RELEASED_AT_DELAY', 1),
    ('snapshot-lock-unwind', 'ref_oom_recovery',
     '''    {
        Lock lk(s_mtx);
        if (!reference_request_current_locked(frame.reference_epoch, c)) return;
        candidate           = s_ref_status;
        candidate_watermark = s_ref_source_time;
    }''',
     '''    {
        xSemaphoreTake(s_mtx, portMAX_DELAY);
        if (!reference_request_current_locked(frame.reference_epoch, c)) return;
        candidate           = s_ref_status;
        candidate_watermark = s_ref_source_time;
        xSemaphoreGive(s_mtx);
    }''',
     'MQTT_MUTEX_RELEASED_AT_DELAY', 1),
    ('oom-counter', 'ref_oom_recovery',
     's_mqtt_skipped.fetch_add(1, std::memory_order_relaxed);',
     '/* mutation: omit skipped-cycle evidence */', 'OOM_COUNTED_ONCE', 2),
    ('reference-time-retention', 'ref_oom_recovery',
     'candidate           = s_ref_status;',
     's_ref_source_time.reset(); candidate           = s_ref_status;',
     'OOM_PRESERVES_REFERENCE_TIME_WATERMARK', 1),
    ('circulation-time-retention', 'circulation_oom_recovery',
     'candidate   = s_circulation_status;',
     's_circulation_source_time.reset(); candidate   = s_circulation_status;',
     'OOM_PRESERVES_CIRCULATION_TIME_WATERMARK', 1),
    ('failure-episode-rearm', 'failure_episodes',
     'failures.succeeded();', '/* mutation: never rearm a recovered failure episode */',
     'NEW_FAILURE_EPISODE_LOGS_AGAIN_AFTER_RECOVERY', 1),
    ('failure-episode-log-rate', 'failure_episodes',
     'if (failures.first_failure())', 'if (true)',
     'CONSECUTIVE_FAILURES_LOG_ONCE_PER_EPISODE', 2),
    ('circulation-probe-allocating-owner', 'circulation_probe_postsubscribe_oom',
     's_circulation_probe_subscribed_topic.swap(candidate.topic);',
     's_circulation_probe_subscribed_topic = candidate.topic;',
     'CIRCULATION_PROBE_SUBSCRIPTION_CLEANUP_OWNERSHIP', 1),
    ('circulation-saved-allocating-owner', 'circulation_saved_postsubscribe_oom',
     'if (id >= 0) s_circulation_subscribed_topic.swap(prepared_owner);',
     'if (id >= 0) s_circulation_subscribed_topic = prepared_owner;',
     'SAVED_CIRCULATION_SUBSCRIPTION_CLEANUP_OWNERSHIP', 1),
    ('circulation-epoch-before-owner', 'circulation_saved_epoch_change',
     '''    if (id >= 0) s_circulation_subscribed_topic.swap(prepared_owner);
    s_circulation_subscription_retry = id < 0;
    {
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;''',
     '''    s_circulation_subscription_retry = id < 0;
    {
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        if (id >= 0) s_circulation_subscribed_topic.swap(prepared_owner);''',
     'CIRCULATION_EPOCH_CHANGE_RETAINS_ACCEPTED_CLEANUP_OWNER', 1),
    ('reference-allocating-slot-owner', 'reference_saved_postsubscribe_oom',
     '''        const int id = esp_mqtt_client_subscribe(s_client, topic.c_str(), 0);
        if (id < 0) {''',
     '''        const int id = esp_mqtt_client_subscribe(s_client, topic.c_str(), 0);
        if (id >= 0) {
            std::string allocating_owner = topic;
            topic.swap(allocating_owner);
        }
        if (id < 0) {''',
     'SAVED_REFERENCE_ACCEPTED_TOPIC_CLEANUP_OWNERSHIP', 1),
    ('reference-allocating-final-owner-array', 'reference_saved_final_owner_oom',
     's_ref_subscribed_topics.swap(desired);',
     's_ref_subscribed_topics = desired;',
     'SAVED_REFERENCE_FINAL_OWNER_ARRAY_COMMITTED', 1),
    ('reference-drop-prior-owner-on-failure', 'reference_saved_prior_owner_cleanup',
     'if (!reference_topic_set_contains(s_ref_subscribed_topics, topic)) topic.clear();',
     'topic.clear();',
     'REFERENCE_FAILED_RESUBSCRIBE_RETAINS_STILL_LIVE_PRIOR_OWNER', 1),
    ('reference-keep-unaccepted-new-owner', 'reference_saved_partial_retry',
     'if (!reference_topic_set_contains(s_ref_subscribed_topics, topic)) topic.clear();',
     '/* mutation: keep owner even though its new SDK subscribe failed */',
     'REFERENCE_PARTIAL_BATCH_RETAINS_ONLY_ACCEPTED_NEW_OWNERS', 1),
    ('reference-owner-equality-bypasses-retry', 'reference_saved_prior_owner_retry',
     'if (!force && !s_ref_subscription_retry && s_ref_subscribed_topics == desired)',
     'if (!force && s_ref_subscribed_topics == desired)',
     'REFERENCE_PRIOR_OWNER_ARRAY_EQUALITY_DOES_NOT_BYPASS_RETRY', 1),
    ('reference-reconnect-oom-consumes-force', 'reference_saved_reconnect_oom',
     'if (force) s_ref_subscription_retry = true;',
     '/* mutation: lose the reconnect request before allocating preparation */',
     'REFERENCE_RECONNECT_OOM_NEXT_CYCLE_RESUBSCRIBES_ALL_TOPICS', 1),
    ('circulation-reconnect-oom-consumes-force', 'circulation_saved_reconnect_oom',
     '''    if (force) {
        // Keep the reconnect request through any later allocation failure. The prior cleanup
        // owner can still match even though a clean broker session needs a new SUBSCRIBE.
        s_circulation_subscription_retry = true;''',
     '''    if (force) {
        /* mutation: lose the reconnect request before allocating preparation */''',
     'CIRCULATION_RECONNECT_OOM_NEXT_CYCLE_RESUBSCRIBES_TOPIC', 1),
    ('circulation-owner-equality-bypasses-retry', 'circulation_saved_retry',
     '''    if (!force && !s_circulation_subscription_retry &&
        s_circulation_subscribed_topic == c.circulation_topic) return;''',
     '''    if (!force && s_circulation_subscribed_topic == c.circulation_topic) return;''',
     'CIRCULATION_PRIOR_OWNER_EQUALITY_DOES_NOT_BYPASS_RETRY', 1),
    ('circulation-drop-owner-on-rejected-unsubscribe', 'circulation_unsubscribe_rejection',
     'if (retired) s_circulation_subscribed_topic.clear();',
     's_circulation_subscribed_topic.clear();',
     'CIRCULATION_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER', 1),
    ('reference-drop-owner-on-rejected-unsubscribe', 'reference_unsubscribe_rejection',
     '''        if (unsubscribe_reference_topic_if_unused(topic, keep)) topic.clear();
        else retired = false;''',
     '''        const bool released = unsubscribe_reference_topic_if_unused(topic, keep);
        topic.clear();
        if (!released) retired = false;''',
     'REFERENCE_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER', 1),
    ('probe-drop-owner-on-rejected-unsubscribe', 'probe_unsubscribe_rejection',
     '''        if (retired) s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        return;''',
     '''        (void)retired;
        s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        return;''',
     'PROBE_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER', 1),
    ('disabled-probe-drop-owner-on-rejected-unsubscribe', 'probe_disabled_unsubscribe_rejection',
     '''        if (retired) s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        if (signal && s_circulation_probe_sem)''',
     '''        (void)retired;
        s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        if (signal && s_circulation_probe_sem)''',
     'PROBE_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER', 1),
    ('reference-drop-shared-circulation-protection', 'shared_subscription_owners',
     'topic == s_circulation_subscribed_topic || topic == s_circulation_probe_subscribed_topic)',
     'topic == s_circulation_probe_subscribed_topic)',
     'REFERENCE_RETIRE_PRESERVES_SHARED_CIRCULATION_OWNER', 1),
    ('circulation-drop-shared-probe-protection', 'shared_subscription_owners',
     '''            s_circulation_subscribed_topic == s_circulation_probe_subscribed_topic ||
            esp_mqtt_client_unsubscribe''',
     '''            esp_mqtt_client_unsubscribe''',
     'CIRCULATION_RETIRE_PRESERVES_SHARED_PROBE_OWNER', 1),
    ('probe-drop-active-prior-retirement', 'probe_active_replacement',
     '''    if (!s_circulation_probe_subscribed_topic.empty() &&
        s_circulation_probe_subscribed_topic != candidate.topic) {
        if (!reference_topic_owned(s_circulation_probe_subscribed_topic) &&
            s_circulation_probe_subscribed_topic != s_circulation_subscribed_topic &&
            esp_mqtt_client_unsubscribe(s_client,
                                        s_circulation_probe_subscribed_topic.c_str()) < 0) {
            Lock lk(s_mtx);
            if (s_circulation_probe.active && s_circulation_probe.generation == generation) {
                s_circulation_probe.subscribed = false;
                s_circulation_probe.error = "MQTT unsubscribe failed";
            }
            return;
        }
        s_circulation_probe_subscribed_topic.clear();
    }''',
     '/* mutation: replace a prior active probe owner without retiring it */',
     'PROBE_ACTIVE_REPLACEMENT_RETIRES_OLD_OWNER_BEFORE_NEW_SUBSCRIBE', 1),
    ('probe-ignore-active-retirement-rejection', 'probe_active_replacement_retire_rejection',
     '''            esp_mqtt_client_unsubscribe(s_client,
                                        s_circulation_probe_subscribed_topic.c_str()) < 0) {''',
     '''            (esp_mqtt_client_unsubscribe(s_client,
                                        s_circulation_probe_subscribed_topic.c_str()) < 0 && false)) {''',
     'PROBE_ACTIVE_REJECTED_RETIRE_RETAINS_OWNER_AND_DEFERS_NEW_EFFECT', 1),
    ('probe-saved-configuration-pretends-to-own', 'probe_saved_config_without_owner',
     '''    if (id >= 0 && candidate.topic != s_circulation_subscribed_topic &&
        !reference_topic_owned(candidate.topic))''',
     '''    if (id >= 0 && candidate.topic != saved.circulation_topic &&
        !reference_topic_owned(candidate.topic))''',
     'PROBE_ACCEPTED_SAVED_CONFIG_TOPIC_RETAINS_OWN_CLEANUP_IDENTITY', 1),
    ('probe-inactive-configuration-pretends-to-own', 'probe_saved_config_without_owner',
     '''        const bool retired = s_circulation_probe_subscribed_topic.empty() ||
            s_circulation_probe_subscribed_topic == s_circulation_subscribed_topic ||
            reference_topic_owned(s_circulation_probe_subscribed_topic) ||''',
     '''        const bool retired = s_circulation_probe_subscribed_topic.empty() ||
            s_circulation_probe_subscribed_topic == saved.circulation_topic ||
            reference_topic_owned(s_circulation_probe_subscribed_topic) ||''',
     'PROBE_CONFIGURED_BUT_UNOWNED_SAVED_TOPIC_IS_CLEANED_EXACTLY_ONCE', 1),
    ('probe-active-drop-shared-prior-owner-protection', 'probe_active_shared_prior_owner',
     '''        if (!reference_topic_owned(s_circulation_probe_subscribed_topic) &&
            s_circulation_probe_subscribed_topic != s_circulation_subscribed_topic &&''',
     '''        if (s_circulation_probe_subscribed_topic != s_circulation_subscribed_topic &&''',
     'PROBE_ACTIVE_REPLACEMENT_PRESERVES_OTHER_ACTUAL_PRIOR_OWNER', 1),
]
mutation_results = {}
for name, scenario, before, after, assertion, count in mutations:
    # Source formatting may change whitespace; semantic anchors must remain unique.
    # Keep the surrounding newline: consuming it can place a replacement inside a preceding
    # production // comment instead of changing the executable semantic anchor.
    pattern = re.compile(r'\s+'.join(re.escape(part) for part in re.split(r'\s+', before.strip())))
    assert len(pattern.findall(source)) == count, f'{name}: exact source anchor count required'
    mutated = OUT / (name+'.cpp')
    mutated.write_text(pattern.sub(lambda match: after, source))
    mutant = compile('mutation-'+name, mutated)
    result = execute([mutant, scenario], expected=None)
    output = result.stdout + result.stderr
    assert result.returncode == 2 and f'ASSERTION {assertion} FAILED' in output, \
        f'{name}: rejected by wrong boundary: {result.returncode}\n{output}'
    mutation_results[name] = {'scenario': scenario, 'assertion': assertion,
                              'returncode': result.returncode, 'output': output.strip()}
    print(f'REJECTED {name}: {assertion}')

deps.update([CJSON/'cJSON.c', CJSON/'cJSON.h', lock_path, HERE/'run.py'])
inputs = {str(path): digest(path) for path in sorted(deps) if path.is_file()}
assert all(path.is_file() and digest(path) == value for path, value in inputs_before.items()), \
    'production compile inputs changed during the witness'
# A read-only container mount may lack a worktree's external .git directory. The source/input
# hashes remain authoritative; represent unavailable Git metadata explicitly instead of inventing it.
git_head = execute(['git', 'rev-parse', 'HEAD'], expected=None)
git_status = execute(['git', '-c', 'core.fsmonitor=false', 'status', '--short'], expected=None)
manifest = {
    'root': str(ROOT), 'head': git_head.stdout.strip() if git_head.returncode == 0 else None,
    'source_input': str(source_path), 'source_input_sha256': source_input_sha,
    'source_snapshot': str(frozen), 'ubsan': args.ubsan,
    'worktree_status': git_status.stdout if git_status.returncode == 0 else None,
    'git_metadata_available': git_head.returncode == 0 and git_status.returncode == 0,
    'compiler': execute([os.environ.get('CXX', 'c++'), '--version']).stdout.strip(),
    'scenarios': results, 'mutations': mutation_results, 'inputs_sha256': inputs,
    'commands': commands,
}
(OUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
(OUT/'commands.sh').write_text('# Run from '+str(ROOT)+'\n'+'\n'.join(commands)+'\n')
print('MANIFEST '+str(OUT/'manifest.json'))
