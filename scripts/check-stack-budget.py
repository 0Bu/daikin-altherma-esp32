#!/usr/bin/env python3
"""Fail when measured ESP32-S3 stack frames exceed reviewed budgets.

The check consumes demangled Xtensa objdump output. It deliberately names the
high-risk paths instead of pretending a static call graph can resolve function
pointers, callbacks, or compiler-generated thunks. Missing required symbols fail
closed, so an optimizer or rename cannot silently disable the gate.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[1]
DEFAULT_BUDGETS = REPO / "tools/stack/budgets.json"
FUNCTION_RE = re.compile(r"^\s*([0-9a-fA-F]+)\s+<(.+)>:\s*$")
INSTRUCTION_RE = re.compile(r"^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F]+)(?:\s+(.*))?$")
CJSON_PACKED_ENTRY_SYMBOLS = frozenset({"parse_value", "parse_string", "cJSON_Delete", "cJSON_ParseWithLengthOpts"})
HTTP_STACK_RE = re.compile(r"\bcfg\.stack_size\s*=\s*([0-9]+)\s*;")
ENTRY_RE = re.compile(r"\bentry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)\b")
RULE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class BudgetError(ValueError):
    """Disassembly or budget data cannot establish the required stack bound."""


def parse_frames(disassembly: str) -> dict[str, int]:
    frames: dict[str, int] = {}
    current: str | None = None
    symbol_address = 0
    for line in disassembly.splitlines():
        header = FUNCTION_RE.match(line)
        if header:
            if current in CJSON_PACKED_ENTRY_SYMBOLS:
                raise BudgetError(f"symbol {current}: missing first prologue")
            current = header.group(2)
            symbol_address = int(header.group(1), 16)
            if re.match(r"^parse_(?:array|object)(?:[.$]|$)", current):
                raise BudgetError(f"symbol {current}: out-of-line cJSON container needs budget review")
            if current in CJSON_PACKED_ENTRY_SYMBOLS and current in frames:
                raise BudgetError(f"duplicate cJSON symbol {current}")
            continue
        if current is None:
            continue
        if current in CJSON_PACKED_ENTRY_SYMBOLS:
            instruction = INSTRUCTION_RE.match(line)
            if not instruction:
                if re.match(r"^\s*[0-9a-fA-F]+:", line):
                    raise BudgetError(f"symbol {current}: truncated first prologue")
                continue
            if int(instruction.group(1), 16) != symbol_address:
                raise BudgetError(f"symbol {current}: first instruction is not at symbol address")
            mnemonic = (instruction.group(3) or "").strip()
            entry = ENTRY_RE.fullmatch(mnemonic)
            if entry:
                frame = int(entry.group(1), 0)
            elif (len(instruction.group(2)) == 8 and
                  (not mnemonic or re.fullmatch(r"\.word\s+0x[0-9a-fA-F]{8}", mnemonic))):
                # Standard SDK objdump can print a packed word with no mnemonic; raw objdump
                # can label it .word. Decode only these four first words at their exact symbol
                # addresses. A later ENTRY or any other packed SDK symbol cannot supply a bound.
                word = int(instruction.group(2), 16)
                raw24 = word & 0xFFFFFF
                if (mnemonic and word != int(mnemonic.split()[1], 16)) or raw24 & 0xFFF != 0x136:
                    raise BudgetError(f"symbol {current}: wrong packed first prologue")
                frame = (raw24 >> 12) * 8
            else:
                raise BudgetError(f"symbol {current}: undecodable first prologue")
            if frame == 0:
                raise BudgetError(f"symbol {current}: empty first stack frame")
            frames[current] = frame
            current = None
            continue
        entry = ENTRY_RE.search(line)
        if entry:
            frame = int(entry.group(1), 0)
            frames[current] = max(frame, frames.get(current, 0))
            current = None
    if current in CJSON_PACKED_ENTRY_SYMBOLS:
        raise BudgetError(f"symbol {current}: missing first prologue")
    return frames


def validate_http_stack(budgets: dict[str, Any], source: str) -> None:
    matches = HTTP_STACK_RE.findall(source)
    if len(matches) != 1:
        raise BudgetError("HTTP stack must have one machine-readable cfg.stack_size literal")
    stack_size = int(matches[0])
    for name, rule in budgets["paths"].items():
        if name.startswith("httpd_") and rule["max_bytes"] > stack_size - 2048:
            raise BudgetError(f"path {name}: ceiling must retain 2048 B on HTTP stack {stack_size}")


def validate_json_recursion(budgets: dict[str, Any], json_source: str,
                            mcp_source: str, adapter_source: str) -> None:
    json_matches = re.findall(r"\bJSON_MAX_DEPTH\s*=\s*([0-9]+)\s*;", json_source)
    mcp_matches = re.findall(r"if\s*\(depth\s*>\s*([0-9]+)\)\s*return false;", mcp_source)
    if json_matches != ["16"] or mcp_matches != ["16"]:
        raise BudgetError("JSON recursion source limits require review")
    adapter = (
        r"inline\s+cJSON\*\s+json_parse_document\(std::string_view\s+payload\)\s*\{\s*"
        r"return\s+json_parse_bounded\(\s*payload,\s*"
        r"\[\]\(const char\* bytes,\s*size_t length,\s*const char\*\* end\)\s*noexcept\s*\{\s*"
        r"return cJSON_ParseWithLengthOpts\(bytes,\s*length,\s*end,\s*false\);\s*\},\s*"
        r"\[\]\(cJSON\* root\)\s*noexcept\s*\{\s*cJSON_Delete\(root\);\s*\},\s*"
        r"JSON_MAX_DEPTH\s*\);\s*\}")
    if not re.search(adapter, adapter_source):
        raise BudgetError("bounded cJSON adapter must bind JSON_MAX_DEPTH as its fourth argument")
    for owner in ("hp", "mqtt", "board", "env3", "weather", "diagnostics", "circulation"):
        name = f"httpd_config_{owner}"
        rule = budgets["paths"].get(name)
        if rule is None or rule["multipliers"] != {"cjson_parse_value": 17, "cjson_delete": 17}:
            raise BudgetError(f"path {name}: cJSON parse and simultaneous cleanup need depth + root")
    rule = budgets["paths"].get("httpd_mcp_parse")
    if rule is None or rule["multipliers"] != {"mcp_json_value": 18}:
        raise BudgetError("path httpd_mcp_parse: MCP needs depth + root + early-reject frame")


def validate_source_contract(budgets: dict[str, Any]) -> None:
    validate_http_stack(budgets, (REPO / "main/http_server.cpp").read_text(encoding="utf-8"))
    validate_json_recursion(
        budgets, (REPO / "main/logic/payload_complete.hpp").read_text(encoding="utf-8"),
        (REPO / "main/logic/mcp.hpp").read_text(encoding="utf-8"),
        (REPO / "main/json_guard.hpp").read_text(encoding="utf-8"))


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise BudgetError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def require_exact_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    actual = set(value)
    if actual == expected:
        return
    details: list[str] = []
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    if missing:
        details.append(f"missing {', '.join(missing)}")
    if unexpected:
        details.append(f"unexpected {', '.join(unexpected)}")
    raise BudgetError(f"{context}: keys must be exactly {sorted(expected)} ({'; '.join(details)})")


def is_json_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def valid_rule_name(value: Any) -> bool:
    return isinstance(value, str) and RULE_NAME_RE.fullmatch(value) is not None


def load_budgets(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys
        )
    except BudgetError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BudgetError(f"cannot read {path}: {exc}") from exc
    if not isinstance(document, dict):
        raise BudgetError("budget document must be an object")
    require_exact_keys(document, {"version", "symbols", "paths"}, "budget document")
    if not is_json_int(document["version"]) or document["version"] != 1:
        raise BudgetError("budget document version must be the JSON integer 1")

    symbols = document["symbols"]
    if not isinstance(symbols, dict) or not symbols:
        raise BudgetError("budget document symbols must be a non-empty object")
    for key, rule in symbols.items():
        if not valid_rule_name(key):
            raise BudgetError("symbol names must match [a-z][a-z0-9_]*")
        if not isinstance(rule, dict):
            raise BudgetError(f"symbol {key}: rule must be an object")
        require_exact_keys(rule, {"pattern", "max_bytes"}, f"symbol {key}")
        pattern = rule["pattern"]
        if not isinstance(pattern, str) or not pattern:
            raise BudgetError(f"symbol {key}: pattern must be a non-empty string")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise BudgetError(f"symbol {key}: invalid pattern ({exc})") from exc
        maximum = rule["max_bytes"]
        if not is_json_int(maximum) or maximum <= 0:
            raise BudgetError(f"symbol {key}: max_bytes must be a positive JSON integer")

    paths = document["paths"]
    if not isinstance(paths, dict) or not paths:
        raise BudgetError("budget document paths must be a non-empty object")
    for key, rule in paths.items():
        if not valid_rule_name(key):
            raise BudgetError("path names must match [a-z][a-z0-9_]*")
        if not isinstance(rule, dict):
            raise BudgetError(f"path {key}: rule must be an object")
        require_exact_keys(
            rule, {"symbols", "multipliers", "base_bytes", "max_bytes"}, f"path {key}"
        )
        members = rule["symbols"]
        if (
            not isinstance(members, list)
            or not members
            or not all(valid_rule_name(item) for item in members)
        ):
            raise BudgetError(f"path {key}: symbols must be a non-empty rule-name list")
        if len(set(members)) != len(members):
            raise BudgetError(f"path {key}: symbols must not contain duplicates")
        unknown = sorted(set(members) - set(symbols))
        if unknown:
            raise BudgetError(f"path {key}: unknown symbols {', '.join(unknown)}")
        multipliers = rule["multipliers"]
        if not isinstance(multipliers, dict):
            raise BudgetError(f"path {key}: multipliers must be an object")
        unknown_multipliers = sorted(set(multipliers) - set(members))
        if unknown_multipliers:
            raise BudgetError(
                f"path {key}: multiplier symbols are not path members "
                f"{', '.join(unknown_multipliers)}"
            )
        for member, multiplier in multipliers.items():
            if not valid_rule_name(member):
                raise BudgetError(f"path {key}: multiplier names must be rule names")
            if not is_json_int(multiplier) or multiplier <= 1:
                raise BudgetError(
                    f"path {key}: multiplier for {member} must be a JSON integer greater than 1"
                )
        base = rule["base_bytes"]
        if not is_json_int(base) or base < 0:
            raise BudgetError(f"path {key}: base_bytes must be a non-negative JSON integer")
        maximum = rule["max_bytes"]
        if not is_json_int(maximum) or maximum <= 0:
            raise BudgetError(f"path {key}: max_bytes must be a positive JSON integer")
    return document


def evaluate(frames: dict[str, int], budgets: dict[str, Any]) -> dict[str, int]:
    selected: dict[str, int] = {}
    errors: list[str] = []
    for key, rule in budgets["symbols"].items():
        pattern = re.compile(rule["pattern"])
        maximum = rule["max_bytes"]
        matches = [(name, frame) for name, frame in frames.items() if pattern.search(name)]
        if not matches:
            errors.append(f"symbol {key}: required pattern {pattern.pattern!r} is absent")
            continue
        selected[key] = max(frame for _, frame in matches)
        if selected[key] > maximum:
            names = ", ".join(name for name, _ in matches)
            errors.append(
                f"symbol {key}: {selected[key]} B exceeds {maximum} B ({names})"
            )

    for key, rule in budgets["paths"].items():
        members = rule["symbols"]
        missing = [item for item in members if item not in selected]
        if missing:
            errors.append(f"path {key}: unavailable members {', '.join(missing)}")
            continue
        base = rule["base_bytes"]
        maximum = rule["max_bytes"]
        multipliers = rule["multipliers"]
        measured = base + sum(
            selected[item] * multipliers.get(item, 1) for item in members
        )
        selected[f"path:{key}"] = measured
        if measured > maximum:
            errors.append(f"path {key}: {measured} B exceeds {maximum} B")

    if errors:
        raise BudgetError("; ".join(errors))
    return selected


def disassemble(elf: Path, objdump: str) -> str:
    if not elf.is_file():
        raise BudgetError(f"ELF does not exist: {elf}")
    try:
        result = subprocess.run(
            [objdump, "-d", "-C", str(elf)],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise BudgetError(f"cannot execute {objdump}: {exc}") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit {result.returncode}"
        raise BudgetError(f"objdump failed: {detail}")
    return result.stdout


def self_test() -> None:
    fixture = """
