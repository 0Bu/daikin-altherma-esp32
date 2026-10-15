#!/usr/bin/env python3
"""Compile/run full production poll source and targeted mutations in this temp directory."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
CASES = [
    'oom_raii', 'detect_adjacent', 'detect_silent', 'detect_no_match', 'detect_changed',
    'detect_generation', 'detect_throw', 'detect_no_match_silent', 'detect_staging_oom',
    'detect_model_arguments',
    'saturation_recent', 'saturation_quiesce', 'saturation_oom',
    'saturation_uart', 'saturation_long_gap', 'saturation_unavailable', 'saturation_cold',
    'saturation_age_recent', 'saturation_age_expired', 'saturation_invalid_pressure',
    'saturation_wire_gap', 'saturation_commit_gap',
    'probe_no_task', 'probe_busy', 'probe_drain', 'probe_deadline', 'probe_late', 'probe_wrap',
    'raw_recovery', 'raw_empty', 'raw_stopped_recovery', 'raw_one_page', 'raw_budget',
    'mqtt_scalar_source', 'refrigerant_one_sensor', 'refrigerant_unidentified_row',
]
REGRESSION_ORACLES = {
    'detect_silent': 'detect_silence_breaks_confirmation',
    'detect_throw': 'detect_thrown_sweep_breaks_confirmation',
    'detect_no_match_silent': 'detect_silence_breaks_no_match_confirmation',
    'detect_staging_oom': 'detect_post_return_staging_oom_breaks_confirmation',
    'detect_model_arguments': 'detect_model_commit_moves_staged_arguments',
    'saturation_quiesce': 'saturation_quiescence_invalidates_old_witness',
    'saturation_oom': 'saturation_oom_invalidates_old_witness',
    'saturation_uart': 'saturation_uart_failure_invalidates_old_witness',
    'saturation_long_gap': 'saturation_long_gap_expires_old_witness',
    'saturation_age_expired': 'saturation_at_cache_age_boundary_expires_witness',
    'saturation_wire_gap': 'saturation_expires_during_current_wire_wait',
    'saturation_commit_gap': 'saturation_age_uses_pressure_time_not_commit_time',
    'probe_wrap': 'probe_wrap_b_rejects_duplicate_a_ticket',
    'raw_recovery': 'raw_absent_pages_do_not_consume_round',
    'raw_empty': 'raw_empty_payloads_do_not_consume_round',
    'refrigerant_one_sensor': 'refrigerant_lost_page_never_substitutes_other_sensor',
    'refrigerant_unidentified_row': 'refrigerant_unidentified_row_never_high_side',
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1], help='Repository root; defaults to installed test directory parent')
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none', help='Optional UBSan instrumentation')
parser.add_argument('--case', action='append', choices=CASES, help='Run only named cases (may repeat)')
parser.add_argument('--no-mutations', action='store_true', help='Run cases only, for archived-source comparisons')
parser.add_argument('--expect-failures', nargs='+', choices=list(REGRESSION_ORACLES), default=[],
                    help='Archived source must fail these cases at their named regression oracle')
args = parser.parse_args()
if args.expect_failures and not args.no_mutations:
    parser.error('--expect-failures requires --no-mutations; normal gate runs require all cases green')
if args.case and set(args.expect_failures) - set(args.case):
    parser.error('All --expect-failures cases must also be selected by --case')
REPO = args.root.resolve()
if not (REPO / 'main/hp_poll.cpp').is_file():
    parser.error('--root must name the daikin-altherma-esp32 repository')
SOURCE = REPO / 'main/hp_poll.cpp'
FORMAT = REPO / 'main/hp_convert.cpp'
OUT = Path(tempfile.mkdtemp(prefix='daikin-poll-runtime-'))
COMPILER = os.environ.get('CXX', 'c++')
SANITIZERS = 'undefined' if args.sanitizer == 'undefined' else ''
SAN_FLAGS = ['-fsanitize=' + SANITIZERS, '-fno-sanitize-recover=all'] if SANITIZERS else []
FLAGS = ['-std=c++20', '-O0', '-g', '-pthread', *SAN_FLAGS, '-fno-omit-frame-pointer',
         '-I', str(HERE / 'stubs'), '-I', str(REPO / 'main')]
commands = []
def dependency_inputs(deps):
    inputs = {Path(__file__).resolve(), HERE / 'fixture.cpp', SOURCE, FORMAT}
    for dep in deps:
        contents = dep.read_text().replace('\\\n', ' ')
        for name in shlex.split(contents.partition(':')[2]):
            path = Path(name)
            inputs.add(path.resolve() if path.is_absolute() else (HERE / path).resolve())
    inputs.update((HERE / 'stubs').rglob('*.hpp'))
    inputs.update((HERE / 'stubs').rglob('*.h'))
    return inputs
def hashes(inputs):
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(inputs)}
def command(args):
    commands.append(shlex.join(args))
    result = subprocess.run(args, cwd=HERE, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(shlex.join(args) + '\n' + result.stdout + result.stderr)
    return result

def build(source, tag):
    obj = OUT / (tag + '.o')
    dep = OUT / (tag + '.d')
    command([COMPILER, *FLAGS, '-MMD', '-MF', str(dep),
             '-DPOLL_PRODUCTION_SOURCE="' + str(source) + '"',
             '-c', str(HERE / 'fixture.cpp'), '-o', str(obj)])
    binary = OUT / tag
    command([COMPILER, '-pthread', *SAN_FLAGS, str(obj), str(OUT / 'format.o'), '-o', str(binary)])
    return binary

version = command([COMPILER, '--version']).stdout
command([COMPILER, *FLAGS, '-MM', '-MF', str(OUT / 'preflight-poll.d'),
         '-DPOLL_PRODUCTION_SOURCE="' + str(SOURCE) + '"', str(HERE / 'fixture.cpp')])
command([COMPILER, *FLAGS, '-MM', '-MF', str(OUT / 'preflight-format.d'), str(FORMAT)])
inputs_before = hashes(dependency_inputs([OUT / 'preflight-poll.d', OUT / 'preflight-format.d']))
command([COMPILER, *FLAGS, '-MMD', '-MF', str(OUT / 'format.d'),
         '-c', str(FORMAT), '-o', str(OUT / 'format.o')])
binary = build(SOURCE, 'baseline')
case_results = []
selected_cases = args.case or CASES
for case in selected_cases:
    case_args = [str(binary), case]
    commands.append(shlex.join(case_args))
    result = subprocess.run(case_args, cwd=HERE, capture_output=True, text=True, timeout=15)
    output = result.stdout + result.stderr
    expected = REGRESSION_ORACLES.get(case) if case in args.expect_failures else None
    if expected:
        if result.returncode == 0 or 'FAIL oracle=' + expected not in output:
            raise RuntimeError('Archived source did not fail expected oracle: ' + case + '\n' + output)
    elif result.returncode:
        raise RuntimeError('Runtime case failed: ' + case + '\n' + output)
    case_results.append({'case': case, 'exit_code': result.returncode, 'output': output,
                         'expected_failure_oracle': expected})
    print(('EXPECTED REGRESSION ' + case + ': ' if expected else '') + output, end='')
source_text = SOURCE.read_text()
mutations = {
    'allocate_mqtt_scalar_snapshot': (
        'const bool recent = x10a_cache_recent_locked();\n    return {s_stats.connected && recent, recent};',
        'const HpStats copied = hp_stats();\n    const bool recent = x10a_source_is_recent(copied.last_ok_s);\n    return {copied.connected, recent};',
        'mqtt_scalar_sampler_allocation_free', 'mqtt_scalar_source'),
    'tie_mqtt_grace_to_current_sweep': (
        'const bool recent = x10a_cache_recent_locked();\n    return {s_stats.connected && recent, recent};',
        'const bool recent = s_stats.connected && x10a_cache_recent_locked();\n    return {s_stats.connected && recent, recent};',
        'mqtt_scalar_empty_sweep_keeps_grace', 'mqtt_scalar_source'),
    'extend_mqtt_scalar_expiry': (
        'const bool recent = x10a_cache_recent_locked();\n    return {s_stats.connected && recent, recent};',
        'const bool recent = x10a_source_time_is_recent(esp_timer_get_time() - 1, s_last_ok_us);\n    return {s_stats.connected && recent, recent};',
        'mqtt_scalar_source_exact_expiry', 'mqtt_scalar_source'),
    'clear_last_good_cache': (
        's_cycles_skipped.fetch_add(1, std::memory_order_relaxed);',
        's_cycles_skipped.fetch_add(1, std::memory_order_relaxed); s_cache.clear();',
        'last_good_cache_preserved', 'oom_raii'),
    'double_fixed_poll_delay': (
        'vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));     // fixed 1 s cadence',
        'vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 2000));     // mutated fixed cadence',
        'normal_poll_delay', 'oom_raii'),
    'retain_quiescence_ack': (
        's_network_quiesced.store(false, std::memory_order_release);',
        's_network_quiesced.store(true, std::memory_order_release);',
        'oom_does_not_claim_quiescence', 'oom_raii'),
    'raw_stats_lock': (
        'Lock lk(s_mtx);\n    st = s_stats;',
        'xSemaphoreTake(s_mtx, portMAX_DELAY);\n    st = s_stats;\n    xSemaphoreGive(s_mtx);',
        'reader_oom_releases_production_semguard', 'oom_raii'),
    'repeat_oom_episode_log': (
        'if (failures.first_failure()) diag_printf("poll: cycle skipped (%s)\\n", e.what());',
        'diag_printf("poll: cycle skipped (%s)\\n", e.what());',
        'consecutive_oom_episode_logs_once', 'oom_raii'),
    'never_rearm_episode_log': (
        'failures.succeeded();',
        '/* mutation: success does not rearm diagnostic episode */',
        'new_oom_episode_logs_after_recovery', 'oom_raii'),
    'commit_first_incomplete': (
        'if (!confirmed) {',
        'if (false) {',
        'detect_first_incomplete_no_side_effects', 'detect_adjacent'),
    'confirm_changed_representative': (
        'detect_incomplete_step(s_incomplete_profile, s_incomplete_detect, d.best)',
        '(++s_incomplete_detect >= DETECT_INCOMPLETE_CONFIRMATIONS)',
        'detect_changed_representative_restarts_confirmation', 'detect_changed'),
    'retain_tally_on_no_match': (
        'if (d.best.empty()) {\n            s_incomplete_detect = 0;\n            s_incomplete_profile.clear();',
        'if (d.best.empty()) { /* mutation: no-match retains old incomplete evidence */',
        'detect_no_match_breaks_confirmation', 'detect_no_match'),
    'ignore_detect_generation_barrier': (
        'if (s_target_generation.load(std::memory_order_acquire) != cycle_generation) return true;',
        '/* mutation: stale generation can commit */',
        'detect_generation_discards_inflight_sweep', 'detect_generation'),
    'discard_recent_hot_witness': (
        'hp_format(def, payload, paylen, rtype, val, prof.values, prof.count, sat_in)',
        'hp_format(def, payload, paylen, rtype, val, prof.values, prof.count, SaturationWitness{})',
        'saturation_recent_hot_witness_suppresses_zero', 'saturation_recent'),
    'retain_missing_saturation_witness': (
        ['s_sat_witness = sat_out;', 's_sat_witness_us = sat_out_us;'],
        ['if (sat_out.ok) s_sat_witness = sat_out;',
         'if (sat_out.ok) s_sat_witness_us = sat_out_us;'],
        'saturation_missing_witness_recovers_zero', 'saturation_unavailable'),
    'wait_for_probe_without_poll_task': (
        'if (!s_poll_task_running.load(std::memory_order_acquire)) {',
        'if (false) {',
        'probe_no_task_immediate_no_link', 'probe_no_task'),
    'ignore_probe_submit_gate': (
        'if (xSemaphoreTake(s_probe_gate, 0) != pdTRUE) { out.status = ProbeStatus::Busy; return false; }',
        '/* mutation: concurrent callers can enter */',
        'probe_concurrent_submitter_immediate_busy', 'probe_busy'),
    'accept_any_probe_completion': (
        'if (woken && probe_reply_matches(s_probe_reply_ticket.load(std::memory_order_acquire),\n                                         ticket)) break;',
        'if (woken) break;',
        'probe_b_rejects_late_a_and_gets_own_reply', 'probe_late'),
    'withdraw_foreign_probe_request': (
        's_probe_pending.compare_exchange_strong(served, 0, std::memory_order_acq_rel,\n                                            std::memory_order_relaxed);',
        's_probe_pending.store(0, std::memory_order_release);',
        'probe_late_a_cannot_withdraw_b', 'probe_late'),
    'skip_old_probe_wake_drain': (
        'while (xSemaphoreTake(s_probe_done, 0) == pdTRUE) { }',
        '/* mutation: leave old completion queued */',
        'probe_old_completion_drained_before_request', 'probe_drain'),
    'restart_probe_timeout_after_foreign_wake': (
        'deadline_us - esp_timer_get_time()',
        'static_cast<int64_t>(timeout_ms) * 1000',
        'probe_foreign_wakes_do_not_restart_deadline', 'probe_deadline'),
    'truncate_raw_dump_to_16_bytes': (
        'const int capped = pg.len < 32 ? pg.len : 32;',
        'const int capped = pg.len < 16 ? pg.len : 16;',
        'raw_one_valid_page_counts_once_and_caps_32_bytes', 'raw_one_page'),
    'refill_raw_capture_budget_each_poll': (
        'logic::raw_capture_due(s_raw_capture, rps_running, esp_timer_get_time(), raw10_len > 0 || raw20_len > 0)',
        '([&] { s_raw_capture.emitted = 0; return logic::raw_capture_due(s_raw_capture, rps_running, esp_timer_get_time(), raw10_len > 0 || raw20_len > 0); }())',
        'raw_at_most_eight_successful_rounds', 'raw_budget'),
    'retain_confirmation_after_silent_bus': (
        'reset_detect_confirmation();\n                    s_stats.connected = false;',
        '/* mutation: silent bus retains previous confirmation */\n                    s_stats.connected = false;',
        'detect_silence_breaks_confirmation', 'detect_silent'),
    'retain_confirmation_after_thrown_sweep': (
        'if (s_target_generation.load(std::memory_order_acquire) == cycle_generation)\n            reset_detect_confirmation();\n        throw;',
        '/* mutation: thrown sweep retains previous confirmation */\n        throw;',
        'detect_thrown_sweep_breaks_confirmation', 'detect_throw'),
    'retain_saturation_after_uart_init_failure': (
        'if (!hp_uart_init(c.rx_pin, c.tx_pin)) {\n        retire_saturation_witness();',
        'if (!hp_uart_init(c.rx_pin, c.tx_pin)) { /* mutation: keep prior witness */',
        'saturation_uart_failure_invalidates_old_witness', 'saturation_uart'),
    'retain_saturation_during_quiescence': (
        'if (ota_quiesce_step(network_quiesce, network_active)) {\n            retire_saturation_witness();',
        'if (ota_quiesce_step(network_quiesce, network_active)) { /* mutation: keep prior witness */',
        'saturation_quiescence_invalidates_old_witness', 'saturation_quiesce'),
    'retain_saturation_after_reserve_oom': (
        '} catch (const std::exception& e) {\n            retire_saturation_witness();',
        '} catch (const std::exception& e) { /* mutation: keep prior witness */',
        'saturation_oom_invalidates_old_witness', 'saturation_oom'),
    'ignore_saturation_observation_age': (
        'if (!x10a_source_time_is_recent(esp_timer_get_time(), s_sat_witness_us))',
        'if (false)',
        'saturation_at_cache_age_boundary_expires_witness', 'saturation_age_expired'),
    'check_saturation_age_before_wire_wait': (
        ['SaturationWitness sat_in =',
         'if (!x10a_source_time_is_recent(esp_timer_get_time(), s_sat_witness_us))'],
        ['const bool sat_recent_before_wire = x10a_source_time_is_recent(esp_timer_get_time(), s_sat_witness_us); SaturationWitness sat_in =',
         'if (!sat_recent_before_wire)'],
        'saturation_expires_during_current_wire_wait', 'saturation_wire_gap'),
    'stamp_saturation_with_cache_commit_time': (
        's_sat_witness_us = sat_out_us;',
        's_sat_witness_us = esp_timer_get_time();',
        'saturation_age_uses_pressure_time_not_commit_time', 'saturation_commit_gap'),
    'issue_duplicate_ticket_at_masked_zero': (
        '} while (!probe_ticket_usable(raw_ticket));',
        '} while (false);',
        'probe_wrap_b_rejects_duplicate_a_ticket', 'probe_wrap'),
    'spend_raw_budget_without_page_bytes': (
        'raw10_len > 0 || raw20_len > 0',
        'true',
        'raw_absent_pages_do_not_consume_round', 'raw_recovery'),
    'count_empty_raw_payload_as_available': (
        'raw10_len > 0 || raw20_len > 0',
        'raw10_len >= 0 || raw20_len >= 0',
        'raw_empty_payloads_do_not_consume_round', 'raw_empty'),
    'narrow_detection_catch_to_transport': (
        ['} catch (...) {\n        // An attempted sweep that could not finish is not an agreeing confirmation. Preserve\n        // the generation barrier even on OOM; rethrow to the task\'s established failure boundary.\n        Lock lk(s_mtx);\n        if (s_target_generation.load(std::memory_order_acquire) == cycle_generation)\n            reset_detect_confirmation();\n        throw;\n    }',
         '// Commit ONLY the fields detection owns',
         'try {\n        DetectResult d = hp_detect_run();'],
        ['/* mutation: catch moved before profile staging */',
         '} catch (...) { Lock lk(s_mtx); if (s_target_generation.load(std::memory_order_acquire) == cycle_generation) reset_detect_confirmation(); throw; }\n// Commit ONLY the fields detection owns',
         'DetectResult d;\n    try {\n        d = hp_detect_run();'],
        'detect_post_return_staging_oom_breaks_confirmation', 'detect_staging_oom'),
    'fall_back_to_other_high_pressure_sensor': (
        'const auto high = logic::refrigerant_service_high_pressure_row(coverage);\n    s.high_pressure_ok =\n        high.available &&\n        refrigerant_service_reading(values, count, high.reg, high.off, 105, s.high_pressure_tenths);',
        's.high_pressure_ok = refrigerant_service_reading(values, count, 0x62, 15, 105, s.high_pressure_tenths) ||\n                         refrigerant_service_reading(values, count, 0x20, 12, 105, s.high_pressure_tenths);',
        'refrigerant_lost_page_never_substitutes_other_sensor', 'refrigerant_one_sensor'),
    'read_outdoor_high_pressure_without_coverage': (
        'const auto high = logic::refrigerant_service_high_pressure_row(coverage);\n    s.high_pressure_ok =\n        high.available &&\n        refrigerant_service_reading(values, count, high.reg, high.off, 105, s.high_pressure_tenths);',
        's.high_pressure_ok = refrigerant_service_reading(values, count, 0x20, 12, 105, s.high_pressure_tenths);',
        'refrigerant_unidentified_row_never_high_side', 'refrigerant_unidentified_row'),
    'copy_model_arguments_after_link_commit': (
        'link_revision, std::move(detected_profile), d.page_mask, d.kw_tenths, d.iu_kw_tenths, std::move(d.eeprom)',
        'link_revision, detected_profile, d.page_mask, d.kw_tenths, d.iu_kw_tenths, d.eeprom',
        'detect_model_commit_moves_staged_arguments', 'detect_model_arguments'),
}
MUTANT_POSITIVE_CASES = {'narrow_detection_catch_to_transport': ['detect_throw']}
results = []
for tag, (old, new, oracle, case) in (mutations.items() if not args.no_mutations else []):
    if case not in selected_cases:
        continue
    mutant_text = source_text
    replacements = zip(old, new) if isinstance(old, list) else [(old, new)]
    for old_part, new_part in replacements:
        anchor = re.search(r'\s*'.join(re.escape(part) for part in re.split(r'\s+', old_part.strip())), mutant_text)
        if not anchor:
            raise RuntimeError('Mutation anchor missing: ' + tag)
        mutant_text = mutant_text[:anchor.start()] + new_part + mutant_text[anchor.end():]
    mutant = OUT / (tag + '.cpp')
    mutant.write_text(mutant_text)
    binary = build(mutant, tag)
    mutation_args = [str(binary), case]
    commands.append(shlex.join(mutation_args))
    result = subprocess.run(mutation_args, cwd=HERE, capture_output=True, text=True, timeout=15)
    output = result.stdout + result.stderr
    if result.returncode == 0 or 'FAIL oracle=' + oracle not in output:
        raise RuntimeError('Negative control did not fail expected oracle: ' + tag + '\n' + output)
    positive_controls = []
    for positive_case in MUTANT_POSITIVE_CASES.get(tag, []):
        positive = command([str(binary), positive_case])
        positive_controls.append({'case': positive_case, 'output': positive.stdout})
        print('MUTANT POSITIVE CONTROL ' + tag + ': ' + positive.stdout.strip())
    results.append({'mutation': tag, 'expected_oracle': oracle, 'exit_code': result.returncode,
                    'output': output, 'positive_controls': positive_controls,
                    'sha256': hashlib.sha256(mutant.read_bytes()).hexdigest()})
    print('NEGATIVE CONTROL ' + tag + ': ' + output.strip())

manifest = hashes(dependency_inputs([OUT / 'baseline.d', OUT / 'format.d']))
if manifest != inputs_before:
    changed = [path for path in set(manifest) | set(inputs_before) if manifest.get(path) != inputs_before.get(path)]
    raise RuntimeError('Compile inputs changed during run: ' + repr(changed))
git_head = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5)
record = {'compiler': version.strip(), 'sanitizers': SANITIZERS, 'commands': commands, 'cases': case_results,
          'negative_controls': results, 'input_sha256': manifest,
          'production_head': git_head.stdout.strip() if git_head.returncode == 0 else None,
          'claim_limits': ['Host adapters replace RTOS scheduling, mutex implementation, UART transport, config store, diag ring, history/checkup/dwell stores, heap/watchdog samplers and OTA/weather request flags.',
                           'Real complete hp_poll.cpp task, detection commit, probe submit/service and poll/readers, hp_convert.cpp, production profile tables and logic/RAII headers execute.',
                           'A joined host thread pauses the actual old probe service at its UART adapter; deterministic semaphore callbacks model timeout, a later submitter and late completion. This is not RTOS timing or a complete concurrency proof.',
                           'No ESP32 heap/stack timing, physical source truth, NVS persistence, live HTTP or board behavior is proven.']}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + path + '\n' for path, sha in manifest.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print('RECORDED ' + str(len(manifest)) + ' exact compile inputs in ' + str(OUT / 'evidence.json'))

print('OUTPUT ' + str(OUT))
