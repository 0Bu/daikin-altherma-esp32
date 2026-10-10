#!/usr/bin/env python3
"""Synthetic-only proof through the real pinned decoder; no board or real RAM dump.

All compiled ELF and raw fixture files are private temporary files, never firmware artifacts.
The deliberately single-frame fixture proves symbolization, not real crash capture or dump age.
"""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
from io import StringIO
import lzma
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import textwrap
from tempfile import TemporaryDirectory

import esp_coredump
from esp_coredump.corefile.elf import ESPCoreDumpElfFile, ElfFile, EspTaskStatus
from esp_coredump.corefile.loader import EspCoreDumpLoader, EspCoreDumpV2_2_Header
from esp_coredump.corefile.xtensa import Esp32S3Methods, REG_NUM, REG_PC_IDX, REG_PS_IDX, REG_AR_START_IDX

import decode


def sdk_descriptors(directory: Path, compiler: str, identity: bytes, version: int):
    """Compile the actual pinned writer's type, rather than copying the parser's shorter view."""
    sdk = Path(os.environ["IDF_PATH"]) / "components/espcoredump/src/core_dump_elf.c"
    source = sdk.read_text()
    macro = re.search(r"#define ELF_APP_SHA256_SIZE\s+(\d+)", source)
    declaration = re.search(
        r"typedef struct \{\s*uint32_t version;[^\n]*\s*"
        r"uint8_t app_elf_sha256\[ELF_APP_SHA256_SIZE\];[^\n]*\s*"
        r"\} core_dump_elf_version_info_t;", source,
    )
    if not macro or not declaration or "sizeof(self->elf_version_info)" not in source:
        raise AssertionError("Pinned SDK writer layout changed; reassess the provenance policy")
    if "core_dump_elf_t self = { 0 };" not in source or "strlcpy((char*)self->elf_version_info.app_elf_sha256" not in source:
        raise AssertionError("Pinned SDK writer field initialization changed")
    probe = directory / "sdk-layout.c"
    definitions = []
    for name, value in (("prefix", identity[:9]), ("full", identity)):
        initializer = ",".join(str(byte) for byte in value)
        definitions.append(
            f'const core_dump_elf_version_info_t {name} __attribute__((section(".fixture_{name}"))) '
            f'= {{ {version}u, {{ {initializer} }} }};'
        )
    probe.write_text(
        "#include <stdint.h>\n#include <stddef.h>\n" + macro.group(0) + "\n"
        + declaration.group(0) + "\n"
        + 'const uint32_t layout[] __attribute__((section(".fixture_layout"))) = '
        + "{sizeof(core_dump_elf_version_info_t), offsetof(core_dump_elf_version_info_t, app_elf_sha256), "
        + "sizeof(((core_dump_elf_version_info_t*)0)->app_elf_sha256)};\n"
        + "\n".join(definitions) + "\n"
    )
    target = directory / "sdk-layout.o"
    subprocess.run([compiler, "-c", str(probe), "-o", str(target)], check=True)
    # The decoder intentionally skips zero-address sections in relocatable objects; use the
    # actual target binutils to extract the compile-time descriptor/layout bytes instead.
    sections = {}
    arguments = [compiler.removesuffix("gcc") + "objcopy"]
    for section in ("layout", "prefix", "full"):
        output = directory / f"sdk-{section}.bin"
        arguments.append(f"--dump-section=.fixture_{section}={output}")
    subprocess.run([*arguments, str(target), str(directory / "sdk-layout-copy.o")], check=True)
    for section in ("layout", "prefix", "full"):
        sections[f".fixture_{section}"] = (directory / f"sdk-{section}.bin").read_bytes()
    layout = struct.unpack("<III", sections[".fixture_layout"])
    if layout != (72, 4, 66):
        raise AssertionError(f"Pinned target ABI differs from decoder policy: {layout}")
    print(f"Pinned SDK writer layout: sizeof={layout[0]}, identity offset={layout[1]}, field={layout[2]}", flush=True)
    return sections[".fixture_prefix"], sections[".fixture_full"]


