#!/usr/bin/env python3
"""Build the complete LED and button production objects with SDK/service adapters."""
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
OUT = Path(tempfile.mkdtemp(prefix='daikin-startup-runtime-'))
CXX = os.environ.get('CXX', 'c++')
SAN_FLAGS = ['-fsanitize=undefined'] if args.sanitizer == 'undefined' else []
FLAGS = ['-std=c++20', '-O0', '-g', *SAN_FLAGS, '-fno-omit-frame-pointer', '-I', str(HERE / 'stubs'), '-I', str(REPO / 'main')]
sources = {'led': REPO / 'main/status_led.cpp', 'button': REPO / 'main/recovery_button.cpp',
           'stack': REPO / 'main/stack_watch.cpp', 'fixture': HERE / 'fixture.cpp'}
commands = []
def command(args):
    commands.append(shlex.join(args))
    r = subprocess.run(args, cwd=HERE, capture_output=True, text=True, timeout=30)
    if r.returncode:
        raise RuntimeError(shlex.join(args) + '\n' + r.stdout + r.stderr)
    return r
def dependency_inputs(deps):
    result = {Path(__file__).resolve(), *sources.values()}
    for dep in deps:
        for name in shlex.split(dep.read_text().replace('\\\n', ' ').partition(':')[2]):
            p = Path(name)
            result.add(p.resolve() if p.is_absolute() else (HERE / p).resolve())
    result.update((HERE / 'stubs').rglob('*.hpp'))
    result.update((HERE / 'stubs').rglob('*.h'))
    return result
def hashes(paths):
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}
def compile_object(source, name):
    command([CXX, *FLAGS, '-MMD', '-MF', str(OUT / (name + '.d')), '-c', str(source), '-o', str(OUT / (name + '.o'))])
def link(led_name, button_name, binary_name, stack_name='stack'):
    binary = OUT / binary_name
    command([CXX, *SAN_FLAGS, str(OUT / 'fixture.o'), str(OUT / (stack_name+'.o')),
             str(OUT / (led_name + '.o')), str(OUT / (button_name + '.o')), '-o', str(binary)])
    return binary
version = command([CXX, '--version']).stdout.strip()
for name, source in sources.items():
    command([CXX, *FLAGS, '-MM', '-MF', str(OUT / ('preflight-' + name + '.d')), str(source)])
before = hashes(dependency_inputs([OUT / ('preflight-' + name + '.d') for name in sources]))
for name, source in sources.items(): compile_object(source, name)
baseline = link('led', 'button', 'baseline')
scenarios = ['led_gpio_high', 'led_gpio_low', 'led_ws2812', 'led_mqtt_oom', 'led_hp_oom',
             'button_low', 'button_high', 'led_disabled', 'button_disabled',
             'led_init_fail', 'button_init_fail', 'stack_minima']
passes = []
for scenario in scenarios:
    r = command([str(baseline), scenario])
    passes.append({'scenario': scenario, 'output': r.stdout})
    print(r.stdout, end='')