00000001 <daik::mcp_post(httpd_req*)>:
   1: 004136          entry a1, 1232
00000002 <daik::http_send_status_json(httpd_req*, int)>:
   2: 004136          entry a1, 128
00000003 <void daik::append_status_json<daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u> >(daik::BoundedChunkSink<daik::HttpChunkEmitter, 1024u>&, bool)>:
   3: 004136          entry a1, 4848
00000004 <daik::mqtt_task(void*)>:
   4: 004136          entry a1, 1120
00000005 <daik::(anonymous namespace)::ota_task(void*)>:
   5: 004136          entry a1, 2608
00000006 <daik::ota_stat(httpd_req*)>:
   6: 004136          entry a1, 5088
00000007 <daik::(anonymous namespace)::fetch_manifest_identity_once(std::string const&, daik::OtaManifestIdentity&, char const*&, bool&)>:
   7: 004136          entry a1, 1280
00000008 <_ZN4daik12_GLOBAL__N_1L23fetch_manifest_identityERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEERNS_19OtaManifestIdentityERPKc$constprop$0>:
   8: 004136          entry a1, 48
00000009 <daik::ota_check(httpd_req*)>:
   9: 004136          entry a1, 1152
0000000a <daik::(anonymous namespace)::start_check(daik::OtaFeedUrls const*)>:
   a: 004136          entry a1, 688