def create_fixtures(directory: Path) -> None:
    compiler = shutil.which("xtensa-esp32s3-elf-gcc")
    if compiler is None:
        raise RuntimeError("Pinned ESP32-S3 compiler is unavailable")
    source = Path(__file__).with_name("fixture.c")
    for tag, name in ((1, "matching.elf"), (2, "different.elf")):
        subprocess.run(
            [compiler, "-g", "-O0", "-nostdlib", "-fno-builtin", f"-DFIXTURE_TAG={tag}",
             "-Wl,-Ttext=0x42000000", "-Wl,-Tdata=0x3fc80000", "-Wl,-e,_start",
             str(source), "-o", str(directory / name)],
            check=True,
        )
    nm = compiler.removesuffix("gcc") + "nm"
    symbols = {}
    for line in subprocess.check_output([nm, "-n", str(directory / "matching.elf")], text=True).splitlines():
        words = line.split()
        if len(words) == 3:
            symbols[words[2]] = int(words[0], 16)
    executable = ElfFile(str(directory / "matching.elf"))
    identity = executable.sha256.hex().encode()
    version = (9 << 16) | EspCoreDumpLoader.ELF_SHA256_V2_2
    sdk_prefix, sdk_full = sdk_descriptors(directory, compiler, identity, version)
    registers = [0] * REG_NUM
    registers[REG_PC_IDX] = symbols["fixture_leaf"]
    registers[REG_PS_IDX] = 0x40000
    registers[6] = 1
    registers[REG_AR_START_IDX + 1] = 0x3fc81100
    prstatus = Esp32S3Methods.build_prstatus_data(symbols["fixture_tcb"], registers)
    note = EspCoreDumpLoader._build_note_section
    task_info = EspTaskStatus.build({
        "task_index": 0, "task_flags": 0, "task_tcb_addr": symbols["fixture_tcb"],
        "task_stack_start": 0x3fc81000, "task_stack_len": 512,
        "task_name": b"fixture_task".ljust(16, b"\0"),
    })

    def raw_fixture(name, sha=identity[:9], notes=1, note_version=version, descriptor_size=72,
                    descriptor=None):
        core = ESPCoreDumpElfFile()
        for section in executable.sections:
            if section.name == ".data":
                core.add_segment(section.addr, section.data, ElfFile.PT_LOAD, 6)
        core.add_segment(0x3fc81000, bytes(512), ElfFile.PT_LOAD, 6)
        notes_data = note("CORE", 1, prstatus)
        notes_data += note("ESP_TASK_INFO", ESPCoreDumpElfFile.PT_ESP_TASK_INFO, task_info)
        if descriptor is None:
            descriptor = struct.pack("<I", note_version) + sha.ljust(66, b"\0") + bytes(2)
        descriptor = descriptor[:descriptor_size].ljust(descriptor_size, b"\0")
        for _ in range(notes):
            notes_data += note("ESP_CORE_DUMP_INFO", ESPCoreDumpElfFile.PT_ESP_INFO, descriptor)
        core.add_segment(0, notes_data, ElfFile.PT_NOTE, 0)
        core_path = directory / f"{name}.core.elf"
        core.dump(str(core_path))
        payload = core_path.read_bytes()
        header = EspCoreDumpV2_2_Header.build({
            "tot_len": 12 + len(payload) + 32, "ver": version, "chip_rev": 0,
        })
        raw = header + payload
        (directory / f"{name}.raw").write_bytes(raw + hashlib.sha256(raw).digest())

    raw_fixture("matching", descriptor=sdk_prefix)
    raw_fixture("full-identity", descriptor=sdk_full)
    # C struct tail padding is not an initialized field value contract. It is ignored by policy.
    raw_fixture("nonzero-tail-padding", descriptor=sdk_prefix[:70] + b"\xa5\x5a")
    raw_fixture("missing-identity", notes=0)
    raw_fixture("empty-identity", sha=b"")
    raw_fixture("short-identity", sha=identity[:1])
    raw_fixture("nonhex-identity", sha=b"ggggggggg")
    raw_fixture("duplicate-identity", notes=2)
    raw_fixture("wrong-version", note_version=version ^ 1)
    raw_fixture("wrong-identity", sha=b"deadbeef0")
    raw_fixture("short-descriptor", descriptor_size=8)
    raw_fixture("parser-shaped-68", descriptor_size=68)
    raw_fixture("packed-70", descriptor_size=70)
    raw_fixture("long-descriptor", descriptor_size=76)
    raw_fixture("unterminated-identity", sha=identity + b"aa")
    raw_fixture("overlong-identity", sha=identity + b"a")
    raw_fixture("nonzero-after-terminator", descriptor=sdk_prefix[:69] + b"a" + sdk_prefix[70:])
    data = bytearray((directory / "matching.raw").read_bytes())
    data[-1] ^= 1
    (directory / "invalid-checksum.raw").write_bytes(data)
    (directory / "truncated.raw").write_bytes(data[:23])
    (directory / "invalid-dump.raw").write_bytes(b"synthetic invalid data")
    data = bytearray((directory / "matching.raw").read_bytes())
    data[4:8] = struct.pack("<I", (9 << 16) | 0xFFFF)
    (directory / "unsupported-version.raw").write_bytes(data)


