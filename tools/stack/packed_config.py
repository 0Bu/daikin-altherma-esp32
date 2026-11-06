"""Exact, complete ELF-body decoding for six reviewed local config functions.

The main checker supplies its existing gap-free raw decoder and BudgetError.  This module adds
no wildcard packed exception: the nm/ELF names, local function binding and display names below
are exact.  It does not change any frame cap, task allocation, reserve or SDK fingerprint.
"""

from __future__ import annotations

import re
import struct
import tempfile
from pathlib import Path
from typing import Callable


_RAW_NAMES = {
    "_ZN4daikL20read_config_documentEP9httpd_reqjRPKc$constprop$0":
        "_ZN4daikL20read_config_documentEP9httpd_reqjRPKc$constprop$0",
    "daik::set_wifi(httpd_req*)": "_ZN4daikL8set_wifiEP9httpd_req",
    "daik::parse_circulation_request(httpd_req*, daik::CirculationRequest&)":
        "_ZN4daikL25parse_circulation_requestEP9httpd_reqRNS_18CirculationRequestE",
    "daik::set_weather(httpd_req*)": "_ZN4daikL11set_weatherEP9httpd_req",
    "daik::set_board(httpd_req*)": "_ZN4daikL9set_boardEP9httpd_req",
    "daik::set_env3(httpd_req*)": "_ZN4daikL8set_env3EP9httpd_req",
}
CONFIG_PACKED_SYMBOLS = frozenset(_RAW_NAMES)
_FUNCTION = re.compile(r"^\s*([0-9a-fA-F]+)\s+<(.+)>:\s*$")
_INSTRUCTION = re.compile(r"^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]+)(?:\s+(.*))?$")
_SECTION = re.compile(r"^Disassembly of section .+:$")
_ENTRY = re.compile(r"entry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)")
_WORD = re.compile(r"\.word\s+0x([0-9a-fA-F]{8})")
_MOVSP = re.compile(r"movsp\s+a1\s*,")


def _code(data: bytes, nm_text: str, raw_name: str, address: int,
          error: type[Exception]) -> bytes:
    """Bind nm's one local function to its exact ELF32 symbol and executable byte extent."""
    rows = [line.split() for line in nm_text.splitlines()
            if line.split() and line.split()[-1] == raw_name]
    if (len(rows) != 1 or len(rows[0]) != 4 or rows[0][2] != "t"
            or not all(re.fullmatch(r"[0-9a-fA-F]+", value) for value in rows[0][:2])):
        raise error("exactly one defined local nm function is required")
    actual_address, size = (int(value, 16) for value in rows[0][:2])
    if actual_address != address or size < 4:
        raise error("nm entry address/size disagrees with disassembly")

    def bounded(offset: int, length: int) -> bytes:
        if offset < 0 or length < 0 or offset + length > len(data):
            raise error("truncated ELF range")
        return data[offset:offset + length]

    if len(data) < 52 or data[:7] != b"\x7fELF\x01\x01\x01":
        raise error("ELF32 little-endian image is required")
    header = struct.unpack("<16sHHIIIIIHHHHHH", bounded(0, 52))
    if (header[1:4] != (2, 94, 1) or header[8] != 52 or header[11] != 40
            or not header[12] or header[13] >= header[12]):
        raise error("unsupported Xtensa executable ELF header")
    sections = list(struct.iter_unpack("<IIIIIIIIII", bounded(header[6], 40 * header[12])))

    def section_data(index: int, kind: int) -> bytes:
        if index >= len(sections) or sections[index][1] != kind:
            raise error("missing ELF symbol/string section")
        section = sections[index]
        return bounded(section[4], section[5])

    def string(table: bytes, offset: int) -> bytes:
        if offset >= len(table) or (end := table.find(b"\0", offset)) < 0:
            raise error("unterminated ELF name")
        return table[offset:end]

    section_names = section_data(header[13], 3)
    symbols = []
    for section in sections:
        if section[1] != 2:
            continue
        if section[9] != 16 or section[5] % 16:
            raise error("malformed ELF symbol table")
        names = section_data(section[6], 3)
        for symbol in struct.iter_unpack("<IIIBBH", bounded(section[4], section[5])):
            if string(names, symbol[0]) == raw_name.encode("ascii"):
                symbols.append(symbol)
    if (len(symbols) != 1 or symbols[0][1:3] != (address, size)
            or symbols[0][3] != 0x02 or symbols[0][4] != 0
            or symbols[0][5] >= len(sections)):
        raise error("nm disagrees with the unique local ELF function symbol")
    section = sections[symbols[0][5]]
    if (section[1] != 1 or section[2] & 6 != 6
            or string(section_names, section[0]) not in (b".text", b".flash.text", b".iram0.text")
            or address < section[3] or address + size > section[3] + section[5]):
        raise error("function escapes executable text section")
    code = bounded(section[4] + address - section[3], size)
    first = int.from_bytes(code[:3], "little")
    if first & 0xFFF != 0x136:
        raise error("first ELF bytes are not the Xtensa ENTRY opcode")
    if first >> 12 == 0:
        raise error("empty first stack frame")
    return code


