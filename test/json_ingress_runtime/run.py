#!/usr/bin/env python3
"""Exercise the production HTTP JSON adapter with the build-resolved cJSON lexer."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--real-cjson", type=Path, required=True)
args = parser.parse_args()
root = HERE.parents[1]
cjson = (root / args.real_cjson).resolve()
if cjson != (root / "managed_components/espressif__cjson/cJSON").resolve():
    parser.error("use this build's lock-resolved cJSON directory")
source = root / "main/json_guard.hpp"
inputs = [source, root / "main/logic/payload_complete.hpp", root / "dependencies.lock",
          HERE / "fixture.cpp", cjson / "cJSON.c", cjson / "cJSON.h"]
before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
with tempfile.TemporaryDirectory(prefix="daikin-json-runtime-") as output:
    output = Path(output)
    def execute(command):
        return subprocess.run(list(map(str, command)), cwd=root, capture_output=True,
                              text=True, timeout=30)
    c = execute([os.environ.get("CC", "cc"), "-c", cjson / "cJSON.c", "-I" + str(cjson),
                 "-o", output / "cjson.o"])
    assert c.returncode == 0, c.stdout + c.stderr
    def compile(header, name):
        binary = output / name
        result = execute([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra",
                          "-Werror", '-DJSON_GUARD_SOURCE="' + str(header) + '"',
                          "-I" + str(root / "main"), "-I" + str(cjson),
                          HERE / "fixture.cpp", output / "cjson.o", "-o", binary])
        assert result.returncode == 0, result.stdout + result.stderr
        return binary
    result = execute([compile(source, "production")])
    assert result.returncode == 0, result.stdout + result.stderr
    print(result.stdout.strip())
    original = source.read_text()
    guard = "    if (!json_payload_is_object(payload)) return nullptr;\n"
    assert original.count(guard) == 1
    mutated = output / "untyped-json.hpp"
    mutated.write_text(original.replace(guard, ""))
    result = execute([compile(mutated, "mutation")])
    assert result.returncode == 1 and "FAIL configuration_object_root_required" in result.stderr, \
        "object-root mutation must fail its named oracle: " + result.stdout + result.stderr
    print("REJECTED untyped configuration root: configuration_object_root_required")
    helper = root / "main/logic/payload_complete.hpp"
    string_guard = "!json_payload_strings_ok(payload) ||"
    assert helper.read_text().count(string_guard) == 1
    unsafe_helper = output / "unsafe-payload.hpp"
    unsafe_helper.write_text(helper.read_text().replace(string_guard, ""))
    unsafe_header = output / "unsafe-json.hpp"
    unsafe_header.write_text(original.replace('"logic/payload_complete.hpp"',
                                              '"' + str(unsafe_helper) + '"'))
    result = execute([compile(unsafe_header, "string-mutation")])
    assert result.returncode == 31 and \
        "FAIL unrepresentable_strings_rejected_before_parser" in result.stderr, \
        "string preflight mutation must fail its named oracle: " + result.stdout + result.stderr
    print("REJECTED missing string preflight: unrepresentable_strings_rejected_before_parser")
assert all(hashlib.sha256(p.read_bytes()).hexdigest() == value for p, value in before.items())
print("cJSON.c sha256=" + before[cjson / "cJSON.c"])