def assert_temporary_cleanup(directory: Path, core_name: str, elf_name: str, expected: bool) -> None:
    scratch = directory / "loader-temporaries"
    scratch.mkdir(exist_ok=True)
    # Redirect the real loader's temporary directory, without replacing its parser or validation.
    original = decode.ESPCoreDumpFileLoader._create_temp_file

    def local_temporary(loader):
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(dir=scratch, delete=False) as temporary:
            loader.temp_files.append(temporary.name)
        return temporary.name

    decode.ESPCoreDumpFileLoader._create_temp_file = local_temporary
    try:
        accepted = False
        try:
            with decode.verified_dump(str(directory / f"{core_name}.raw"), str(directory / elf_name)):
                accepted = True
        except Exception:
            if expected:
                raise
        if accepted != expected:
            raise AssertionError(f"Provenance acceptance violation: {core_name}/{elf_name}")
        if list(scratch.iterdir()):
            raise AssertionError(f"Leaked loader temporary after {core_name}/{elf_name}")
        print(f"Provenance + temporary cleanup: {core_name}/{elf_name}: {'accepted' if accepted else 'rejected'}", flush=True)
    finally:
        decode.ESPCoreDumpFileLoader._create_temp_file = original


def test_subprocess_failure(directory: Path) -> None:
    failing_gdb = directory / "failing-gdb"
    failing_gdb.write_text("#!/bin/sh\nexit 37\n")
    failing_gdb.chmod(0o700)
    original = decode.ESPCoreDumpFileLoader._create_temp_file
    created = []

    def observed_temporary(loader):
        name = original(loader)
        created.append(Path(name))
        return name

    decode.ESPCoreDumpFileLoader._create_temp_file = observed_temporary
    try:
        result = decode.decode("dbg_corefile", str(directory / "matching.raw"),
                               str(directory / "matching.elf"), gdb_path=str(failing_gdb))
        if result != 37:
            raise AssertionError(f"Lost real GDB subprocess exit status: {result}")
        print("Interactive real subprocess exit 37: propagated", flush=True)
        try:
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                decode.decode("info_corefile", str(directory / "matching.raw"),
                              str(directory / "matching.elf"), gdb_path=str(failing_gdb))
        except Exception:
            print("Info-mode early subprocess exit: rejected", flush=True)
        else:
            raise AssertionError("Info-mode early GDB exit was reported as success")
        missing_gdb = directory / "absent-gdb"
        for mode in ("dbg_corefile", "info_corefile"):
            try:
                decode.decode(mode, str(directory / "matching.raw"),
                              str(directory / "matching.elf"), gdb_path=str(missing_gdb))
            except FileNotFoundError:
                if mode != "dbg_corefile":
                    raise
            except ValueError as error:
                if mode != "info_corefile" or "gdb executable could not be resolved" not in str(error):
                    raise
            else:
                raise AssertionError(f"Missing GDB executable did not fail: {mode}")
        if any(path.exists() for path in created):
            raise AssertionError("Loader temporary leaked after subprocess failure")
    finally:
        decode.ESPCoreDumpFileLoader._create_temp_file = original


