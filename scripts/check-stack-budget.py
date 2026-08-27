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
FUNCTION_RE = re.compile(r"^\s*[0-9a-fA-F]+\s+<(.+)>:\s*$")
ENTRY_RE = re.compile(r"\bentry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)\b")
RULE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class BudgetError(ValueError):
    """Disassembly or budget data cannot establish the required stack bound."""


def parse_frames(disassembly: str) -> dict[str, int]:
    frames: dict[str, int] = {}
    current: str | None = None
    for line in disassembly.splitlines():
        header = FUNCTION_RE.match(line)
        if header:
            current = header.group(1)
            continue
        if current is None:
            continue
        entry = ENTRY_RE.search(line)
        if entry:
            frame = int(entry.group(1), 0)
            frames[current] = max(frame, frames.get(current, 0))
            current = None
    return frames


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
    budgets = load_budgets(DEFAULT_BUDGETS)
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