def restore_packed_config(disassembly: str, data: bytes, elf: Path, objdump: str,
                          tool_output: Callable[[list[str]], str],
                          raw_body: Callable[[str, int, bytes], str],
                          error: type[Exception]) -> str:
    """Raw-decode every present reviewed body, even when its first ENTRY is already readable.

    Per-symbol extraction avoids linker padding and a preceding body's odd length changing the
    decoder's alignment. Missing symbols remain the main checker's required-inventory failure.
    The result contains ordinary ENTRY instructions, never a packed-prologue acceptance marker.
    """
    lines = disassembly.splitlines(keepends=True)
    blocks = []
    seen = set()
    for start, line in enumerate(lines):
        header = _FUNCTION.match(line)
        if not header or header.group(2) not in CONFIG_PACKED_SYMBOLS:
            continue
        name = header.group(2)
        if name in seen:
            raise error(f"packed config {name}: duplicate application function")
        seen.add(name)
        end = next((index for index in range(start + 1, len(lines))
                    if _FUNCTION.match(lines[index]) or _SECTION.match(lines[index])), len(lines))
        blocks.append((start, end, name, int(header.group(1), 16)))
    if not blocks:
        return disassembly
    if not objdump.endswith("objdump"):
        raise error("packed config: cannot bind nm to the supplied objdump tool")
    nm = objdump[:-len("objdump")] + "nm"
    nm_text = tool_output([nm, "-n", "-S", "--defined-only", str(elf)])
    replacements = []
    with tempfile.TemporaryDirectory(prefix="daikin-stack-packed-config-") as temporary:
        for number, (start, end, name, address) in enumerate(blocks):
            try:
                first = next((_INSTRUCTION.match(line) for line in lines[start + 1:end]
                              if re.match(r"^\s*[0-9a-fA-F]+:", line)), None)
                if first is None or int(first.group(1), 16) != address:
                    raise error("first instruction is not at the exact function entry")
                code = _code(data, nm_text, _RAW_NAMES[name], address, error)
                mnemonic = (first.group(3) or "").strip()
                if len(first.group(2)) == 8 and (not mnemonic or _WORD.fullmatch(mnemonic)):
                    word = int(first.group(2), 16)
                    if (word != int.from_bytes(code[:4], "little")
                            or mnemonic and word != int(_WORD.fullmatch(mnemonic).group(1), 16)):
                        raise error("packed first word disagrees with ELF bytes")
                else:
                    entry = _ENTRY.fullmatch(mnemonic)
                    frame = (int.from_bytes(code[:3], "little") >> 12) * 8
                    if (len(first.group(2)) != 6 or entry is None
                            or int(entry.group(1), 0) != frame
                            or int(first.group(2), 16) not in
                            (int.from_bytes(code[:3], "little"), int.from_bytes(code[:3], "big"))):
                        raise error("wrong first prologue before raw body decoding")
                if end < len(lines) and (following := _FUNCTION.match(lines[end])):
                    if int(following.group(1), 16) < address + len(code):
                        raise error("nested symbol overlaps the complete function")
                raw_file = Path(temporary) / f"config-{number}.raw"
                raw_file.write_bytes(code)
                decoded = tool_output([objdump, "-D", "-b", "binary", "-m", "xtensa",
                                       f"--adjust-vma=0x{address:x}", str(raw_file)])
                replacement = raw_body(decoded, address, code)
                first_line, newline, body = replacement.partition("\n")
                expected = f"{address:08x} <daik::hp_detect_run()>:"
                if first_line != expected or not newline:
                    raise error("raw body decoder returned an unexpected function identity")
                if any(_MOVSP.match((instruction.group(3) or "").strip())
                       for line in body.splitlines() if (instruction := _INSTRUCTION.match(line))):
                    raise error("unreviewed dynamic stack adjustment (movsp a1)")
                replacements.append((start, end, f"{address:08x} <{name}>:\n" + body))
            except error as exc:
                raise error(f"packed config {name}: {exc}") from exc
    for start, end, replacement in reversed(replacements):
        lines[start:end] = [replacement]
    return "".join(lines)