0000000b <daik::manifest_identity(char const*, unsigned int, daik::OtaManifestIdentity&)>:
   b: 004136          entry a1, 160
0000000c <daik::detail::skip_json_value(char const*, unsigned int, unsigned int&, unsigned int)>:
   c: 004136          entry a1, 64
0000000d <daik::(anonymous namespace)::socket_deadline_watchdog_task(void*)>:
   d: 004136          entry a1, 512
0000000e <daik::(anonymous namespace)::health_gate_task(void*)>:
   e: 004136          entry a1, 80
0000000f <daik::(anonymous namespace)::weather_task(void*)>:
   f: 004136          entry a1, 1152
00000010 <daik::(anonymous namespace)::fetch_forecast(daik::Config const&, daik::WeatherForecastSample&, std::string&, bool&, daik::HttpClientProbe&)>:
  10: 004136          entry a1, 160
00000011 <daik::(anonymous namespace)::download_json(daik::Config const&, std::string&, std::string&, bool&, daik::HttpClientProbe&)>:
  11: 004136          entry a1, 432
00000012 <daik::(anonymous namespace)::parse_forecast(std::string const&, long long, daik::WeatherForecastSample&, std::string&)>:
  12: 004136          entry a1, 512
"""
    fixture += """
00000013 <daik::set_hp(httpd_req*)>:
  13: 004136          entry a1, 3200
