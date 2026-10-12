#!/usr/bin/env python3
"""Run the complete production X10A detection TU, old-head controls and compiled mutants."""
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
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1])
parser.add_argument('--baseline', action='store_true', help='Assert the documented pre-fix failures')
parser.add_argument('--no-mutations', action='store_true', help='Positive cases only')
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none')
args = parser.parse_args()
ROOT = args.root.resolve()
SOURCE = ROOT / 'main/hp_detect.cpp'
if not SOURCE.is_file():
    parser.error('--root must name a complete daikin-altherma-esp32 source tree')
OUT = Path(tempfile.mkdtemp(prefix='daikin-detect-runtime-'))
CXX = os.environ.get('CXX', 'c++')
SAN = ['-fsanitize=undefined'] if args.sanitizer == 'undefined' else []
FLAGS = ['-std=c++17', '-O0', '-g', '-Wall', '-Wextra', '-Werror', *SAN,
         '-fno-omit-frame-pointer', '-I', str(HERE / 'stubs'), '-I', str(ROOT / 'main')]
commands = []


def run(command, require_success=True):
    commands.append(shlex.join(command))
    result = subprocess.run(command, cwd=HERE, capture_output=True, text=True, timeout=60)
    if require_success and result.returncode:
        raise RuntimeError(shlex.join(command) + '\n' + result.stdout + result.stderr)
    return result


def build(source, name):
    binary = OUT / name
    run([CXX, *FLAGS, '-MMD', '-MF', str(OUT / (name + '.d')),
         '-DDETECT_PRODUCTION_SOURCE="' + str(source) + '"', str(HERE / 'fixture.cpp'),
         '-o', str(binary)])
    return binary


def dependencies(dep):
    paths = {Path(__file__).resolve(), HERE / 'fixture.cpp', SOURCE}
    for name in shlex.split(dep.read_text().replace('\\\n', ' ').partition(':')[2]):
        path = Path(name)
        paths.add(path.resolve() if path.is_absolute() else (HERE / path).resolve())
    return paths


def hashes(paths):
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


CASES = [
    'candidate_dedup', 'cached_protocol_order', 'cache_first_winner', 'swapped_winner',
    'default_winner', 'led_reservation',
    'ethernet_reservation', 'env_reservation', 'chip_reserved', 'octal_reserved',
    'invalid_candidates', 'init_failure', 'remap_failure', 'exclusive_driver_error',
    'driver_error_then_winner', 'init_failure_then_winner',
    'reinit_failure', 'recovered_page', 'recovered_crc', 'third_attempt_recovers',
    'page_silence_absent', 'error_then_silence',
    'driver_then_silence', 'nak_no_retry', 'nak_after_error', 'eeprom_display_only',
    'eeprom_error_optional', 'long_payload_bounded', 'short_eeprom_absent',
    'protocol_s', 'protocol_s56_optional',
    'short_capacity_fallback', 'outdoor_precedence', 'unknown_capacity',
    'uncorroborated_capacity',
]
OLD_FAILURES = {
    'led_reservation': 'reserved_default_never_uart_touched',
    'ethernet_reservation': 'ethernet_pairs_never_uart_touched',
    'env_reservation': 'env_reserved_default_never_uart_touched',
    'chip_reserved': 'chip_reserved_cache_never_uart_touched',
    'octal_reserved': 'octal_cache_never_uart_touched',
    'invalid_candidates': 'no_safe_pair_no_uart_query',
    'init_failure': 'init_failure_not_wiring_diagnosis',
    'remap_failure': 'remap_failure_retains_local_failure',
    'exclusive_driver_error': 'driver_error_not_wiring_diagnosis',
    'reinit_failure': 'winning_reinit_retains_local_failure',
}

compiler = run([CXX, '--version']).stdout.strip()
run([CXX, *FLAGS, '-MM', '-MF', str(OUT / 'preflight.d'),
     '-DDETECT_PRODUCTION_SOURCE="' + str(SOURCE) + '"', str(HERE / 'fixture.cpp')])
before = hashes(dependencies(OUT / 'preflight.d'))
binary = build(SOURCE, 'production')
case_results = []
for case in CASES:
    result = run([str(binary), case], require_success=False)
    output = result.stdout + result.stderr
    expected = OLD_FAILURES.get(case) if args.baseline else None
    if expected:
        if result.returncode != 1 or f'FAIL {case}: oracle={expected}' not in output:
            raise RuntimeError('Old-head control not rejected as expected: ' + case + '\n' + output)
        print('BASELINE REJECTED ' + case + ': ' + expected)
    elif result.returncode != 0 or 'PASS total=1' not in output:
        raise RuntimeError('Production case failed: ' + case + '\n' + output)
    else:
        print('PASS ' + case)
    case_results.append({'case': case, 'expected_failure': expected,
                         'exit_code': result.returncode, 'output': output})