def test_info_mi_failures(directory: Path) -> None:
    real_gdb = shutil.which("xtensa-esp32s3-elf-gdb")
    if not real_gdb:
        raise RuntimeError("Pinned target GDB is unavailable")
    for fault in ("bt-error", "bt-incomplete", "bt-empty", "bt-exit", "threads-error", "threads-empty"):
        proxy = directory / f"gdb-{fault}"
        marker = directory / f"{fault}.reached"
        # Forward to the real pinned GDB until the mandatory command under test. Only that
        # command's response is injected; loader, MI parser and full pinned info flow remain real.
        proxy.write_text("#!/usr/bin/env python3\n" + textwrap.dedent(f"""
            import os
            from pathlib import Path
            import signal
            import subprocess
            import sys
            import threading
            signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
            child = subprocess.Popen([{real_gdb!r}, *sys.argv[1:]], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            def relay():
                for line in child.stdout:
                    print(line, end="", flush=True)
            threading.Thread(target=relay, daemon=True).start()
            try:
                for line in sys.stdin:
                    is_fault = ('"bt"' in line) if {fault!r}.startswith('bt-') else line.startswith('-thread-info')
                    if is_fault:
                        Path({str(marker)!r}).write_text(line)
                        if {fault!r}.endswith('-error'):
                            print('^error,msg="synthetic mandatory command failure"', flush=True)
                        elif {fault!r} == 'bt-empty':
                            print('^done', flush=True)
                        elif {fault!r} == 'threads-empty':
                            print('^done,threads=[],current-thread-id="1"', flush=True)
                        elif {fault!r} == 'bt-exit':
                            child.terminate()
                            child.wait(timeout=3)
                            sys.exit(37)
                        # bt-incomplete deliberately returns no MI completion.
                    else:
                        child.stdin.write(line)
                        child.stdin.flush()
            finally:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=3)
        """))
        proxy.chmod(0o700)
        original = decode.ESPCoreDumpFileLoader._create_temp_file
        created = []

        def observed_temporary(loader):
            name = original(loader)
            created.append(Path(name))
            return name

        decode.ESPCoreDumpFileLoader._create_temp_file = observed_temporary
        try:
            try:
                with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                    decode.decode("info_corefile", str(directory / "matching.raw"),
                                  str(directory / "matching.elf"), gdb_path=str(proxy))
            except Exception as error:
                if not marker.exists():
                    raise AssertionError(f"MI fixture failed before reaching {fault}: {error}") from error
                print(f"Pinned info flow + injected {fault}: rejected ({type(error).__name__})", flush=True)
            else:
                raise AssertionError(f"Failed mandatory MI command was accepted: {fault}")
            if any(path.exists() for path in created):
                raise AssertionError(f"Loader temporary leaked after {fault}")
        finally:
            decode.ESPCoreDumpFileLoader._create_temp_file = original


