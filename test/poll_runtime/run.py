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
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1], help='Repository root; defaults to installed test directory parent')
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none', help='Optional UBSan instrumentation')
args = parser.parse_args()
REPO = args.root.resolve()
if not (REPO / 'main/hp_poll.cpp').is_file():
    parser.error('--root must name the daikin-altherma-esp32 repository')
SOURCE = REPO / 'main/hp_poll.cpp'
FORMAT = REPO / 'main/hp_convert.cpp'
OUT = Path(tempfile.mkdtemp(prefix='daikin-poll-runtime-'))
COMPILER = os.environ.get('CXX', 'c++')
SANITIZERS = 'undefined' if args.sanitizer == 'undefined' else ''
SAN_FLAGS = ['-fsanitize=' + SANITIZERS] if SANITIZERS else []
FLAGS = ['-std=c++20', '-O0', '-g', *SAN_FLAGS, '-fno-omit-frame-pointer',
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
    command([COMPILER, *SAN_FLAGS, str(obj), str(OUT / 'format.o'), '-o', str(binary)])
    return binary

version = command([COMPILER, '--version']).stdout
command([COMPILER, *FLAGS, '-MM', '-MF', str(OUT / 'preflight-poll.d'),
         '-DPOLL_PRODUCTION_SOURCE="' + str(SOURCE) + '"', str(HERE / 'fixture.cpp')])
command([COMPILER, *FLAGS, '-MM', '-MF', str(OUT / 'preflight-format.d'), str(FORMAT)])
inputs_before = hashes(dependency_inputs([OUT / 'preflight-poll.d', OUT / 'preflight-format.d']))
command([COMPILER, *FLAGS, '-MMD', '-MF', str(OUT / 'format.d'),
         '-c', str(FORMAT), '-o', str(OUT / 'format.o')])
binary = build(SOURCE, 'baseline')
baseline = command([str(binary)])
print(baseline.stdout, end='')
source_text = SOURCE.read_text()
mutations = {
    'clear_last_good_cache': (
        's_cycles_skipped.fetch_add(1, std::memory_order_relaxed);',
        's_cycles_skipped.fetch_add(1, std::memory_order_relaxed); s_cache.clear();',
        'last_good_cache_preserved'),
    'double_fixed_poll_delay': (
        'vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));     // fixed 1 s cadence',
        'vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 2000));     // mutated fixed cadence',
        'normal_poll_delay'),
    'retain_quiescence_ack': (
        's_network_quiesced.store(false, std::memory_order_release);',
        's_network_quiesced.store(true, std::memory_order_release);',
        'oom_does_not_claim_quiescence'),
    'raw_stats_lock': (
        'Lock lk(s_mtx);\n    st = s_stats;',
        'xSemaphoreTake(s_mtx, portMAX_DELAY);\n    st = s_stats;\n    xSemaphoreGive(s_mtx);',
        'reader_oom_releases_production_semguard'),
    'repeat_oom_episode_log': (
        'if (failures.first_failure()) diag_printf("poll: cycle skipped (%s)\\n", e.what());',
        'diag_printf("poll: cycle skipped (%s)\\n", e.what());',
        'consecutive_oom_episode_logs_once'),
    'never_rearm_episode_log': (
        'failures.succeeded();',
        '/* mutation: success does not rearm diagnostic episode */',
        'new_oom_episode_logs_after_recovery'),
}
results = []
for tag, (old, new, oracle) in mutations.items():
    anchor = re.search(r'\s*'.join(re.escape(part) for part in re.split(r'\s+', old.strip())), source_text)
    if not anchor:
        raise RuntimeError('Mutation anchor missing: ' + tag)
    mutant = OUT / (tag + '.cpp')
    mutant.write_text(source_text[:anchor.start()] + new + source_text[anchor.end():])
    binary = build(mutant, tag)
    mutation_args = [str(binary)]
    commands.append(shlex.join(mutation_args))
    result = subprocess.run(mutation_args, cwd=HERE, capture_output=True, text=True, timeout=15)
    output = result.stdout + result.stderr
    if result.returncode == 0 or 'FAIL oracle=' + oracle not in output:
        raise RuntimeError('Negative control did not fail expected oracle: ' + tag + '\n' + output)
    results.append({'mutation': tag, 'expected_oracle': oracle, 'exit_code': result.returncode,
                    'output': output, 'sha256': hashlib.sha256(mutant.read_bytes()).hexdigest()})
    print('NEGATIVE CONTROL ' + tag + ': ' + output.strip())

manifest = hashes(dependency_inputs([OUT / 'baseline.d', OUT / 'format.d']))
if manifest != inputs_before:
    changed = [path for path in set(manifest) | set(inputs_before) if manifest.get(path) != inputs_before.get(path)]
    raise RuntimeError('Compile inputs changed during run: ' + repr(changed))
git_head = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5)
record = {'compiler': version.strip(), 'sanitizers': SANITIZERS, 'commands': commands, 'baseline': baseline.stdout,
          'negative_controls': results, 'input_sha256': manifest,
          'production_head': git_head.stdout.strip() if git_head.returncode == 0 else None,
          'claim_limits': ['Host adapters replace RTOS scheduling, mutex implementation, UART transport, config store, diag ring, history/checkup/dwell stores, heap/watchdog samplers and OTA/weather request flags.',
                           'Real complete hp_poll.cpp task and poll/readers, hp_convert.cpp, production profile tables and logic/RAII headers execute.',
                           'No ESP32 heap/stack timing, physical source truth, NVS persistence, live HTTP or board behavior is proven.']}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + path + '\n' for path, sha in manifest.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print('RECORDED ' + str(len(manifest)) + ' exact compile inputs in ' + str(OUT / 'evidence.json'))

print('OUTPUT ' + str(OUT))
