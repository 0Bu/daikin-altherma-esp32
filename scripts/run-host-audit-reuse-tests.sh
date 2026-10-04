#!/usr/bin/env bash
# Prove ordinary host audits use current inputs while explicit mutation-fixture reuse stays cheap.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

root = Path.cwd()
compiler = shutil.which("g++") or shutil.which("clang++")
assert compiler, "host audit reuse tests need a C++17 compiler"
false_command = shutil.which("false")
assert false_command, "host audit reuse tests need the false command"

with tempfile.TemporaryDirectory(prefix="daikin-host-audit-reuse-") as temporary:
    work = Path(temporary)
    for relative in ("main", "docs", "tools/presenter", "tools/ui", "tools/docs"):
        shutil.copytree(root / relative, work / relative)
    for relative in ("README.md", "test/presenter_golden_dump.cpp",
                     "scripts/check-presenter-parity.sh", "scripts/run-doc-entity-audit.sh"):
        destination = work / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, destination)

    log = work / "compiler-calls.log"
    wrapper = work / "counting-compiler"
    wrapper.write_text("""#!/usr/bin/env python3
import os
import sys
with open(os.environ["HOST_AUDIT_COMPILE_LOG"], "a") as output:
    output.write("compile\\n")
os.execv(os.environ["HOST_AUDIT_CXX"], [os.environ["HOST_AUDIT_CXX"], *sys.argv[1:]])
""")
    wrapper.chmod(0o755)
    environment = {**os.environ, "CXX": str(wrapper), "HOST_AUDIT_CXX": compiler,
                   "HOST_AUDIT_COMPILE_LOG": str(log)}

    def calls():
        return len(log.read_text().splitlines()) if log.exists() else 0

    def run(label, command, *, expected=0, diagnostic=None, env=environment):
        result = subprocess.run(command, cwd=work, env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
        correct_status = result.returncode != 0 if expected == "failure" else result.returncode == expected
        assert correct_status, f"{label}: exit {result.returncode}, expected {expected}\n{result.stdout}"
        if diagnostic:
            assert diagnostic in result.stdout, f"{label}: missing {diagnostic!r}\n{result.stdout}"
        print(f"PASS  {label}")

    cases = (
        {
            "name": "presenter",
            "script": "scripts/check-presenter-parity.sh",
            "header": "main/logic/lwt_select.hpp",
            "original": 'return lwt_is_water(l) && !lwt_is_reject(l) && lwt_ci_contains(l, "r1t");',
            "mutation": 'return lwt_ci_contains(l, "r1t");',
            "diagnostic": "disagreement(s)",
            "option": "--golden",
            "artifact": "build_mock/presenter_golden.tsv",
        },
        {
            "name": "docs",
            "script": "scripts/run-doc-entity-audit.sh",
            "header": "main/logic/discovery.hpp",
            "original": 'inline std::string object_id(const char* label) { return ha_slug(label); }',
            "mutation": 'inline std::string object_id(const char* label) { return ha_slug(label) + "_changed"; }',
            "diagnostic": "[E-ID]",
            "option": "--binary",
            "artifact": "build_mock/entity_id_audit",
        },
    )

    for case in cases:
        name = case["name"]
        command = ["bash", case["script"]]
        initial_calls = calls()
        run(f"{name}: pristine audit", command)
        run(f"{name}: repeated default recompiles", command)
        assert calls() == initial_calls + 2, f"{name}: default reused a previous binary"

        header = work / case["header"]
        original_text = header.read_text()
        original_stat = header.stat()
        assert case["original"] in original_text, f"{name}: mutation no longer applies"
        header.write_text(original_text.replace(case["original"], case["mutation"], 1))
        os.utime(header, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        run(f"{name}: changed content with preserved timestamp is rejected", command,
            expected=1, diagnostic=case["diagnostic"])
        assert calls() == initial_calls + 3, f"{name}: changed input did not recompile"

        header.write_text(original_text)
        os.utime(header, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        if name == "presenter":
            # Even an existing TSV must be regenerated from the current default compilation.
            (work / case["artifact"]).write_text("poisoned-old-vectors\n")
        run(f"{name}: restored old content is rebuilt", command)
        assert calls() == initial_calls + 4, f"{name}: restored input did not recompile"

        header.unlink()
        run(f"{name}: removed required input is rejected", command, expected="failure",
            diagnostic=header.name)
        assert calls() == initial_calls + 5, f"{name}: removed input did not reach compilation"
        header.write_text(original_text)
        os.utime(header, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        run(f"{name}: input restoration recovers", command)

        invalid_compiler = {**environment, "CXX": false_command}
        run(f"{name}: warm default honors changed compiler", command,
            expected="failure", env=invalid_compiler)
        reuse_calls = calls()
        run(f"{name}: explicit fixture reuse needs no compiler",
            [*command, case["option"], str(work / case["artifact"])], env=invalid_compiler)
        assert calls() == reuse_calls, f"{name}: explicit fixture reuse compiled again"
        run(f"{name}: missing reuse artifact fails closed",
            [*command, case["option"], str(work / "missing-artifact")], expected=2)
        run(f"{name}: extra reuse argument fails closed",
            [*command, case["option"], str(work / case["artifact"]), "extra"], expected=2)
        run(f"{name}: missing reuse argument fails closed", [*command, case["option"]], expected=2)

    # The docs canaries must not pass merely because their pristine input is already invalid.
    guide = work / "docs/HOME_ASSISTANT.md"
    guide.write_text(guide.read_text() + "\nsensor.daikin_altherma_missing_fixture_entity\n")
    run("docs selftest: invalid pristine tree fails before mutations",
        ["bash", "tools/docs/selftest.sh"], expected=1, diagnostic="not green on the pristine tree")

print("host audit reuse regression tests passed")
PY