def test_real_archive_wrapper(directory: Path) -> None:
    repository = Path(__file__).resolve().parents[2]
    fixture_repo = directory / "wrapper-repo"
    (fixture_repo / "scripts").mkdir(parents=True)
    (fixture_repo / "tools/coredump").mkdir(parents=True)
    (fixture_repo / "build").mkdir()
    shutil.copy2(repository / "scripts/decode-coredump.sh", fixture_repo / "scripts")
    shutil.copy2(repository / "tools/coredump/decode.py", fixture_repo / "tools/coredump")
    # Already inside the pinned container: preserve the real Python/decoder invocation while
    # replacing only the redundant outer Docker launch. No parser or GDB command is substituted.
    handoff = fixture_repo / "scripts/idf-docker.sh"
    handoff.write_text('#!/bin/sh\nexec "$@"\n')
    handoff.chmod(0o700)
    for name in ("matching.raw", "invalid-checksum.raw"):
        shutil.copy2(directory / name, fixture_repo / name)
    plain = fixture_repo / "build/daikin-altherma-esp32.elf"
    plain.write_bytes((directory / "different.elf").read_bytes())
    archive = plain.with_suffix(".elf.xz")
    archive.write_bytes(lzma.compress((directory / "matching.elf").read_bytes()))
    stale = plain.read_bytes()
    for core_name, expected in (("matching.raw", True), ("invalid-checksum.raw", False)):
        result = subprocess.run(["bash", "scripts/decode-coredump.sh", core_name], cwd=fixture_repo,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        if (result.returncode == 0) != expected:
            raise AssertionError(f"Real archive wrapper result: {core_name}: {result.stderr}")
        if expected and "#0  fixture_leaf" not in result.stdout:
            raise AssertionError("Real archive wrapper failed to symbolize fixture_leaf")
        if plain.read_bytes() != stale:
            raise AssertionError("Wrapper overwrote an existing plain ELF")
        if list(plain.parent.glob("*.decoded.*")) or list(plain.parent.glob("*.part")):
            raise AssertionError(f"Archive scratch leak after {core_name}")
    archive.write_bytes(b"synthetic invalid archive")
    result = subprocess.run(["bash", "scripts/decode-coredump.sh", "matching.raw"], cwd=fixture_repo,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    if result.returncode == 0 or list(plain.parent.glob("*.decoded.*")) or list(plain.parent.glob("*.part")):
        raise AssertionError("Corrupt archive accepted or leaked temporary output")


def main() -> None:
    print(f"Synthetic coredump tests: esp-coredump {esp_coredump.__version__}", flush=True)
    with TemporaryDirectory(prefix="daikin-coredump-synthetic-") as name:
        directory = Path(name)
        create_fixtures(directory)
        for core_name in ("matching", "full-identity", "nonzero-tail-padding"):
            output = StringIO()
            with redirect_stdout(output), redirect_stderr(StringIO()):
                result = decode.decode("info_corefile", str(directory / f"{core_name}.raw"),
                                       str(directory / "matching.elf"))
            if result != 0 or "#0  fixture_leaf" not in output.getvalue() or "fixture_task" not in output.getvalue():
                raise AssertionError(f"Real pinned decoder symbolization failed: {core_name}")
            print(f"Real GDB symbolization: {core_name}: #0 fixture_leaf, fixture_task", flush=True)
            assert_temporary_cleanup(directory, core_name, "matching.elf", True)
        negative = ("missing-identity", "empty-identity", "short-identity", "nonhex-identity",
                    "duplicate-identity", "wrong-version", "wrong-identity", "short-descriptor",
                    "parser-shaped-68", "packed-70", "long-descriptor", "unterminated-identity",
                    "overlong-identity", "nonzero-after-terminator", "invalid-checksum", "truncated",
                    "invalid-dump", "unsupported-version")
        for core_name in negative:
            assert_temporary_cleanup(directory, core_name, "matching.elf", False)
        assert_temporary_cleanup(directory, "matching", "different.elf", False)
        test_subprocess_failure(directory)
        test_info_mi_failures(directory)
        test_real_archive_wrapper(directory)
        output = os.environ.get("COREDUMP_FIXTURE_OUTPUT")
        if output:
            destination = Path(output)
            destination.mkdir(parents=True, exist_ok=True)
            for fixture in directory.iterdir():
                if fixture.is_file():
                    shutil.copy2(fixture, destination / fixture.name)
    print("Synthetic pinned decoder, provenance, subprocess and archive tests passed")


if __name__ == "__main__":
    main()