text = SOURCE.read_text()
mutations = [
    ('ignore_runtime_reservations', 'config_reserved_pins(c).plus(net_eth_reserved_pins())',
     'ReservedPins{}.plus(net_eth_reserved_pins())',
     'led_reservation', 'reserved_default_never_uart_touched'),
    ('ignore_ethernet_reservations', 'config_reserved_pins(c).plus(net_eth_reserved_pins())',
     'config_reserved_pins(c).plus(ReservedPins{})',
     'ethernet_reservation', 'ethernet_pairs_never_uart_touched'),
    ('ignore_chip_pin_policy', 'if (!link_pins_safe(rx, tx, octal_spi, reserved)) return;',
     'if ((static_cast<void>(octal_spi), static_cast<void>(reserved), !link_pins_valid(rx, tx))) return;',
     'chip_reserved', 'chip_reserved_cache_never_uart_touched'),
    ('swapped_candidate_before_cache', 'add(c.rx_pin, c.tx_pin);\n    add(c.tx_pin, c.rx_pin);',
     'add(c.tx_pin, c.rx_pin);\n    add(c.rx_pin, c.tx_pin);',
     'cached_protocol_order', 'cache_swap_defaults_order'),
    ('forget_protocol_driver_error', 'if (kind == HpReplyKind::DriverError) local_failure = true;',
     'if (kind == HpReplyKind::DriverError) local_failure = false;',
     'exclusive_driver_error', 'driver_error_not_wiring_diagnosis'),
    ('forget_init_local_failure',
     'if (!hp_uart_init(cand[i].rx, cand[i].tx)) {\n            r.local_failure = true;',
     'if (!hp_uart_init(cand[i].rx, cand[i].tx)) {\n            r.local_failure = false;',
     'init_failure', 'init_failure_not_wiring_diagnosis'),
    ('forget_no_safe_config_failure', 'if (nc == 0) {\n            r.local_failure = true;',
     'if (nc == 0) {\n            r.local_failure = false;',
     'invalid_candidates', 'no_safe_candidates_is_local_config_failure'),
    ('forget_winning_reinit_failure', 'r.bus_ok = false;\n        r.local_failure = true;',
     'r.bus_ok = false;\n        r.local_failure = false;',
     'reinit_failure', 'winning_reinit_retains_local_failure'),
    ('misdiagnose_local_as_wiring', 'else if (r.local_failure) {',
     'else if ((static_cast<void>(r.local_failure), false)) {',
     'exclusive_driver_error', 'driver_error_not_wiring_diagnosis'),
    ('duplicate_cached_default_candidates', 'if (cand[i].rx == rx && cand[i].tx == tx) return;',
     'if ((static_cast<void>(rx), static_cast<void>(tx), false)) return;',
     'candidate_dedup', 'dedup_cache_default_pairs'),
    ('ignore_candidate_init', 'if (!hp_uart_init(cand[i].rx, cand[i].tx))',
     'if ((hp_uart_init(cand[i].rx, cand[i].tx), false))', 'init_failure', 'failed_init_has_no_query'),
    ('ignore_winning_reinit', 'if (!hp_uart_init(r.rx, r.tx))',
     'if ((hp_uart_init(r.rx, r.tx), false))', 'reinit_failure', 'failed_winning_reinit_no_fingerprint_queries'),
    ('cached_protocol_second', 'const Protocol p0 = c.proto;',
     'const Protocol p0 = c.proto == Protocol::I ? Protocol::S : Protocol::I;',
     'cached_protocol_order', 'cached_framing_is_first'),
    ('one_page_attempt', 'DETECT_PAGE_TRIES = 3;', 'DETECT_PAGE_TRIES = 1;',
     'recovered_page', 'retry_recovers_page_bit'),
    ('count_only_one_recovery', 'recovered += attempt;', 'recovered += attempt ? 1 : 0;',
     'third_attempt_recovers', 'two_recovery_attempts_counted'),
    ('drop_earlier_transport_error', 'had_transport_error = true;',
     'had_transport_error = false;', 'error_then_silence', 'earlier_error_survives_later_silence'),
    ('final_error_only', 'if (had_transport_error && reg != 0x11 && reg != 0x56)',
     'if (is_transport_error(kind) && reg != 0x11 && reg != 0x56)',
     'error_then_silence', 'earlier_error_survives_later_silence'),
    ('retry_affirmative_nak', 'return -2; // NAK: unsupported page, no retry needed',
     'continue; // mutant retries affirmative NAK', 'nak_no_retry', 'nak_is_not_retried'),
    ('retain_error_after_nak', 'had_transport_error = false;\n            return -2;',
     '/* mutant keeps earlier error */\n            return -2;',
     'nak_after_error', 'affirmative_nak_clears_missing_page_uncertainty'),
    ('outdoor_capacity_wrong_offset', 'fp.kw_tenths = page00[12];',
     'fp.kw_tenths = page00[11];', 'outdoor_precedence', 'both_capacity_observations_preserved'),
    ('zero_indoor_capacity_known', 'len60 > 6 && page60[6] != 0', 'len60 > 6',
     'unknown_capacity', 'unknown_capacity_stays_ambiguous'),
    ('eeprom_blocks_fingerprint', 'reg != 0x11 && reg != 0x56', 'reg != 0x56',
     'eeprom_error_optional', 'eeprom_absence_does_not_block_model'),
    ('s56_blocks_fingerprint', 'reg != 0x11 && reg != 0x56', 'reg != 0x11',
     'protocol_s56_optional', 'unverified_s56_is_optional'),
    ('empty_candidate_display', 'r.candidates.emplace_back(out[i]);',
     'r.candidates.emplace_back("generic");',
     'short_capacity_fallback', 'fallback_keeps_consistent_ambiguous_models'),
    ('wrong_s_profile', 'r.candidates.emplace_back(b);\n            r.best = b;',
     'r.candidates.emplace_back(b);\n            r.best = "generic";',
     'protocol_s', 's_fingerprint_uses_s_profile'),
]


