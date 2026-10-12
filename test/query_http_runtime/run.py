#!/usr/bin/env python3
"""Run the complete /hp/query production HTTP TU with the resolved real cJSON parser."""
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
parser.add_argument('--real-cjson', type=Path,
                    help='Unmodified lock-resolved cJSON source export; default is managed component')
parser.add_argument('--sanitizer', choices=['none', 'undefined'], default='none')
parser.add_argument('--baseline-expect-defect', action='store_true',
                    help='Record the named fractional/defaulting defect in a frozen older source tree')
args = parser.parse_args()
ROOT = args.root.resolve()
SOURCE = ROOT / 'main/http_config.cpp'
if not SOURCE.is_file():
    parser.error('--root must name the daikin-altherma-esp32 source tree')
CJSON = (args.real_cjson or ROOT / 'managed_components/espressif__cjson/cJSON').resolve()
if not (CJSON / 'cJSON.c').is_file() or not (CJSON / 'cJSON.h').is_file():
    parser.error('the build-resolved cJSON.c and cJSON.h must be available locally')
header = (CJSON / 'cJSON.h').read_text()
if not all(re.search(r'#define CJSON_VERSION_' + name + r'\s+' + value + r'\b', header)
           for name, value in [('MAJOR', '1'), ('MINOR', '7'), ('PATCH', '19')]):
    parser.error('cJSON source does not match the lock-resolved 1.7.19 API')
if 'version: 1.7.19~2' not in (ROOT / 'dependencies.lock').read_text():
    parser.error('update the explicit cJSON provenance check when the production lock changes')
OUT = Path(tempfile.mkdtemp(prefix='daikin-query-http-runtime-'))
CC, CXX = os.environ.get('CC', 'cc'), os.environ.get('CXX', 'c++')
SAN = ['-fsanitize=undefined'] if args.sanitizer == 'undefined' else []
FLAGS = ['-std=c++20', '-O0', '-g', '-ffunction-sections', '-fdata-sections',
         '-Wall', '-Wextra', '-Wno-unused-parameter', *SAN,
         '-I' + str(HERE / 'stubs'), '-I' + str(ROOT / 'main'), '-I' + str(CJSON)]
LINK = ['-Wl,-dead_strip'] if sys.platform == 'darwin' else ['-Wl,--gc-sections']
commands = []


def command(argv, require_success=True):
    argv = list(map(str, argv))
    commands.append(shlex.join(argv))
    result = subprocess.run(argv, cwd=HERE, capture_output=True, text=True, timeout=60)
    if require_success and result.returncode:
        raise RuntimeError(shlex.join(argv) + '\n' + result.stdout + result.stderr)
    return result


def compile(source, tag, include_main=None):
    binary = OUT / tag
    extra = ['-I' + str(include_main)] if include_main else []
    command([CXX, *extra, *FLAGS, '-MMD', '-MF', OUT / (tag + '.d'),
             '-DQUERY_HTTP_PRODUCTION_SOURCE="' + str(source) + '"',
             HERE / 'fixture.cpp', OUT / 'cjson.o', *LINK, '-o', binary])
    return binary


def inputs(depfiles, production_source=SOURCE):
    paths = {Path(__file__).resolve(), HERE / 'fixture.cpp', production_source, ROOT / 'dependencies.lock',
             CJSON / 'cJSON.c', CJSON / 'cJSON.h'}
    metadata = CJSON.parent / 'idf_component.yml'
    if metadata.is_file():
        paths.add(metadata)
    for dep in depfiles:
        contents = dep.read_text().replace('\\\n', ' ')
        for name in shlex.split(contents.partition(':')[2]):
            path = Path(name)
            paths.add(path.resolve() if path.is_absolute() else (HERE / path).resolve())
    paths.update((HERE / 'stubs').rglob('*.h'))
    paths.update((HERE / 'stubs').rglob('*.hpp'))
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def mutate(tag, old, new):
    if source_text.count(old) != 1:
        raise RuntimeError('mutation needs a unique source anchor: ' + tag)
    changed = OUT / (tag + '.cpp')
    changed.write_text(source_text.replace(old, new))
    return changed


compiler = command([CXX, '--version']).stdout.strip()
command([CC, '-MMD', '-MF', OUT / 'cjson.d', '-c', CJSON / 'cJSON.c',
         '-I' + str(CJSON), *SAN, '-o', OUT / 'cjson.o'])