00000014 <daik::set_mqtt(httpd_req*)>:
  14: 004136          entry a1, 2336
00000015 <daik::set_board(httpd_req*)>:
  15: 004136          entry a1, 2176
00000016 <daik::set_env3(httpd_req*)>:
  16: 004136          entry a1, 1792
00000017 <daik::set_weather(httpd_req*)>:
  17: 004136          entry a1, 1776
00000018 <daik::set_diagnostics(httpd_req*)>:
  18: 004136          entry a1, 1536
00000019 <daik::set_circulation(httpd_req*)>:
  19: 004136          entry a1, 976
0000001a <daik::parse_circulation_request(httpd_req*, daik::CirculationRequest&)>:
  1a: 004136          entry a1, 1408
0000001b <daik::hp_query_probe(httpd_req*)>:
  1b: 004136          entry a1, 2720
0000001c <daik::mcp_parse(char const*, int)>:
  1c: 004136          entry a1, 144
0000001d <daik::mcp_detail::JsonReader::value(int)>:
  1d: 004136          entry a1, 32
0000001e <daik::mcp_detail::JsonReader::string(std::string*)>:
  1e: 004136          entry a1, 48
0000001f <parse_value>:
  1f: 16008136 \t
00000020 <parse_string>:
  20: d8006136 \t
00000021 <cJSON_Delete>:
  21: 61004136 \t
00000022 <cJSON_ParseWithLengthOpts>:
  22: c2008136 \t
00000023 <daik::config_save(daik::Config const&)>:
  23: 004136          entry a1, 32
00000024 <daik::save_whole(daik::Config const&, bool)>:
  24: 004136          entry a1, 48
00000025 <_ZN4daik23config_save_transactionINS_12_GLOBAL__N_112NvsBlobStoreEEENS_17ConfigSaveOutcomeERNS_6ConfigERKS4_bRT_$constprop$0>:
  25: 004136          entry a1, 1600