def anchor(source, old, tag):
    pattern = r'\s*'.join(re.escape(part) for part in re.split(r'\s+', old.strip()))
    matches = list(re.finditer(pattern, source))
    if len(matches) != 1:
        raise RuntimeError(f'{tag}: expected one mutation anchor, found {len(matches)}')
    return matches[0]


mutation_results = []
if not args.baseline and not args.no_mutations:
    for tag, old, new, case, oracle in mutations:
        match = anchor(text, old, tag)
        mutant = OUT / (tag + '.cpp')
        mutant.write_text(text[:match.start()] + new + text[match.end():])
        mutant_binary = build(mutant, tag)
        result = run([str(mutant_binary), case], require_success=False)
        output = result.stdout + result.stderr
        if result.returncode != 1 or f'FAIL {case}: oracle={oracle}' not in output:
            raise RuntimeError('Compiled negative control did not fail named oracle: ' + tag + '\n' + output)
        print('NEGATIVE CONTROL ' + tag + ': ' + oracle)
        mutation_results.append({'mutation': tag, 'case': case, 'expected_oracle': oracle,
                                 'exit_code': result.returncode, 'output': output,
                                 'sha256': hashlib.sha256(mutant.read_bytes()).hexdigest()})

after = hashes(dependencies(OUT / 'production.d'))
if before != after:
    changed = [p for p in before.keys() | after.keys() if before.get(p) != after.get(p)]
    raise RuntimeError('Compile inputs changed during run: ' + repr(changed))
head = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                      capture_output=True, text=True, timeout=5)
record = {
    'compiler': compiler, 'production_head': head.stdout.strip() if head.returncode == 0 else None,
    'mode': 'old-head control' if args.baseline else 'production',
    'sanitizer': args.sanitizer, 'commands': commands, 'cases': case_results,
    'negative_controls': mutation_results, 'input_sha256': after,
    'claim_limits': [
        'Complete hp_detect.cpp, generated real profile registry/signatures and pure CRC, pin and selection rules execute.',
        'Config snapshots, build defaults, active Ethernet reservation, UART init/transport and diagnostic sink are host adapters.',
        'Frames are bounded synthetic protocol-shaped data, never observations of a physical heat pump.',
        'Protocol S 0x56 length uses the current unverified implementation contract; no physical S echo or length claim is made.',
        'No physical GPIO electrical behavior, firmware heap/stack, UART timing, persistence, rendered UI or hardware delivery is proven.',
    ],
}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + p + '\n' for p, sha in after.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print(f'PASS {len(CASES)} cases, {len(mutation_results)} compiled negative controls')
print('RECORDED ' + str(len(after)) + ' compile inputs: ' + str(OUT / 'evidence.json'))
