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

scenarios = ['ref_oom_recovery', 'circulation_oom_recovery', 'reconfigure_config_oom',
             'failure_episodes', 'real_json_consumers', 'circulation_probe_postsubscribe_oom']
binary = compile('production-mqtt', frozen)
deps.update([source_path, CJSON/'cJSON.c', CJSON/'cJSON.h', lock_path, HERE/'run.py'])
inputs_before = {path: digest(path) for path in deps if path.is_file()}
results = {}
for scenario in scenarios:
    result = execute([binary, scenario])
    results[scenario] = result.stdout.strip()
    print(result.stdout.strip())

mutations = [
    ('activity-release', 'ref_oom_recovery',
     '~MqttPublishActivity() {\n        s_publish_network_quiesced.store(true, std::memory_order_release);\n    }',
     '~MqttPublishActivity() {\n        /* mutation: leave allocation ownership claimed */\n    }',
     'MQTT_ACTIVITY_RELEASED_AT_DELAY', 1),
    ('snapshot-lock-unwind', 'ref_oom_recovery',
     '''        {
            Lock lk(s_mtx);
            if (!reference_request_current_locked(frame.reference_epoch, c)) continue;
            candidate           = s_ref_status;
            candidate_watermark = s_ref_source_time;
        }''',
     '''        {
            xSemaphoreTake(s_mtx, portMAX_DELAY);
            if (!reference_request_current_locked(frame.reference_epoch, c)) continue;
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
]
mutation_results = {}
for name, scenario, before, after, assertion, count in mutations:
    # Source formatting may change whitespace; semantic anchors must remain unique.
    pattern = re.compile(r'\s+'.join(re.escape(part) for part in re.split(r'\s+', before)))
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