00000026 <daik::nvs_set_blob(char const*, void const*, unsigned int)>:
  26: 004136          entry a1, 48
00000027 <daik::h_scan(httpd_req*)>:
  27: 004136          entry a1, 768
00000028 <daik::wifi_scan(daik::WifiScanEntry*, int)>:
  28: 004136          entry a1, 1920
00000029 <daik::config_save_link(daik::Config const&)>:
  29: 004136          entry a1, 32
"""
    budgets = load_budgets(DEFAULT_BUDGETS)
    validate_source_contract(budgets)
    frames = parse_frames(fixture)

    selected = evaluate(frames, budgets)
    assert selected["status_serializer"] == 4848
    assert selected["path:httpd_mcp_status"] == 7616
    assert selected["path:httpd_direct_status"] == 6512
    assert selected["ota_task"] == 2608
    assert selected["path:httpd_ota_status"] == 6624
    assert selected["path:ota_task_manifest_fetch"] == 4672
    assert selected["path:httpd_ota_check"] == 3376
    assert selected["path:http_deadline_watchdog"] == 1536
    assert selected["weather_task"] == 1152
    assert selected["path:weather_task_download"] == 3792
    assert selected["path:weather_task_parse"] == 3872
    assert selected["ota_health_task"] == 80
    assert selected["path:ota_health_gate"] == 2128
    assert selected["path:httpd_config_hp"] == 6480
    assert selected["path:httpd_config_circulation"] == 5664
    assert selected["path:httpd_hp_query_probe"] == 4256
    assert selected["path:httpd_mcp_parse"] == 3536
    assert selected["path:httpd_config_save"] == 8000
    assert selected["path:httpd_config_save_link"] == 8000
    assert selected["path:httpd_wifi_scan"] == 5248
    assert selected["path:httpd_mqtt_tls"] == 7968

    for symbol, address, word, frame in (
        ("parse_value", "1f", "16008136", 64),
        ("parse_string", "20", "d8006136", 48),
        ("cJSON_Delete", "21", "61004136", 32),
        ("cJSON_ParseWithLengthOpts", "22", "c2008136", 64),
    ):
        first = f"{address}: {word} \t"
        for rendered in (f"{address}: {word}        .word 0x{word}",
                         f"{address}: {word}        entry a1, {frame}"):
            decoded = fixture.replace(first, rendered)
            assert parse_frames(decoded)[symbol] == frame
            evaluate(parse_frames(decoded), budgets)

    def reject_disassembly(name: str, text: str, expected: str) -> None:
        try:
            evaluate(parse_frames(text), budgets)
        except BudgetError as exc:
            assert expected in str(exc), f"{name}: unexpected failure {exc}"
        else:
            raise AssertionError(f"self-test accepted {name}")

    reject_disassembly("wrong first blank opcode", fixture.replace(
        "1f: 16008136 \t", "1f: 16008135 \t"), "first prologue")
    reject_disassembly("later ENTRY rescue", fixture.replace(
        "1f: 16008136 \t", "1f: 16008135 \t\n  2a: 008136 entry a1, 64"), "first prologue")
    reject_disassembly("truncated blank word", fixture.replace(
        "1f: 16008136 \t", "1f: 008136 \t"), "first prologue")
    reject_disassembly("empty first word", fixture.replace(
        "1f: 16008136 \t", "1f: \t"), "first prologue")
    reject_disassembly("zero packed frame", fixture.replace(
        "1f: 16008136 \t", "1f: 16000136 \t"), "empty first stack frame")
    reject_disassembly("mismatched .word", fixture.replace(
        "1f: 16008136 \t", "1f: 16008136 .word 0x16008135"), "first prologue")
    reject_disassembly("wrong instruction address", fixture.replace(
        "1f: 16008136", "2a: 16008136"), "symbol address")
    reject_disassembly("missing cJSON symbol", fixture.replace("<parse_value>", "<renamed_value>"),
        "cjson_parse_value")
    reject_disassembly("recursive frame growth", fixture.replace(
        "1f: 16008136 \t", "1f: 16009136 \t"), "cjson_parse_value")
    reject_disassembly("Config frame growth", fixture.replace("entry a1, 3200", "entry a1, 3216"),
        "config_hp")
    reject_disassembly("MQTT save caller frame growth", fixture.replace(
        "14: 004136          entry a1, 2336", "14: 004136          entry a1, 2352"), "config_mqtt")
    reject_disassembly("MCP recursion frame growth", fixture.replace(
        "1d: 004136          entry a1, 32", "1d: 004136          entry a1, 48"), "mcp_json_value")
    reject_disassembly("Config transaction frame growth", fixture.replace(
        "25: 004136          entry a1, 1600", "25: 004136          entry a1, 1616"),
        "config_transaction")
    reject_disassembly("missing Config transaction", fixture.replace(
        "_ZN4daik23config_save_transaction", "_ZN4daik23renamed_transaction"), "config_transaction")
    reject_disassembly("WiFi scan frame growth", fixture.replace(
        "28: 004136          entry a1, 1920", "28: 004136          entry a1, 1936"), "wifi_scan")
    reject_disassembly("missing WiFi scan", fixture.replace("<daik::wifi_scan(", "<daik::renamed_scan("),
        "wifi_scan")
    reject_disassembly("new out-of-line container", fixture +
        "\n00000023 <parse_array>:\n  23: 004136 entry a1, 64\n", "budget review")
    assert "unreviewed_packed" not in parse_frames(
        "00000023 <unreviewed_packed>:\n  23: e2008136 .word 0xe2008136\n")
    try:
        validate_http_stack(budgets, "cfg.stack_size = 8192;")
    except BudgetError as exc:
        assert "retain 2048 B" in str(exc)
    else:
        raise AssertionError("self-test accepted insufficient HTTP stack reserve")
    json_source = (REPO / "main/logic/payload_complete.hpp").read_text(encoding="utf-8")
    mcp_source = (REPO / "main/logic/mcp.hpp").read_text(encoding="utf-8")
    adapter_source = (REPO / "main/json_guard.hpp").read_text(encoding="utf-8")
    for name, changed_json, changed_mcp, member, multiplier in (
        ("cJSON source depth", json_source.replace("JSON_MAX_DEPTH      = 16;",
                                                  "JSON_MAX_DEPTH      = 17;"), mcp_source, None, None),
        ("MCP source depth", json_source, mcp_source.replace("depth > 16", "depth > 17"), None, None),
        ("cJSON parse root", json_source, mcp_source, "cjson_parse_value", 16),
        ("simultaneous cJSON cleanup", json_source, mcp_source, "cjson_delete", 16),
        ("MCP early-reject frame", json_source, mcp_source, "mcp_json_value", 17),
    ):
        changed_budgets = json.loads(json.dumps(budgets))
        if member is not None:
            path = "httpd_mcp_parse" if member == "mcp_json_value" else "httpd_config_hp"
            changed_budgets["paths"][path]["multipliers"][member] = multiplier
        try:
            validate_json_recursion(changed_budgets, changed_json, changed_mcp, adapter_source)
        except BudgetError:
            pass
        else:
            raise AssertionError(f"self-test accepted {name}")
    overridden_adapter = adapter_source.replace("}, JSON_MAX_DEPTH);", "}, 32);")
    assert overridden_adapter != adapter_source
    try:
        validate_json_recursion(budgets, json_source, mcp_source, overridden_adapter)
    except BudgetError as exc:
        assert "fourth argument" in str(exc)
    else:
        raise AssertionError("self-test accepted a larger cJSON adapter depth override")
    assert budgets["paths"]["ota_task_manifest_fetch"]["max_bytes"] == 6144
    assert budgets["paths"]["weather_task_download"]["max_bytes"] == 11264
    assert budgets["paths"]["weather_task_parse"]["max_bytes"] == 11264
    assert budgets["paths"]["ota_health_gate"]["max_bytes"] == 3072

    too_large = fixture.replace("entry a1, 1120", "entry a1, 2304")
    try:
        evaluate(parse_frames(too_large), budgets)
    except BudgetError as exc:
        assert "mqtt_task" in str(exc)
    else:
        raise AssertionError("self-test failed to reject an oversized frame")

    health_too_large = fixture.replace("entry a1, 80", "entry a1, 1056")
    try:
        evaluate(parse_frames(health_too_large), budgets)
    except BudgetError as exc:
        assert "ota_health_task" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the ota_health reserve")

    manifest_path_too_large = (
        fixture.replace("entry a1, 2608", "entry a1, 2816")
        .replace("entry a1, 1280", "entry a1, 1408")
        .replace("entry a1, 48", "entry a1, 128")
        .replace("entry a1, 160", "entry a1, 512")
        .replace("entry a1, 64", "entry a1, 256")
    )
    try:
        evaluate(parse_frames(manifest_path_too_large), budgets)
    except BudgetError as exc:
        assert "ota_task_manifest_fetch" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the OTA task path reserve")

    weather_path_too_large = (
        fixture.replace("entry a1, 1152", "entry a1, 6144")
        .replace("entry a1, 160", "entry a1, 2048")
        .replace("entry a1, 432", "entry a1, 3072")
    )
    try:
        evaluate(parse_frames(weather_path_too_large), budgets)
    except BudgetError as exc:
        assert "weather_task_download" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the Weather task reserve")

    weather_parse_path_too_large = (
        fixture.replace("entry a1, 1152", "entry a1, 6144")
        .replace("entry a1, 160", "entry a1, 2048")
        .replace("  12: 004136          entry a1, 512",
                 "  12: 004136          entry a1, 3072")
    )
    try:
        evaluate(parse_frames(weather_parse_path_too_large), budgets)
    except BudgetError as exc:
        assert "weather_task_parse" in str(exc)
    else:
        raise AssertionError("self-test failed to protect the Weather parse reserve")

    missing = fixture.replace("daik::mcp_post", "daik::renamed_post")
    try:
        evaluate(parse_frames(missing), budgets)
    except BudgetError as exc:
        assert "required pattern" in str(exc)
    else:
        raise AssertionError("self-test failed to reject a missing required symbol")

    with tempfile.TemporaryDirectory() as raw:
        bad = Path(raw) / "budgets.json"
        valid_document = json.loads(DEFAULT_BUDGETS.read_text(encoding="utf-8"))
        negative_checks = 0

        def clone() -> dict[str, Any]:
            return json.loads(json.dumps(valid_document))

        def reject_payload(name: str, payload: str, expected: str) -> None:
            nonlocal negative_checks
            bad.write_text(payload, encoding="utf-8")
            try:
                load_budgets(bad)
            except BudgetError as exc:
                if expected not in str(exc):
                    raise AssertionError(
                        f"{name}: expected {expected!r} in {str(exc)!r}"
                    ) from exc
            else:
                raise AssertionError(f"self-test accepted {name}")
            negative_checks += 1

        def reject_document(name: str, document: Any, expected: str) -> None:
            reject_payload(name, json.dumps(document), expected)

        reject_document("a non-object document", [], "must be an object")
        mutated = clone()
        mutated["extra"] = 1
        reject_document("an extra document key", mutated, "keys must be exactly")
        mutated = clone()
        del mutated["paths"]
        reject_document("a missing document key", mutated, "missing paths")
        for name, value in (("boolean", True), ("string", "1"), ("float", 1.0), ("other", 2)):
            mutated = clone()
            mutated["version"] = value
            reject_document(f"a {name} version", mutated, "JSON integer 1")

        mutated = clone()
        mutated["symbols"] = {}
        reject_document("empty symbols", mutated, "symbols must be a non-empty object")
        mutated = clone()
        mutated["symbols"] = ["mqtt_task"]
        reject_document("non-object symbols", mutated, "symbols must be a non-empty object")
        mutated = clone()
        mutated["paths"] = {}
        reject_document("empty paths", mutated, "paths must be a non-empty object")
        mutated = clone()
        mutated["paths"] = ["httpd_mcp_status"]
        reject_document("non-object paths", mutated, "paths must be a non-empty object")

        mutated = clone()
        mutated["symbols"][""] = mutated["symbols"].pop("mqtt_task")
        reject_document("an empty symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"][" mqtt_task"] = mutated["symbols"].pop("mqtt_task")
        reject_document("a padded symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"]["MQTT-task"] = mutated["symbols"].pop("mqtt_task")
        reject_document("a malformed symbol name", mutated, "symbol names")
        mutated = clone()
        mutated["symbols"]["mqtt_task"] = []
        reject_document("a non-object symbol rule", mutated, "rule must be an object")
        mutated = clone()
        del mutated["symbols"]["mqtt_task"]["pattern"]
        reject_document("a missing symbol key", mutated, "missing pattern")
        mutated = clone()
        mutated["symbols"]["mqtt_task"]["extra"] = 1
        reject_document("an extra symbol key", mutated, "unexpected extra")
        for name, value, expected in (
            ("empty", "", "non-empty string"),
            ("non-string", 7, "non-empty string"),
            ("invalid regex", "(", "invalid pattern"),
        ):
            mutated = clone()
            mutated["symbols"]["mqtt_task"]["pattern"] = value
            reject_document(f"a {name} symbol pattern", mutated, expected)
        for name, value in (
            ("boolean", True),
            ("string", "2048"),
            ("float", 2048.0),
            ("zero", 0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["symbols"]["mqtt_task"]["max_bytes"] = value
            reject_document(
                f"a {name} symbol maximum", mutated, "positive JSON integer"
            )

        mutated = clone()
        mutated["paths"][""] = mutated["paths"].pop("httpd_direct_status")
        reject_document("an empty path name", mutated, "path names")
        mutated = clone()
        mutated["paths"][" httpd_direct_status"] = mutated["paths"].pop(
            "httpd_direct_status"
        )
        reject_document("a padded path name", mutated, "path names")
        mutated = clone()
        mutated["paths"]["HTTP-path"] = mutated["paths"].pop("httpd_direct_status")
        reject_document("a malformed path name", mutated, "path names")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"] = []
        reject_document("a non-object path rule", mutated, "rule must be an object")
        mutated = clone()
        del mutated["paths"]["httpd_direct_status"]["base_bytes"]
        reject_document("a missing path key", mutated, "missing base_bytes")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["extra"] = 1
        reject_document("an extra path key", mutated, "unexpected extra")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["multipliers"] = []
        reject_document("non-object path multipliers", mutated, "multipliers must be an object")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["multipliers"] = {"missing": 2}
        reject_document("unknown path multiplier", mutated, "not path members missing")
        for name, value in (("boolean", True), ("string", "2"), ("one", 1), ("zero", 0)):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["multipliers"] = {
                "status_serializer": value
            }
            reject_document(
                f"a {name} path multiplier", mutated, "JSON integer greater than 1"
            )
        for name, value in (
            ("empty", []),
            ("non-list", "status_serializer"),
            ("empty-name", [""]),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["symbols"] = value
            reject_document(
                f"a {name} path member list", mutated, "non-empty rule-name list"
            )
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["symbols"] = [
            "status_serializer",
            "status_serializer",
        ]
        reject_document("duplicate path members", mutated, "must not contain duplicates")
        mutated = clone()
        mutated["paths"]["httpd_direct_status"]["symbols"] = ["missing"]
        reject_document("an unknown path member", mutated, "unknown symbols missing")
        for name, value in (
            ("boolean", True),
            ("string", "1536"),
            ("float", 1536.0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["base_bytes"] = value
            reject_document(
                f"a {name} path base", mutated, "non-negative JSON integer"
            )
        for name, value in (
            ("boolean", True),
            ("string", "8192"),
            ("float", 8192.0),
            ("zero", 0),
            ("negative", -1),
        ):
            mutated = clone()
            mutated["paths"]["httpd_direct_status"]["max_bytes"] = value
            reject_document(
                f"a {name} path maximum", mutated, "positive JSON integer"
            )
        reject_payload(
            "a duplicate JSON key",
            '{"version":1,"version":1,"symbols":{},"paths":{}}',
            "duplicate JSON key 'version'",
        )
    print(f"stack budget self-test: PASS ({negative_checks} malformed schemas rejected)")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--elf", type=Path)
    source.add_argument("--disassembly", type=Path)
    parser.add_argument("--objdump", default="xtensa-esp32s3-elf-objdump")
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGETS)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if args.elf is None and args.disassembly is None:
        parser.error("one of --elf or --disassembly is required")
    budgets = load_budgets(args.budgets)
    validate_source_contract(budgets)
    if args.elf is not None:
        text = disassemble(args.elf, args.objdump)
    else:
        try:
            text = args.disassembly.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise BudgetError(f"cannot read {args.disassembly}: {exc}") from exc
    result = evaluate(parse_frames(text), budgets)
    rendered = ", ".join(f"{name}={size} B" for name, size in sorted(result.items()))
    print(f"stack budget: OK ({rendered})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BudgetError as exc:
        raise SystemExit(f"stack budget: {exc}") from exc
