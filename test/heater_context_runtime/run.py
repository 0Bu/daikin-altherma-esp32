#!/usr/bin/env python3
"""Test the current independent-hour owner as a separate TU, with source-bound controls."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1])
parser.add_argument('--out', type=Path)
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none')
parser.add_argument('--case', action='append')
args = parser.parse_args()
ROOT = args.root.resolve()
STORE = ROOT / 'main/heater_context_store.cpp'
if not STORE.is_file():
    parser.error('--root requires the actual production owner')
if args.out:
    OUT = args.out.resolve()
    OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
else:
    OUT = Path(tempfile.mkdtemp(prefix='daikin-heater-context-runtime-' + args.sanitizer + '-')).resolve()
    OUT.chmod(0o700)

CASES = [
    'bootstrap', 'once_merge', 'independent_reboot', 'revisions', 'ack_race', 'deferral',
    'pinned_reproof', 'io_retry', 'slow_zero', 'replay_retry', 'overlap', 'live_authority',
    'scope_stale', 'clock_floor', 'future_floor', 'keeper', 'opaque_old', 'aging_payload', 'codec',
    'incomplete_global', 'bad_latest', 'keeper_append_cache', 'keeper_slices', 'epoch_scan',
    'epoch_replay', 'live_replay_callback', 'no_reindex_ack', 'read_fence_gap', 'scope_bounds',
    'saturation', 'sequence_limit', 'receipts_exact', 'pending_epoch_pin', 'clock_new_scope',
    'retired_catalog', 'shutdown_budget', 'rollback_replay_callback', 'failed_full_record',
    'notice_ack', 'callback_busy_ack', 'callback_busy_defer', 'callback_busy_failed',
    'callback_busy_invalidate', 'callback_epoch_wait', 'wide_window', 'partial_capabilities',
    'final_scan_deadline', 'dropped_finish', 'clock_anchor_jitter', 'erase_rotation_progress',
    'ghost_prefence', 'clock_anchor_limits', 'clock_hour_jitter', 'reference_reconcile',
    'reference_metadata_ack', 'invalid_sector_range', 'ghost_empty_payload', 'prefence_with_fresh',
    'prestart_guards', 'unsynced_recovery', 'conflicting_highest_sequence', 'codec_body_parity',
]
if len(CASES) != len(set(CASES)) or len(CASES) != 62:
    raise RuntimeError('the complete owner case inventory must remain explicit and unique')
if args.case and set(args.case) - set(CASES):
    parser.error('unknown --case')
compiler = shlex.split(os.environ.get('CXX', 'c++'))
flags = ['-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-fstack-usage',
         '-I', str(HERE / 'stubs'), '-I', str(ROOT / 'main')]
if args.sanitizer == 'undefined':
    flags += ['-fsanitize=undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer']
commands, results, controls = [], [], []
inputs = {Path(__file__).resolve(), HERE / 'README.md'}
before, dependencies = {}, {}
binary = OUT / 'runtime'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def run(argv, log, timeout=180):
    argv = [str(value) for value in argv]
    start = time.perf_counter()
    result = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
    target = OUT / log
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(result.stdout + result.stderr)
    commands.append({'argv': argv, 'exit': result.returncode,
                     'seconds': time.perf_counter() - start, 'log': str(log), 'sha256': sha(target)})
    return result


def dependency_paths(path):
    text = path.read_text().replace('\\\n', ' ').partition(':')[2]
    result = set()
    for word in shlex.split(text):
        item = Path(word)
        result.add((item if item.is_absolute() else ROOT / item).resolve())
    if not result:
        raise RuntimeError('empty compiler dependency inventory: ' + str(path))
    return result


def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('control requires one exact production anchor: ' + old)
    return text.replace(old, new, 1)


def function_bounds(text, signature):
    if text.count(signature) != 1:
        raise RuntimeError('control requires one production function: ' + signature)
    start = text.index(signature)
    opening = text.index('{', start)
    depth, mode, escaped, i = 0, 'code', False, opening
    while i < len(text):
        char, pair = text[i], text[i:i + 2]
        if mode == 'line':
            if char == '\n': mode = 'code'
        elif mode == 'comment':
            if pair == '*/': mode = 'code'; i += 1
        elif mode in ('"', "'"):
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == mode: mode = 'code'
        elif pair == '//': mode = 'line'; i += 1
        elif pair == '/*': mode = 'comment'; i += 1
        elif pair == 'R"': raise RuntimeError('raw strings require a control extractor update')
        elif char in ('"', "'"): mode = char
        elif char == '{': depth += 1
        elif char == '}':
            depth -= 1
            if not depth: return start, opening, i + 1
        i += 1
    raise RuntimeError('unterminated production function')


def variants(original):
    result = [
        ('equal_endpoint', 'overlap', 'report().counters.on_us == 10 * S && report().counters.samples == 2',
         once(original, 's_read.last >= c.first', 's_read.last > c.first')),
        ('ack_dirty_clear', 'ack_race', 'd.heater == 0 && d.counters.on_us == 12 * S',
         once(original, 'if (c.mutation == s_claim_mutation)', 'if (true)')),
        ('data_without_proof', 'live_authority', '!next()',
         once(original, '!clock_ok(now, wall) || !s_proof || !s_enabled',
              '!clock_ok(now, wall) || false || !s_enabled')),
        ('release_pin', 'pinned_reproof', 'heater_context_flash_claim_pending()',
         once(original, 'return s_claim;', 'return false;')),
        ('dropped_finish_retry', 'dropped_finish', 'slot < flash.size()',
         once(original, 'if (s_scan.next == logic::HISTORY_JOURNAL_SLOT_COUNT) {\n'
                        '                finish_scan_locked();\n                break;\n            }',
              '/* deliberately omit yielded-finish retry */')),
        ('moving_anchor', 'clock_anchor_jitter', 'next()',
         once(original, 'if (!s_anchored)', 'if (true)')),
        ('all_hours_dirty', 'erase_rotation_progress', 'rotation_write(40) == 40',
         once(original, 'if (first >= logic::HISTORY_JOURNAL_SLOT_COUNT || first % per) return;',
              'if (first >= logic::HISTORY_JOURNAL_SLOT_COUNT || first % per) return;\n'
              'for(auto& h:s_cells)for(auto& c:h)if(c.state&BaseKnown)c.state|=Dirty;')),
        ('newer_reference_ignored', 'reference_reconcile', 'next()',
         once(original, 'if (c.revision && head.sequence > c.revision) c.state |= RefSuperseded;',
              '/* deliberately ignore newer physical revision */')),
        ('ack_flags_not_retained', 'reference_metadata_ack', '!next()',
         once(original, 'c.flags |= s_write.flags;', '/* deliberately lose acknowledged flags */')),
        ('ack_loss_not_retained', 'reference_metadata_ack', '!next()',
         once(original, 'if (s_write.lost > c.lost) c.lost = s_write.lost;',
              '/* deliberately lose acknowledged loss metadata */')),
        ('ignore_unsynced_clock', 'unsynced_recovery', 'sdk::reads == reads && !next()',
         once(original, 'if (!time_synced()) return -1;', 'if (false) return -1;')),
        ('accept_conflicting_highest_sequence', 'conflicting_highest_sequence',
         'm.restore_pending && (m.flags & hc::Incomplete) && (m.flags & hc::Loss) && !m.counters.on_us && !m.observed_hours',
         once(original, 'if (head.sequence == c.revision && slot != c.slot) {', 'if (false) {')),
    ]
    start, _, end = function_bounds(original, 'void known_append()')
    result.append(('stale_keeper_cache', 'keeper_append_cache',
                   'permission(0) == HeaterContextErasePermission::Protected',
                   original[:start] + 'void known_append() {}' + original[end:]))
    _, opening, end = function_bounds(original, 'bool equal_counters(')
    result.append(('counter_reference_ignored', 'reference_reconcile', 'next()',
                   original[:opening + 1] + '\n(void)a;(void)b;return true;\n' + original[end - 1:]))
    start, _, end = function_bounds(original, 'void materialize(')
    part = once(original[start:end], 'expire_locked(esp_timer_get_time(), heater_wall_now());',
                '/* deliberately omit post-Reader clock observation */')
    result.append(('replay_no_clock', 'rollback_replay_callback',
                   '!report().counters.on_us && report().flags & hc::Clock',
                   original[:start] + part + original[end:]))
    empty_start, _, empty_end = function_bounds(original, 'if (!has_evidence(s_read.counters))')
    # Both redundant empty-hour defenses must be removed to reproduce the former ghost count.
    empty = original[:empty_start] + '/* deliberately accept an empty observation */' + original[empty_end:]
    empty = once(empty, '(c.state & (Live | BasePresent)) && has_evidence(c.counters) &&',
                 '(c.state & (Live | BasePresent)) &&')
    result.append(('empty_archive_counted', 'ghost_empty_payload',
                   '!report().counters.samples && report().observed_hours == 0', empty))
    if len(result) != 16:
        raise RuntimeError('all fourteen historical controls plus two new controls are required')
    return result


failure = None
unknown = tripwire = None
source_guards = {}
compiled_deps_checked = False
try:
    for tag, source in [('owner', STORE), ('fixture', HERE / 'fixture.cpp')]:
        dep = OUT / (tag + '-preflight.d')
        result = run([*compiler, *flags, '-MM', '-MF', dep, source], tag + '-dependencies.log')
        if result.returncode: raise RuntimeError(result.stdout + result.stderr)
        dependencies[tag] = dependency_paths(dep)
        inputs.update(dependencies[tag])
    before = {str(path): sha(path) for path in sorted(inputs)}
    (OUT / 'inputs-before.json').write_text(json.dumps(before, indent=2) + '\n')
    for tag, source in [('owner', STORE), ('fixture', HERE / 'fixture.cpp')]:
        dep, obj = OUT / (tag + '.d'), OUT / (tag + '.o')
        result = run([*compiler, *flags, '-MMD', '-MF', dep, '-c', source, '-o', obj], tag + '-compile.log')
        if result.returncode: raise RuntimeError(result.stdout + result.stderr)
        if dependency_paths(dep) != dependencies[tag]:
            raise RuntimeError('actual compiled dependencies differ from preflight: ' + tag)
    compiled_deps_checked = True
    result = run([*compiler, *flags, OUT / 'owner.o', OUT / 'fixture.o', '-o', binary], 'link.log')
    if result.returncode: raise RuntimeError(result.stdout + result.stderr)
    run([*compiler, '--version'], 'compiler.log')
    if shutil.which('nm'): run(['nm', '-u', OUT / 'owner.o'], 'owner-undefined.log')
    unknown = run([binary, 'unknown_case'], 'unknown-case.log')
    if unknown.returncode != 1 or unknown.stderr.strip() != 'FAIL unknown_case':
        raise RuntimeError('unknown-case vacuity control must fail explicitly')
    if args.sanitizer == 'undefined':
        tripwire = run([binary, 'sanitizer_tripwire'], 'sanitizer-tripwire.log')
        if tripwire.returncode == 0 or 'runtime error: signed integer overflow:' not in tripwire.stderr:
            raise RuntimeError('UBSan signed-overflow tripwire must terminate')
    for case in args.case or CASES:
        result = run([binary, case], case + '.log')
        print(result.stdout + result.stderr, end='', flush=True)
        results.append({'case': case, 'returncode': result.returncode,
                        'stdout': result.stdout, 'stderr': result.stderr})
        if result.returncode: raise RuntimeError('owner case failed: ' + case)
    original = STORE.read_text()
    for name, pattern in [('token', r'if \(s_token == UINT32_MAX\)'),
                          ('epoch', r'if \(s_epoch == UINT32_MAX\)'),
                          ('cell_mutation', r'if \(c.mutation == UINT32_MAX\)')]:
        if len(re.findall(pattern, original)) != 1:
            raise RuntimeError('32-bit source guard changed; update its limit assessment: ' + name)
        source_guards[name] = 'Source inspected only; not runtime exhausted through public API.'
    if not args.case:
        for name, case, expected, changed in variants(original):
            directory = OUT / name
            directory.mkdir()
            source, obj, dep = directory / 'owner.cpp', directory / 'owner.o', directory / 'owner.d'
            source.write_text(changed)
            result = run([*compiler, *flags, '-MMD', '-MF', dep, '-c', source, '-o', obj],
                         name + '/compile.log')
            if result.returncode: raise RuntimeError('control must compile: ' + name + '\n' + result.stderr)
            control_deps = dependency_paths(dep)
            control_deps.remove(source)
            control_deps.add(STORE)
            if control_deps != dependencies['owner']:
                raise RuntimeError('control changed production include closure: ' + name)
            mutant = directory / 'runtime'
            result = run([*compiler, *flags, obj, OUT / 'fixture.o', '-o', mutant], name + '/link.log')
            if result.returncode: raise RuntimeError('control must link: ' + name + '\n' + result.stderr)
            result = run([mutant, case], name + '/run.log')
            match = re.fullmatch(r'FAIL [0-9]+: ([\s\S]*?)\s*', result.stderr)
            observed = match.group(1) if match else ''
            normalize = lambda text: re.sub(r'\s+', '', text)
            if result.returncode != 1 or normalize(observed) != normalize(expected):
                raise RuntimeError('control missed its exact behavioral oracle: ' + name + '\n' + result.stderr)
            controls.append({'name': name, 'case': case, 'returncode': result.returncode,
                             'expected_expression': expected, 'stderr': result.stderr,
                             'source_sha256': sha(source), 'dependencies_checked': True})
            print('DETECTED', name, case, result.stderr.strip(), flush=True)
except Exception as error:
    failure = str(error)
finally:
    after = {str(path): sha(path) for path in sorted(inputs)}
    stable = bool(before) and before == after
    record = {'outcome': 'passed' if not failure and stable else 'failed',
              'completed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'sanitizer': args.sanitizer, 'failure': failure, 'commands': commands,
              'inputs_before': before, 'inputs_after': after, 'inputs_unchanged': stable,
              'actual_mmd_matches_preflight': compiled_deps_checked,
              'compiled_units': {'owner': str(STORE), 'fixture': str(HERE / 'fixture.cpp')},
              'requested_cases': args.case, 'complete_case_inventory': not bool(args.case),
              'cases': results, 'negative_controls': controls,
              'unknown_case_control': unknown.returncode if unknown else None,
              'ubsan_tripwire': tripwire.returncode if tripwire else None,
              'source_only_32bit_guards': source_guards,
              'binary_sha256': sha(binary) if binary.is_file() else None,
              'owner_object_sha256': sha(OUT / 'owner.o') if (OUT / 'owner.o').is_file() else None,
              'limits': ['Current actual production owner is a separate translation unit; no frozen include fallback.',
                         'Typed header/normalized CRC use actual production headers; Flash transport is a host array.',
                         'No full History/ESP-IDF build, real flash, RTOS scheduling, reboot, target heap/stack or plant proof.',
                         '32-bit token/epoch/cell-mutation exhaustion is source-inspected, not runtime-tested.']}
    (OUT / 'receipt.json').write_text(json.dumps(record, indent=2) + '\n')
    print('Evidence:', OUT / 'receipt.json', flush=True)
if failure: raise SystemExit(failure)
if not stable: raise SystemExit('Sources changed during the run')
