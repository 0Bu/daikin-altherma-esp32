#!/usr/bin/env python3
"""Execute complete configuration/OTA HTTP units with the lock-resolved cJSON implementation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1])
parser.add_argument('--real-cjson', type=Path)
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none')
args = parser.parse_args()
ROOT = args.root.resolve()
SOURCE = ROOT / 'main/http_config.cpp'
OTA_SOURCE = ROOT / 'main/http_ota.cpp'
CJSON = (args.real_cjson or ROOT / 'managed_components/espressif__cjson/cJSON').resolve()
if not (CJSON / 'cJSON.c').is_file() or not (CJSON / 'cJSON.h').is_file():
    parser.error('build-resolved cJSON.c and cJSON.h must be available locally')
header = (CJSON / 'cJSON.h').read_text()
if not all(re.search(r'#define CJSON_VERSION_' + name + r'\s+' + value + r'\b', header)
           for name, value in [('MAJOR', '1'), ('MINOR', '7'), ('PATCH', '19')]):
    parser.error('cJSON must match the production 1.7.19 API')
if 'version: 1.7.19~2' not in (ROOT / 'dependencies.lock').read_text():
    parser.error('update the explicit cJSON provenance check when the lock changes')
OUT = Path(tempfile.mkdtemp(prefix='daikin-config-http-runtime-'))
CC, CXX = os.environ.get('CC', 'cc'), os.environ.get('CXX', 'c++')
SAN = ['-fsanitize=undefined', '-fno-sanitize-recover=all'] if args.sanitizer == 'undefined' else []
FLAGS = ['-std=c++20', '-O0', '-g', '-ffunction-sections', '-fdata-sections', '-Wall', '-Wextra',
         '-Werror', '-Wno-unused-parameter', *SAN,
         '-I' + str(HERE / 'stubs'), '-I' + str(ROOT / 'main'), '-I' + str(CJSON)]
LINK = ['-Wl,-dead_strip'] if sys.platform == 'darwin' else ['-Wl,--gc-sections']
commands = []


def command(argv, success=True):
    argv = list(map(str, argv))
    commands.append(shlex.join(argv))
    result = subprocess.run(argv, cwd=HERE, capture_output=True, text=True, timeout=60)
    if success and (result.returncode or 'runtime error:' in result.stderr):
        raise RuntimeError(shlex.join(argv) + '\n' + result.stdout + result.stderr)
    return result


def compile(source, tag, ota=OTA_SOURCE, include_main=None):
    binary = OUT / (tag + '.bin')
    extra = ['-I' + str(include_main)] if include_main else []
    command([CXX, *extra, *FLAGS, '-MMD', '-MF', OUT / (tag + '.d'),
             '-DCONFIG_HTTP_PRODUCTION_SOURCE="' + str(source) + '"',
             '-DOTA_HTTP_PRODUCTION_SOURCE="' + str(ota) + '"',
             HERE / 'fixture.cpp', OUT / 'cjson.o', *LINK, '-o', binary])
    return binary


def inputs(depfiles):
    paths = {Path(__file__).resolve(), HERE / 'fixture.cpp', SOURCE, OTA_SOURCE,
             ROOT / 'dependencies.lock', CJSON / 'cJSON.c', CJSON / 'cJSON.h'}
    for dep in depfiles:
        contents = dep.read_text().replace('\\\n', ' ')
        for name in shlex.split(contents.partition(':')[2]):
            path = Path(name)
            paths.add(path.resolve() if path.is_absolute() else (HERE / path).resolve())
    paths.update((HERE / 'stubs').rglob('*.h'))
    paths.update((HERE / 'stubs').rglob('*.hpp'))
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def replace_once(text, old, new, tag):
    if isinstance(old, re.Pattern):
        if len(list(old.finditer(text))) != 1:
            raise RuntimeError('mutation needs a unique source anchor: ' + tag)
        return old.sub(new, text, count=1)
    if text.count(old) != 1:
        raise RuntimeError('mutation needs a unique source anchor: ' + tag)
    return text.replace(old, new)


def rejected(binary, case, tag):
    result = command([binary, case], False)
    if result.returncode != 1 or 'FAIL oracle=' + case + ':' not in result.stderr:
        raise RuntimeError('control did not fail the selected behavioral oracle: ' + tag + '\n'
                           + result.stdout + result.stderr)
    print('NEGATIVE CONTROL ' + tag + ': ' + result.stderr.strip())
    return {'name': tag, 'case': case, 'exit_code': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr}


compiler = command([CXX, '--version']).stdout.strip()
command([CC, '-MMD', '-MF', OUT / 'cjson.d', '-c', CJSON / 'cJSON.c', '-I' + str(CJSON),
         *SAN, '-o', OUT / 'cjson.o'])
command([CXX, *FLAGS, '-MM', '-MF', OUT / 'preflight.d',
         '-DCONFIG_HTTP_PRODUCTION_SOURCE="' + str(SOURCE) + '"',
         '-DOTA_HTTP_PRODUCTION_SOURCE="' + str(OTA_SOURCE) + '"', HERE / 'fixture.cpp'])
before = inputs([OUT / 'preflight.d', OUT / 'cjson.d'])
source_text, ota_text = SOURCE.read_text(), OTA_SOURCE.read_text()
binary = compile(SOURCE, 'production')
legacy = command([binary, 'legacy_cases'])
if 'PASS total=13 assertions=5233\n' not in legacy.stdout:
    raise RuntimeError('the original thirteen behavioral groups changed their assertion inventory\n'
                       + legacy.stdout)
print('PRESERVED ORIGINAL CASES ' + legacy.stdout.splitlines()[-1])
baseline = command([binary])
print(baseline.stdout, end='')

# The original production TU must pass real positive setters before failing the two named
# regression oracles. Compiling failures, arbitrary signals and timeouts never count as controls.
original_commit = '819a2c98ad7e331ce1527ca85f4acb7127e55734'
original = command(['git', '-c', 'core.fsmonitor=false', '-C', ROOT, 'show',
                    original_commit + ':main/http_config.cpp']).stdout
original_path = OUT / 'original.cpp'
original_path.write_text(original)
original_binary = compile(original_path, 'original')
original_positive = command([original_binary, 'valid_setters'])
print('ORIGINAL POSITIVE CONTROL ' + original_positive.stdout.strip())
controls = [rejected(original_binary, 'wrong_types', 'original-present-type'),
            rejected(original_binary, 'integer_fields', 'original-fractional-integer')]

# Mutant headers bind explicitly at their one quoted include; the entire HTTP TU still compiles.
mutations = [
    ('leaked_request_scratch', 'source', re.compile(r'error\s*= root \? nullptr : "bad json";'),
     'static_cast<void>(body.release());\n    error = root ? nullptr : "bad json";', 'request_scratch'),
    ('swallowed_request_scratch_oom', 'source',
     'std::unique_ptr<char[]> body(new char[capacity]);',
     'std::unique_ptr<char[]> body;\n    try { body.reset(new char[capacity]); }\n'
     '    catch (const std::bad_alloc&) { error = "bad body"; return nullptr; }', 'request_scratch'),
    ('changed_request_capacity', 'source', 'http_read_body(req, body.get(), capacity)',
     'http_read_body(req, body.get(), capacity - 1)', 'request_scratch'),
    ('ignore_present_types', 'source',
     'if (!http_config_field_valid(expected, actual, item ? item->valuedouble : 0.0))',
     'if ((static_cast<void>(expected), static_cast<void>(actual), false))', 'wrong_types'),
    ('truncate_integer', 'fields', 'if (static_cast<double>(whole) != value) return false;', '', 'integer_fields'),
    ('missing_rejected', 'fields',
     'if (actual == HttpConfigFieldType::Missing) return true;',
     'if (actual == HttpConfigFieldType::Missing) return false;', 'missing_and_disabled'),
    ('ignore_wifi_save_failure', 'wifi', 'if (!config_save(c)) {',
     'if ((static_cast<void>(config_save(c)), false)) {', 'persistence_failure'),
    ('early_reference_runtime', 'source',
     'if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");\n    mqtt_reference_reconfigure();',
     'mqtt_reference_reconfigure();\n    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");',
     'persistence_failure'),
    ('ignore_env_preflight', 'env', 'if (!env_allowed) return env_result;',
     'static_cast<void>(env_allowed); static_cast<void>(env_result);', 'preflight_failures'),
    ('mix_durability_domains', 'source',
     'if (!set_hp_update_domains_compatible(x10a_sent, homehub_sent)) {',
     'if ((static_cast<void>(set_hp_update_domains_compatible(x10a_sent, homehub_sent)), false)) {',
     'hp_revisions'),
    ('query_presence_permission', 'ota', 'downgrade = query_flag_on(downgrade_text);',
     'downgrade = true;', 'query_flags'),
    ('nonobject_root', 'json', 'if (!json_payload_is_object(payload)) return nullptr;', '', 'ingress'),
    ('escaped_zero', 'payload', 'if (all_zero) return false;', 'static_cast<void>(all_zero);', 'ingress'),
    ('ignore_factory_reset_after_delay', 'source',
     'if (nvs_restart_held_by_factory_reset("config")) return;', '', 'factory_reset_reboot'),
    ('check_factory_reset_before_delay', 'source',
     'vTaskDelay(pdMS_TO_TICKS(400));\n    if (nvs_restart_held_by_factory_reset("config")) return;',
     'if (nvs_restart_held_by_factory_reset("config")) return;\n    vTaskDelay(pdMS_TO_TICKS(400));',
     'factory_reset_reboot'),
    ('board_conflict_is_write_failure', 'board',
     'if (!config_save(c)) return send_local_pins_save_failure(req, c);',
     'if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");',
     'local_pin_reconcile'),
    ('env_conflict_is_write_failure', 'env',
     'if (!config_save(c)) return send_local_pins_save_failure(req, c);',
     'if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");',
     'local_pin_reconcile'),
    ('copy_config_after_failed_pin_save', 'pins',
     'const ConfigLinkSnapshot link = config_link_snapshot();',
     'const Config link = config();', 'local_pin_reconcile'),
    ('write_failure_is_pin_conflict', 'pins',
     'return send_err(req, "500 Internal Server Error", "config write failed");',
     'return send_err(req, "409 Conflict", "config write failed");', 'local_pin_reconcile'),
    ('allow_reconciled_pin_collision', 'transaction',
     'if (config_reconcile_breaks_local_pins(requested, c)) {',
     'if ((static_cast<void>(requested), false)) {', 'local_pin_reconcile'),
]
for tag, target, old, new, case in mutations:
    config_source, ota_source = SOURCE, OTA_SOURCE
    if target in ('source', 'wifi', 'env', 'board', 'pins'):
        text = source_text
        if target in ('wifi', 'env', 'board', 'pins'):
            function = {'wifi': 'set_wifi', 'env': 'set_env3', 'board': 'set_board',
                        'pins': 'send_local_pins_save_failure'}[target]
            start = text.index('static esp_err_t ' + function + '(')
            end = text.index('\nstatic ', start + 1) if target != 'wifi' else text.index('\n// ── /set_mqtt', start)
            scope = replace_once(text[start:end], old, new, tag)
            text = text[:start] + scope + text[end:]
        else:
            text = replace_once(text, old, new, tag)
        config_source = OUT / (tag + '.cpp')
        config_source.write_text(text)
    elif target == 'ota':
        ota_source = OUT / (tag + '.cpp')
        ota_source.write_text(replace_once(ota_text, old, new, tag))
    else:
        if target in ('payload', 'transaction'):
            # Bind the mutated production header closure for BOTH complete TUs, so a quoted
            # config.hpp include or #pragma once cannot retain an original second definition.
            copied_main = OUT / tag / 'main'
            for path in (ROOT / 'main').rglob('*'):
                if path.is_file() and path.suffix in ('.hpp', '.h'):
                    copied = copied_main / path.relative_to(ROOT / 'main')
                    copied.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, copied)
            mutated_header = copied_main / ('logic/payload_complete.hpp' if target == 'payload'
                                           else 'logic/config_transaction.hpp')
            mutated_header.write_text(replace_once(mutated_header.read_text(), old, new, tag))
            config_source, ota_source = copied_main / 'http_config.cpp', copied_main / 'http_ota.cpp'
            config_source.write_text(source_text)
            ota_source.write_text(ota_text)
            controls.append(rejected(compile(config_source, tag, ota_source, copied_main), case, tag))
            continue
        if target == 'fields':
            original_header = ROOT / 'main/logic/http_config_fields.hpp'
            replacement_header = OUT / (tag + '.hpp')
            replacement_header.write_text(replace_once(original_header.read_text(), old, new, tag))
            include = '"logic/http_config_fields.hpp"'
        else:
            guard = (ROOT / 'main/json_guard.hpp').read_text()
            replacement_header = OUT / (tag + '.hpp')
            replacement_header.write_text(replace_once(guard, old, new, tag))
            include = '"json_guard.hpp"'
        config_source = OUT / (tag + '.cpp')
        config_source.write_text(replace_once(source_text, include, json.dumps(str(replacement_header)), tag))
    controls.append(rejected(compile(config_source, tag, ota_source), case, tag))

after = inputs([OUT / 'production.d', OUT / 'cjson.d'])
if after != before:
    raise RuntimeError('compile inputs changed during the run')
record = {'compiler': compiler, 'sanitizer': args.sanitizer, 'commands': commands,
          'baseline_stdout': baseline.stdout, 'preserved_original_case_stdout': legacy.stdout,
          'original_commit': original_commit,
          'original_sha256': hashlib.sha256(original.encode()).hexdigest(),
          'original_positive_stdout': original_positive.stdout,
          'negative_controls': controls, 'input_sha256': after,
          'claim_limits': ['Complete production http_config.cpp and http_ota.cpp compile; actual setter handlers and ota_do execute.',
                           'Real resolved cJSON, JsonGuard, shared ingress, pure validators, config_save_transaction and config_commit_detected_link_transaction execute.',
                           'Factory reset latch and config_link_snapshot are allocation-free recording adapters; actual HTTP checks after the delay execute.',
                           'The fixture passes no load-yield record to the transaction; production config.cpp s_load_yield lifecycle and persisted yielded pins belong to CFG-03.',
                           'HTTP reads/replies, SDK event delivery, network/syscalls, sensors, runtime reconfiguration and atomic entry writes are recording adapters.',
                           'No real NVS failure, power loss, RTOS timing, live broker/sensor, physical side effect, target heap/stack or rendered UI proof.']}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + name + '\n' for name, sha in after.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print('RECORDED ' + str(len(after)) + ' exact compile inputs: ' + str(OUT / 'evidence.json'))
print('OUTPUT ' + str(OUT))