def self_test(error: type[Exception], raw_body: Callable[[str, int, bytes], str]) -> int:
    """Execute the production adapter against deterministic tools, without subprocess calls."""
    address = 0x42001000
    objdump = "xtensa-esp32s3-elf-objdump"
    elf = Path("fixture.elf")
    frame = 48
    code = bytes.fromhex("3661001df0")
    controls = 0

    def image(raw_name: str, body: bytes = code, info: int = 0x02, other: int = 0,
              flags: int = 6, size: int | None = None, duplicate: bool = False) -> bytes:
        names = b"\0.flash.text\0.symtab\0.strtab\0.shstrtab\0"
        strings = b"\0" + raw_name.encode("ascii") + b"\0"
        data = bytearray(52)

        def append(value: bytes) -> int:
            offset = len(data)
            data.extend(value)
            return offset

        code_offset = append(body)
        strings_offset = append(strings)
        names_offset = append(names)
        symbol = struct.pack("<IIIBBH", 1, address, len(body) if size is None else size, info, other, 1)
        symbols = bytes(16) + symbol + (symbol if duplicate else b"")
        symbols_offset = append(symbols)
        sections = [(0,) * 10,
                    (names.index(b".flash.text"), 1, flags, address, code_offset, len(body), 0, 0, 1, 0),
                    (names.index(b".symtab"), 2, 0, 0, symbols_offset, len(symbols), 3, 1, 4, 16),
                    (names.index(b".strtab"), 3, 0, 0, strings_offset, len(strings), 0, 0, 1, 0),
                    (names.index(b".shstrtab"), 3, 0, 0, names_offset, len(names), 0, 0, 1, 0)]
        section_offset = append(b"".join(struct.pack("<IIIIIIIIII", *section) for section in sections))
        identity = b"\x7fELF\x01\x01\x01" + bytes(9)
        data[:52] = struct.pack("<16sHHIIIIIHHHHHH", identity, 2, 94, 1, address,
                               0, section_offset, 0, 52, 0, 0, 40, len(sections), 4)
        return bytes(data)

    def exercise(name: str, *, data: bytes | None = None, standard: str | None = None,
                 nm: str | None = None, decoded: str | None = None,
                 body: bytes = code, fail_tool: str = "") -> tuple[str, list[str]]:
        raw_name = _RAW_NAMES[name]
        if data is None:
            data = image(raw_name, body)
        if standard is None:
            word = int.from_bytes(body[:4], "little")
            standard = f"{address:08x} <{name}>:\n{address:x}: {word:08x}\n"
        if nm is None:
            nm = f"{address:08x} {len(body):08x} t {raw_name}\n"
        if decoded is None:
            decoded = (f"Disassembly of section .data:\n{address:08x} <.data>:\n"
                       f"{address:x}: {body[:3].hex()} entry a1, {frame}\n"
                       f"{address + 3:x}: 1df0 retw.n\n")
        calls = []

        def tool(arguments: list[str]) -> str:
            if arguments == ["xtensa-esp32s3-elf-nm", "-n", "-S", "--defined-only", str(elf)]:
                calls.append("nm")
                output = nm
            else:
                assert arguments[:-1] == [objdump, "-D", "-b", "binary", "-m", "xtensa",
                                          f"--adjust-vma=0x{address:x}"]
                assert Path(arguments[-1]).read_bytes() == body
                calls.append("raw")
                output = decoded
            if calls[-1] == fail_tool:
                raise error("injected tool failure")
            return output

        return restore_packed_config(standard, data, elf, objdump, tool, raw_body, error), calls

    # All exact bindings, not one representative with a namespace/clone wildcard.
    for name in CONFIG_PACKED_SYMBOLS:
        restored, calls = exercise(name)
        assert calls == ["nm", "raw"]
        assert restored.startswith(f"{address:08x} <{name}>:\n")
        assert "<daik::hp_detect_run()>" not in restored
        ordinary = f"{address:08x} <{name}>:\n{address:x}: 006136 entry a1, 48\n"
        assert exercise(name, standard=ordinary)[1] == ["nm", "raw"]

    name = "daik::set_wifi(httpd_req*)"
    raw_name = _RAW_NAMES[name]
    standard = f"{address:08x} <{name}>:\n{address:x}: 1d006136\n"
    nm = f"{address:08x} 00000005 t {raw_name}\n"
    raw = (f"Disassembly of section .data:\n{address:08x} <.data>:\n"
           f"{address:x}: 366100 entry a1, 48\n{address + 3:x}: 1df0 retw.n\n")

    def reject(label: str, expected: str, **options: object) -> None:
        nonlocal controls
        try:
            exercise(name, **options)
        except error as exc:
            assert expected in str(exc), (label, str(exc))
        else:
            raise AssertionError(f"packed config self-test accepted {label}")
        controls += 1

    reject("missing local nm", "local nm function", nm="")
    reject("duplicate local nm", "local nm function", nm=nm + nm)
    reject("global nm", "local nm function", nm=nm.replace(" t ", " T "))
    reject("data nm", "local nm function", nm=nm.replace(" t ", " D "))
    reject("nm clone", "local nm function", nm=nm.replace(raw_name, raw_name + "$isra$0"))
    reject("wrong nm address", "entry address/size", nm=nm.replace(f"{address:08x}", f"{address + 1:08x}"))
    reject("wrong nm size", "unique local ELF", nm=nm.replace("00000005", "00000004"))
    reject("wrong ELF symbol", "unique local ELF", data=image(raw_name + "$isra$0"))
    reject("global ELF symbol", "unique local ELF", data=image(raw_name, info=0x12))
    reject("non-function ELF symbol", "unique local ELF", data=image(raw_name, info=0x01))
    reject("hidden ELF symbol", "unique local ELF", data=image(raw_name, other=2))
    reject("duplicate ELF symbol", "unique local ELF", data=image(raw_name, duplicate=True))
    reject("non-executable section", "executable text", data=image(raw_name, flags=2))
    reject("non-allocated section", "executable text", data=image(raw_name, flags=4))
    reject("symbol beyond section", "executable text", data=image(raw_name, size=6),
           nm=nm.replace("00000005", "00000006"))
    reject("truncated ELF", "truncated ELF", data=image(raw_name)[:-1])
    reject("wrong ELF format", "ELF32 little-endian", data=b"bad" + image(raw_name)[3:])
    reject("wrong ELF machine", "Xtensa executable", data=image(raw_name)[:18] + b"\x03\0" + image(raw_name)[20:])
    wrong = bytes.fromhex("3561001df0")
    reject("wrong ELF ENTRY opcode", "ENTRY opcode", data=image(raw_name, wrong), body=wrong)
    zero = bytes.fromhex("3601001df0")
    reject("zero frame", "empty first stack frame", data=image(raw_name, zero), body=zero)
    reject("wrong first address", "exact function entry", standard=standard.replace(f"\n{address:x}:", f"\n{address + 1:x}:"))
    reject("wrong first word", "packed first word", standard=standard.replace("1d006136", "1d006137"))
    reject("wrong word mnemonic", "packed first word", standard=standard.replace("1d006136\n", "1d006136 .word 0x1d006137\n"))
    reject("wrong first mnemonic", "first prologue", standard=standard.replace("1d006136", "366100 nop"))
    reject("wrong ordinary first bytes", "first prologue", standard=standard.replace("1d006136", "356100 entry a1, 48"))
    reject("missing first line", "exact function entry", standard=standard.split("\n")[0] + "\n")
    reject("duplicate display symbol", "duplicate application", standard=standard + standard)
    reject("nested next symbol", "nested symbol", standard=standard + f"{address + 4:x} <unrelated()>:\n")
    reject("wrong raw start", "raw function entry", decoded=raw.replace(f"{address:08x} <.data>", f"{address + 1:08x} <.data>"))
    reject("raw byte drift", "instruction bytes disagree", decoded=raw.replace("1df0", "1cf0"))
    reject("raw gap", "invalid raw instruction", decoded=raw.replace(f"{address + 3:x}:", f"{address + 4:x}:"))
    reject("raw overlap", "invalid raw instruction", decoded=raw.replace(f"{address + 3:x}:", f"{address + 2:x}:"))
    reject("raw truncated tail", "complete function", decoded=raw.split(f"{address + 3:x}:")[0])
    reject("raw data directive", "invalid raw instruction", decoded=raw.replace("retw.n", ".word 0xf01d"))
    reject("raw invalid opcode", "invalid raw instruction", decoded=raw.replace("retw.n", "ill.n"))
    reject("raw wrong ENTRY", "ENTRY disagrees", decoded=raw.replace("a1, 48", "a1, 64"))
    reject("raw wrong section", "raw disassembly section", decoded=raw.replace("section .data:", "section .text:"))
    reject("duplicate raw header", "duplicate raw function", decoded=raw + f"{address:08x} <.data>:\n")
    for failing in ("nm", "raw"):
        reject("failed " + failing, "injected tool failure", fail_tool=failing)
    dynamic = bytes.fromhex("3661001018001df0")
    dynamic_raw = (f"Disassembly of section .data:\n{address:08x} <.data>:\n"
                   f"{address:x}: 366100 entry a1, 48\n"
                   f"{address + 3:x}: 101800 movsp a1, a8\n{address + 6:x}: 1df0 retw.n\n")
    reject("hidden interior MOVSP", "dynamic stack adjustment", body=dynamic, decoded=dynamic_raw)
    assert restore_packed_config("", b"", elf, objdump, lambda _: "", raw_body, error) == ""
    return controls
