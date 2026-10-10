#!/usr/bin/env python3
"""Decode private raw evidence only after explicit ELF identity verification.

Run inside the repository-pinned ESP-IDF container. The upstream loader checks raw integrity and
present identity notes; it also accepts absent, empty and arbitrarily short identity. Require one
meaningful identity before entering GDB, and never fall back to a serial device.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

from esp_coredump import CoreDump
from esp_coredump import coredump as coredump_api
from esp_coredump.corefile import ESPCoreDumpError
from esp_coredump.corefile.elf import ESPCoreDumpElfFile, ElfFile
from esp_coredump.corefile.gdb import EspGDB
from esp_coredump.corefile.loader import ESPCoreDumpFileLoader


@dataclass(frozen=True)
class VerifiedDump:
    core: str
    target: str
    chip_rev: int | None


class StrictEspGDB(EspGDB):
    """Keep the pinned decoder, but require completed, successful MI commands.

    esp-coredump 1.17.0's multi-response path ignores MI errors and completion timeouts.
    In particular, a failed `bt` can otherwise produce an apparently successful info report.
    """

    def _gdbmi_run_cmd_get_responses(
        self, cmd, resp_message, resp_type, multiple=True, done_message=None,
        done_type=None, response_delay_sec=None,
    ):
        self.p.write(cmd, read_response=False)
        deadline = time.monotonic() + (response_delay_sec or self.timeout)
        responses = []
        while time.monotonic() < deadline:
            batch = self.p.get_gdb_response(timeout_sec=0, raise_error_on_timeout=False)
            responses.extend(batch)
            if any(item.get("type") == "result" and item.get("message") == "error" for item in batch):
                raise ESPCoreDumpError(f"GDB command failed: {cmd}")
            if any(item.get("type") == (done_type or "result")
                   and item.get("message") == (done_message or "done") for item in batch):
                filtered = [item for item in responses
                            if item.get("type") == resp_type and item.get("message") == resp_message]
                if not multiple and not filtered:
                    raise ESPCoreDumpError(f"GDB command returned no required response: {cmd}")
                return filtered
            process = self.p.gdb_process
            if process is None or process.poll() is not None:
                status = None if process is None else process.returncode
                raise ESPCoreDumpError(f"GDB exited before completing command (status {status}): {cmd}")
            time.sleep(0.01)
        raise ESPCoreDumpError(f"GDB command did not complete: {cmd}")

    def run_cmd(self, gdb_cmd):
        result = super().run_cmd(gdb_cmd)
        if gdb_cmd == "bt" and not re.search(r"(?m)^#\d+\s", result):
            raise ESPCoreDumpError("GDB returned no backtrace frames")
        return result

    def get_thread_info(self, response_delay_sec=3):
        threads, current = super().get_thread_info(response_delay_sec)
        if not threads or not current:
            raise ESPCoreDumpError("GDB returned no current thread information")
        return threads, current

    def __del__(self):
        # A failed executable lookup can leave the upstream constructor without `p`.
        if hasattr(self, "p"):
            super().__del__()


def info_corefile(decoder: CoreDump) -> None:
    # The pinned API has no GDB factory argument. This CLI has one synchronous decode per process;
    # scope the adapter to that call and restore the API even when symbolization fails.
    original = coredump_api.EspGDB
    coredump_api.EspGDB = StrictEspGDB
    try:
        decoder.info_corefile()
    finally:
        if hasattr(decoder, "gdb_esp"):
            del decoder.gdb_esp
        coredump_api.EspGDB = original


@contextmanager
def verified_dump(raw: str, elf: str):
    loader = None
    try:
        executable = ElfFile(elf)
        loader = ESPCoreDumpFileLoader(raw, is_b64=False)
        loader.create_corefile(exe_name=elf, e_machine=executable.e_machine)
        core = ESPCoreDumpElfFile(loader.core_elf_file)
        if core.e_machine != executable.e_machine:
            raise ValueError("Core and application ELF architectures differ")
        notes = [
            note
            for segment in core.note_segments
            for note in segment.note_secs
            if note.name == b"ESP_CORE_DUMP_INFO"
            and note.type == ESPCoreDumpElfFile.PT_ESP_INFO
        ]
        if len(notes) != 1:
            raise ValueError("Exactly one application identity note is required")
        descriptor = notes[0].desc
        # IDF v6.1's writer emits sizeof(core_dump_elf_version_info_t): uint32 version,
        # uint8 identity[66], then two ABI tail-padding bytes. The upstream parser's 68-byte
        # view is not the writer layout. Older/synthetic layouts need separate compatibility proof.
        if len(descriptor) != 72:
            raise ValueError("Application identity descriptor must use the pinned 72-byte SDK layout")
        version = struct.unpack("<I", descriptor[:4])[0]
        field = descriptor[4:70]
        terminator = field.find(b"\0")
        if terminator < 0 or any(field[terminator:]):
            raise ValueError("Application identity field must be terminated and zero-filled")
        identity = field[:terminator]
        if not re.fullmatch(rb"[0-9a-f]{8,64}", identity):
            raise ValueError("Application identity must contain 8-64 lowercase ASCII hex characters")
        if version != loader.version or identity != executable.sha256.hex().encode()[:len(identity)]:
            raise ValueError("Application identity or core version does not match")
        yield VerifiedDump(loader.core_elf_file, loader.target, loader.chip_rev)
    finally:
        if loader is not None:
            for temporary in loader.temp_files:
                Path(temporary).unlink(missing_ok=True)


def decode(mode: str, raw: str, elf: str, *, gdb_path: str | None = None) -> int:
    with verified_dump(raw, elf) as verified:
        decoder = CoreDump(
            core=verified.core,
            core_format="elf",
            prog=elf,
            chip=verified.target,
            chip_rev=verified.chip_rev,
            gdb=gdb_path,
        )
        if mode == "dbg_corefile":
            # Upstream dbg_corefile() ignores GDB's return code. Preserve the actual subprocess
            # result while using its pinned argument construction and explicit verified target.
            arguments = decoder.get_gdb_args(
                target=verified.target,
                core_elf_path=verified.core,
                chip_rev=verified.chip_rev,
                is_dbg_mode=True,
            )
            result = subprocess.run(arguments, check=False)
            return result.returncode if result.returncode >= 0 else 128 - result.returncode
        info_corefile(decoder)
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("info_corefile", "dbg_corefile"))
    parser.add_argument("raw")
    parser.add_argument("elf")
    arguments = parser.parse_args()
    try:
        return decode(arguments.mode, arguments.raw, arguments.elf)
    except Exception as error:
        print(f"decode-coredump: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