command([CXX, *FLAGS, '-MM', '-MF', OUT / 'preflight.d',
         '-DQUERY_HTTP_PRODUCTION_SOURCE="' + str(SOURCE) + '"', HERE / 'fixture.cpp'])
before = inputs([OUT / 'preflight.d', OUT / 'cjson.d'])
source_text = SOURCE.read_text()
binary = compile(SOURCE, 'production')
results = []
if args.baseline_expect_defect:
    result = command([binary, 'fractional_fields_rejected_before_handoff'], False)
    if result.returncode != 1 or ('FAIL oracle=fractional_fields_rejected_before_handoff: '
                                  'invalid request reached UART handoff/store') not in result.stderr:
        raise RuntimeError('older baseline did not reproduce the expected defect\n' +
                           result.stdout + result.stderr)
    baseline = result.stdout + result.stderr
    print('CONFIRMED BASELINE DEFECT ' + result.stderr.strip())
else:
    result = command([binary])
    baseline = result.stdout
    print(result.stdout, end='')
    mutations = [
        ('truncate_integer_fields',
         'return cJSON_IsNumber(item) && probe_integer_value(item->valuedouble, out);',
         'if (!cJSON_IsNumber(item)) return false; out = item->valueint; return true;',
         'strict_reg_1.9'),
        ('default_invalid_present_fields',
         'const cJSON* item = cJSON_GetObjectItem(j, key);\n        if (!item) {',
         'const cJSON* item = cJSON_GetObjectItem(j, key);\n'
         '        if (!item || !cJSON_IsNumber(item)) {', 'strict_offset_null'),
        ('skip_validation', 'const ProbeReject reject = probe_validate(q);',
         'const ProbeReject reject = ProbeReject::None;', 'request_bounds_before_handoff'),
        ('busy_is_success', 'return send_err(req, "409 Conflict", "another register probe is in flight");',
         'return send_err(req, "200 OK", "another register probe is in flight");',
         'scheduler_status_http_mapping'),
        ('lost_local_failure_status',
         'reply.status == ProbeStatus::NoLink || reply.status == ProbeStatus::Timeout',
         'false', 'scheduler_status_http_mapping'),
        ('ignore_reply_slice_bound',
         'const bool sliced = reply.status == ProbeStatus::Ok &&\n'
         '                        probe_slice_fits(q.offset, q.size, reply.payload_len);',
         'const bool sliced = reply.status == ProbeStatus::Ok;', 'slice_status_emitted_once'),
        ('frame_tail_truncated',
         'hex_render(reply.frame, reply.frame_len, hex, static_cast<int>(sizeof(hex)));',
         'hex_render(reply.frame, reply.frame_len - 1, hex, static_cast<int>(sizeof(hex)));',
         'maximum_frame_preserved'),
        ('sweep_not_executed', 'if (q.conv == PROBE_SWEEP) {',
         'if (false) {', 'absent_optional_defaults'),
        ('unknown_converter_hidden', 'if (unimplemented) {', 'if (false) {',
         'unknown_converter_reported'),
        ('wrong_register_handoff', 'hp_probe_run(static_cast<uint8_t>(q.reg), reply, 3000);',
         'hp_probe_run(0, reply, 3000);', 'absent_optional_defaults'),
        ('duplicate_status', 'out += probe_status_name(status);',
         'out += probe_status_name(status); out += "\\\",\\\"status\\\":\\\"ok";',
         'slice_status_emitted_once'),
    ]
    request_start = source_text.index('    ProbeRequest q;', source_text.index('static esp_err_t hp_query_probe'))
    request_end = source_text.index('    j.reset();', request_start) + len('    j.reset();')
    mutations.append((
        'legacy_extraction_restored', source_text[request_start:request_end],
        '    ProbeRequest q;\n'
        '    q.reg = ji(j, "reg", -1);\n'
        '    q.offset = ji(j, "offset", 0);\n'
        '    q.size = ji(j, "size", 1);\n'
        '    q.conv = ji(j, "conv", PROBE_SWEEP);\n'
        '    j.reset();', 'fractional_fields_rejected_before_handoff'))
    for tag, old, new, oracle in mutations:
        changed = mutate(tag, old, new)
        mutation_binary = compile(changed, tag)
        result = command([mutation_binary, oracle], False)
        output = result.stdout + result.stderr
        if result.returncode != 1 or 'FAIL oracle=' + oracle + ':' not in output:
            raise RuntimeError('negative control did not fail its named assertion: ' + tag + '\n' + output)
        results.append({'mutation': tag, 'expected_oracle': oracle, 'exit_code': result.returncode,
                        'output': output, 'sha256': hashlib.sha256(changed.read_bytes()).hexdigest(),
                        'input_sha256': inputs([OUT / (tag + '.d'), OUT / 'cjson.d'], changed)})
        print('NEGATIVE CONTROL ' + tag + ': ' + output.strip())

    # Quoted includes in checkup/history load hp_poll.hpp before the route's direct probe include.
    # Copy the complete production header tree, changing only the targeted helper. This binds the
    # mutation transitively instead of silently retaining the actual root header through -I order.
    tag, oracle = 'integer_helper_truncation', 'strict_reg_1.9'
    copied_main = OUT / (tag + '-headers') / 'main'
    for header in (ROOT / 'main').rglob('*.hpp'):
        destination = copied_main / header.relative_to(ROOT / 'main')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(header, destination)
    changed = copied_main / 'http_config.cpp'
    changed.write_text(source_text)
    helper = copied_main / 'logic/hp_probe.hpp'
    guard = '    if (static_cast<double>(parsed) != value) return false;'
    helper_text = helper.read_text()
    if helper_text.count(guard) != 1:
        raise RuntimeError('integer helper mutation needs an exact unique round-trip guard')
    helper.write_text(helper_text.replace(guard, '    /* mutation: permit fractional truncation */'))
    mutation_binary = compile(changed, tag, copied_main)
    result = command([mutation_binary, oracle], False)
    output = result.stdout + result.stderr
    mutation_inputs = inputs([OUT / (tag + '.d'), OUT / 'cjson.d'], changed)
    if any(Path(p).is_relative_to(ROOT / 'main') for p in mutation_inputs if p.endswith('.hpp')):
        raise RuntimeError('helper mutation unexpectedly loaded an original production header')
    if result.returncode != 1 or 'FAIL oracle=' + oracle + ':' not in output:
        raise RuntimeError('helper negative control did not fail its named assertion\n' + output)
    results.append({'mutation': tag, 'expected_oracle': oracle, 'exit_code': result.returncode,
                    'output': output, 'sha256': hashlib.sha256(helper.read_bytes()).hexdigest(),
                    'input_sha256': mutation_inputs})
    print('NEGATIVE CONTROL ' + tag + ': ' + output.strip())

