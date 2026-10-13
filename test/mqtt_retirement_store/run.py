#!/usr/bin/env python3
"""Execute the production MQTT retirement NVS adapter with compiling negative controls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=HERE.parents[1])
parser.add_argument('--ubsan', action='store_true')
args = parser.parse_args()
ROOT = args.root.resolve()
OUT = Path(tempfile.mkdtemp(prefix='daikin-mqtt-retirement-store-'))
SAN_FLAGS = ['-fsanitize=undefined', '-fno-sanitize-recover=all'] if args.ubsan else []
inputs = {
    ROOT / 'main/mqtt_retirement_store.cpp': 'adapter.cpp',
    ROOT / 'main/mqtt_retirement_store.hpp': 'mqtt_retirement_store.hpp',
    ROOT / 'main/logic/mqtt_retirement_store.hpp': 'logic/mqtt_retirement_store.hpp',
    ROOT / 'main/logic/config_store.hpp': 'logic/config_store.hpp',
    HERE / 'fixture.cpp': 'fixture.cpp',
    HERE / 'stubs/nvs.h': 'nvs.h',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


input_sha = {str(path): digest(path) for path in inputs}
input_sha[str(HERE / 'run.py')] = digest(HERE / 'run.py')
snapshot = OUT / 'snapshot'
for path, relative in inputs.items():
    target = snapshot / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
    assert digest(target) == input_sha[str(path)], 'snapshot must match the current production input'

commands = []


def execute(command, expected=0):
    commands.append(shlex.join(map(str, command)))
    result = subprocess.run(list(map(str, command)), cwd=ROOT, text=True,
                            capture_output=True, timeout=60)
    if expected is not None and result.returncode != expected:
        raise RuntimeError(f'{shlex.join(map(str, command))}\n{result.stdout}{result.stderr}')
    return result


def compile_source(directory, name):
    binary = OUT / (name + '.bin')
    execute([os.environ.get('CXX', 'c++'), '-std=c++17', *SAN_FLAGS,
             '-Wall', '-Wextra', '-Werror', '-I' + str(directory),
             f'-DMQTT_RETIREMENT_PRODUCTION_SOURCE="{directory / "adapter.cpp"}"',
             directory / 'fixture.cpp', '-o', binary])
    return binary


scenarios = ['missing', 'read_failures', 'bounded_load', 'save_failures',
             'roundtrip', 'corrupt_load', 'wire_reference', 'codec_boundaries']
binary = compile_source(snapshot, 'production-store')
for scenario in scenarios:
    print(execute([binary, scenario]).stdout.strip())

mutations = [
    ('missing-namespace-as-error', 'missing', 'adapter.cpp',
     'if (opened == ESP_ERR_NVS_NOT_FOUND) return MqttRetirementStoreLoad::Missing;',
     'if (opened == ESP_ERR_NVS_NOT_FOUND) return MqttRetirementStoreLoad::Error;',
     'MISSING_NAMESPACE_IS_MISSING'),
    ('oversized-payload-read', 'bounded_load', 'adapter.cpp',
     'error != ESP_OK || size != MQTT_RETIREMENT_STORE_BYTES', 'error != ESP_OK',
     'OVERSIZED_RECORD_CANNOT_ENTER_FIXED_BUFFER'),
    ('payload-read-error-ignored', 'read_failures', 'adapter.cpp',
     'if (error != ESP_OK) return MqttRetirementStoreLoad::Error;', '',
     'PAYLOAD_READ_ERROR_REJECTED'),
    ('set-return-ignored', 'save_failures', 'adapter.cpp',
     'esp_err_t error = ::nvs_set_blob(handle, KEY, bytes, sizeof(bytes));',
     '(void)::nvs_set_blob(handle, KEY, bytes, sizeof(bytes));\n    esp_err_t error = ESP_OK;',
     'SET_ERROR_CANNOT_REPORT_SAVED'),
    ('commit-return-ignored', 'save_failures', 'adapter.cpp',
     'if (error == ESP_OK) error = ::nvs_commit(handle);',
     'if (error == ESP_OK) (void)::nvs_commit(handle);',
     'COMMIT_ERROR_CANNOT_REPORT_SAVED'),
    ('namespace-config-collision', 'roundtrip', 'adapter.cpp',
     'NAMESPACE = "mqtt_retire"', 'NAMESPACE = "daik_cfg"',
     'DEDICATED_NAMESPACE_NEVER_SERVICE_CONFIG'),
    ('key-config-collision', 'roundtrip', 'adapter.cpp',
     'KEY       = "provenance"', 'KEY       = "cfg"', 'DEDICATED_KEY_NEVER_CONFIG_OR_LINK'),
    ('checksum-ignored', 'corrupt_load', 'logic/mqtt_retirement_store.hpp',
     'if (config_crc32(data, size - 4) != wanted_crc) return false;',
     '(void)wanted_crc;', 'CORRUPT_RECORD_REJECTED'),
    ('unknown-version-accepted', 'corrupt_load', 'logic/mqtt_retirement_store.hpp',
     'data[4] != 1', 'false', 'UNKNOWN_VERSION_REJECTED'),
    ('partial-output-before-validation', 'corrupt_load', 'logic/mqtt_retirement_store.hpp',
     'MqttRetirementRecord staged{};\n    char*                destinations[] = {staged.base, staged.board_id, staged.profile_id};\n    for (size_t i = 0; i < 3; ++i) {',
     'out = {};\n    MqttRetirementRecord staged{};\n    char*                destinations[] = {staged.base, staged.board_id, staged.profile_id};\n    for (size_t i = 0; i < 3; ++i) {',
     'LOAD_FAILURE_NEVER_EXPOSES_PARTIAL_RECORD'),
    ('noncanonical-padding-accepted', 'corrupt_load', 'logic/mqtt_retirement_store.hpp',
     '(j >= length && field[j] != 0)', 'false', 'NONCANONICAL_PADDING_REJECTED'),
]
controls = {}
for name, scenario, relative, old, new, assertion in mutations:
    directory = OUT / name
    shutil.copytree(snapshot, directory)
    target = directory / relative
    source = target.read_text()
    assert source.count(old) == 1, f'{name}: mutation must target exactly one production condition'
    target.write_text(source.replace(old, new))
    mutated_binary = compile_source(directory, name)
    result = execute([mutated_binary, scenario], expected=None)
    assert result.returncode != 0 and f'FAIL {assertion}' in result.stderr, \
        f'{name}: compiling mutation escaped the named semantic assertion\n{result.stdout}{result.stderr}'
    controls[name] = assertion
    print(f'PASS negative-control {name}: {assertion}')

assert all(digest(Path(path)) == before for path, before in input_sha.items()), \
    'a fixture or production input changed while this witness ran'
report = {
    'input_sha256': input_sha,
    'scenarios': scenarios,
    'compiling_negative_controls': controls,
    'ubsan': args.ubsan,
    'commands': commands,
    'nvs_model': 'mocked write-through; no real reboot or power-loss claim',
}
(OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'PASS {len(scenarios)} production NVS scenarios, {len(controls)} compiling negative controls')
print(f'Evidence: {OUT / "report.json"}')