controls = []
for target, anchor, scenario, oracle in [
    ('led', 'void status_led_task(void*) {', 'led_gpio_high', 'led_task_startup_no_config_copy'),
    ('button', 'void button_task(void*) {', 'button_low', 'button_task_startup_no_config_copy')]:
    contents = sources[target].read_text()
    found = re.search(r'\s*'.join(re.escape(p) for p in re.split(r'\s+', anchor)), contents)
    if not found: raise RuntimeError('Mutation anchor missing: ' + target)
    mutated = contents[:found.end()] + '\n    const Config allocating_startup_snapshot = config();\n    (void)allocating_startup_snapshot;\n' + contents[found.end():]
    source = OUT / (target + '-allocating-startup.cpp')
    source.write_text(mutated)
    object_name = target + '-mutated'
    compile_object(source, object_name)
    binary = link(object_name if target == 'led' else 'led', object_name if target == 'button' else 'button', target + '-mutant')
    mutation_args = [str(binary), scenario]
    commands.append(shlex.join(mutation_args))
    result = subprocess.run(mutation_args, cwd=HERE, capture_output=True, text=True, timeout=10)
    output = result.stdout + result.stderr
    if result.returncode == 0 or 'FAIL oracle=' + oracle not in output:
        raise RuntimeError('Mutation did not fail named startup oracle: ' + target + '\n' + output)
    controls.append({'source': target, 'expected_oracle': oracle, 'exit_code': result.returncode, 'output': output, 'mutant_sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    print('NEGATIVE CONTROL ' + target + ': ' + output.strip())
for target, anchor_before, anchor_after, scenario, oracle in [
    ('led', 'for (;;) {\n        stack_watch_sample(StackWatch::Led);',
     'for (;;) {', 'led_gpio_high', 'accessory_task_samples_exact_owner_slot'),
    ('button', 'for (;;) {\n        stack_watch_sample(StackWatch::Button);',
     'for (;;) {', 'button_low', 'accessory_task_samples_exact_owner_slot'),
    ('led', 'stack_watch_sample(StackWatch::Led);\n        vTaskDelete(nullptr);',
     'vTaskDelete(nullptr);', 'led_init_fail', 'failed_accessory_init_samples_owner_before_delete'),
    ('button', 'stack_watch_sample(StackWatch::Button);\n        vTaskDelete(nullptr);',
     'vTaskDelete(nullptr);', 'button_init_fail', 'failed_accessory_init_samples_owner_before_delete'),
    ('stack', 'if (prev == 0 || free_bytes < prev)',
     'if (prev == 0 || free_bytes < prev || free_bytes > prev)', 'stack_minima',
     'boot_minimum_survives_task_recreation'),
    ('stack', 'static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr));',
     'static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr)) * 4;', 'stack_minima',
     'stack_minimum_retains_exact_esp_idf_byte_unit')]:
    contents = sources[target].read_text()
    pattern = re.compile(r'\s+'.join(re.escape(part) for part in re.split(r'\s+', anchor_before.strip())))
    if len(pattern.findall(contents)) != 1:
        raise RuntimeError('Unique stack mutation anchor required: ' + target + '/' + oracle)
    mutated = OUT / (target+'-'+oracle+'.cpp')
    mutated.write_text(pattern.sub(lambda match: anchor_after, contents))
    object_name = target+'-'+oracle
    compile_object(mutated, object_name)
    binary = link(object_name if target == 'led' else 'led',
                  object_name if target == 'button' else 'button', object_name+'-mutant',
                  object_name if target == 'stack' else 'stack')
    mutation_args = [str(binary), scenario]
    commands.append(shlex.join(mutation_args))
    result = subprocess.run(mutation_args, cwd=HERE, capture_output=True, text=True, timeout=10)
    output = result.stdout+result.stderr
    if result.returncode != 1 or 'FAIL oracle='+oracle not in output:
        raise RuntimeError('Stack mutation must fail its exact owner/minimum oracle: '+output)
    controls.append({'source': target, 'expected_oracle': oracle, 'exit_code': result.returncode,
                     'output': output, 'mutant_sha256': hashlib.sha256(mutated.read_bytes()).hexdigest()})
    print('NEGATIVE CONTROL '+target+': '+output.strip())
manifest = hashes(dependency_inputs([OUT / (name + '.d') for name in sources]))
if manifest != before:
    changed = [p for p in set(before) | set(manifest) if before.get(p) != manifest.get(p)]
    raise RuntimeError('Input files changed during witness: ' + repr(changed))
git_head = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5)
record = {'compiler': version, 'sanitizers': args.sanitizer, 'commands': commands, 'passed_scenarios': passes, 'negative_controls': controls, 'input_sha256': manifest,
          'production_head': git_head.stdout.strip() if git_head.returncode == 0 else None,
          'source_and_build_binding': ['Complete current LED, button and stack-sampler sources compile as separate production-shaped translation units, then link with the fixture object.', 'Actual production config.hpp, Config model, with_config and stack null formatter compile unchanged; only config-lock/reference primitives, current-task FreeRTOS watermark and full config() failpoint are adapted.', 'No production source files are rewritten; mutations are complete source copies under this temporary directory.'],
          'limits': ['The SDK adapter records GPIO/RMT/task calls and supplies controlled watermark bytes; it does not run ESP-IDF drivers, physical pins, firmware stacks or FreeRTOS scheduling.', 'External diagnostic and destructive service functions are adapters; every destructive call is counted and all scenarios require zero.', 'Configured tasks terminate the host process at their first scheduled delay; startup failures run their retirement path. Subsequent blink cycles, button holds, real erase behavior and recovery persistence are untested.', 'LED MQTT/hp snapshot errors are injected std::bad_alloc at the external status adapter, proving the production loop exception boundary, dark fallback and 1 s delay.', 'The stack_minima scenario tests the actual shared sampler and formatter with controlled current-owner byte marks, including a recreated-task mark; it is not measured device headroom.']}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + path + '\n' for path, sha in manifest.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print('RECORDED ' + str(len(manifest)) + ' input hashes; all unchanged before/after run')

print('OUTPUT ' + str(OUT))