after = inputs([OUT / 'production.d', OUT / 'cjson.d'])
if after != before:
    changed = [p for p in set(before) | set(after) if before.get(p) != after.get(p)]
    raise RuntimeError('compile inputs changed during execution: ' + repr(changed))
head = command(['git', '-c', 'core.fsmonitor=false', '-C', ROOT, 'rev-parse', 'HEAD'], False)
record = {
    'compiler': compiler, 'sanitizers': args.sanitizer, 'commands': commands,
    'baseline': baseline, 'baseline_defect_expected': args.baseline_expect_defect,
    'negative_controls': results, 'input_sha256': after,
    'production_head': head.stdout.strip() if head.returncode == 0 else None,
    'cjson_lock_version': '1.7.19~2',
    'claim_limits': [
        'The complete unextracted http_config.cpp TU compiles. Only the actual static hp_query_probe handler and reachable serializers run; unrelated config handlers are discarded by linker function sections.',
        'Real resolved cJSON.c parsing, JsonGuard preflight, probe validation, converter sweep/decoding, generated registry lookup, escaping, hex rendering and bounded streaming execute.',
        'Adapters replace HTTP body transport/status/type/chunk sending, config snapshots and the hp_probe_run poll/UART handoff; calls to that handoff are counted.',
        'HTTP common OOM/LAN guard, ESP32 scheduling/driver timing, physical UART reply truth, on-device heap/stack, configuration persistence and live browser behavior are not exercised.',
        'Text escaping is also checked through the actual serializer with a synthetic decode label; it is not proof that the shipped catalog produces that label.',
    ],
}
(OUT / 'evidence.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'inputs.sha256').write_text(''.join(sha + '  ' + path + '\n' for path, sha in after.items()))
(OUT / 'commands.txt').write_text('\n'.join(commands) + '\n')
print('RECORDED ' + str(len(after)) + ' exact compile inputs in ' + str(OUT / 'evidence.json'))
print('OUTPUT ' + str(OUT))
