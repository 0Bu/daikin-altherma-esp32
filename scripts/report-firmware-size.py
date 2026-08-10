#!/usr/bin/env python3
"""Render ESP-IDF json2 size output and the staged app budget as Markdown."""

from __future__ import annotations

import argparse
import json
import pathlib
import tempfile
from typing import Any


def kib(value: int) -> str:
    return f"{value / 1024:.1f} KiB"


def integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    return value


def render_report(size_data: dict[str, Any], app_size: int, policy_limit: int, target: str) -> str:
    if policy_limit <= 0:
        raise ValueError("policy limit must be positive")
    total_size = integer(size_data.get("total_size"), "total_size")
    layout = size_data.get("layout")
    if not isinstance(layout, list) or not layout:
        raise ValueError("layout must be a non-empty list")

    margin = policy_limit - app_size
    state = "PASS" if margin >= 0 else "FAIL"
    lines = [
        f"## Firmware size — {target}",
        "",
        "| Metric | Used | Capacity / policy | Free |",
        "|---|---:|---:|---:|",
        f"| Staged app binary ({state}) | {kib(app_size)} | {kib(policy_limit)} | {kib(margin)} |",
        f"| ELF image footprint | {kib(total_size)} | — | — |",
    ]
    for index, region in enumerate(layout):
        if not isinstance(region, dict):
            raise ValueError(f"layout[{index}] must be an object")
        name = region.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"layout[{index}].name must be a non-empty string")
        total = integer(region.get("total"), f"layout[{index}].total")
        used = integer(region.get("used"), f"layout[{index}].used")
        free = integer(region.get("free"), f"layout[{index}].free")
        if total > 0:
            lines.append(f"| {name} | {kib(used)} | {kib(total)} | {kib(free)} |")
        else:
            # Flash regions have no independent linker capacity in json2; presenting zero as the
            # capacity would imply an overflow. The staged app row above is their real budget.
            lines.append(f"| {name} | {kib(used)} | — | — |")
        parts = region.get("parts")
        if not isinstance(parts, dict):
            raise ValueError(f"layout[{index}].parts must be an object")
        bss = parts.get(".bss")
        if bss is not None:
            if not isinstance(bss, dict):
                raise ValueError(f"layout[{index}].parts[.bss] must be an object")
            bss_size = integer(bss.get("size"), f"layout[{index}].parts[.bss].size")
            lines.append(f"| {name} `.bss` | {kib(bss_size)} | — | — |")

    lines.extend(
        [
            "",
            "The app policy includes the staged image as shipped; a Secure Boot v2 signature sector is",
            "therefore counted when signing is available. The JSON artifact retains ESP-IDF's section detail.",
            "",
        ]
    )
    return "\n".join(lines)


def self_test() -> None:
    fixture = {
        "version": "1.0",
        "total_size": 123456,
        "layout": [
            {"name": "Flash Code", "total": 0, "used": 120000, "free": 0, "parts": {}},
            {
                "name": "DIRAM",
                "total": 100000,
                "used": 30000,
                "free": 70000,
                "parts": {".bss": {"size": 12000}},
            },
        ],
    }
    report = render_report(fixture, app_size=150000, policy_limit=160000, target="esp32s3")
    assert "Staged app binary (PASS)" in report
    assert "146.5 KiB" in report
    assert "9.8 KiB" in report
    assert "| Flash Code | 117.2 KiB | — | — |" in report
    assert "| DIRAM `.bss` | 11.7 KiB | — | — |" in report

    failed = render_report(fixture, app_size=160001, policy_limit=160000, target="esp32s3")
    assert "Staged app binary (FAIL)" in failed
    assert "-0.0 KiB" in failed

    with tempfile.TemporaryDirectory() as temp_dir:
        path = pathlib.Path(temp_dir) / "size.json"
        path.write_text(json.dumps(fixture), encoding="utf-8")
        assert json.loads(path.read_text(encoding="utf-8"))["total_size"] == 123456

    print("firmware-size report self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--idf-size", type=pathlib.Path)
    parser.add_argument("--app", type=pathlib.Path)
    parser.add_argument("--policy-limit", type=int)
    parser.add_argument("--target", default="esp32s3")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if args.idf_size is None or args.app is None or args.policy_limit is None:
        parser.error("--idf-size, --app and --policy-limit are required unless --self-test is used")

    size_data = json.loads(args.idf_size.read_text(encoding="utf-8"))
    if not isinstance(size_data, dict):
        raise ValueError("ESP-IDF size report root must be an object")
    print(render_report(size_data, args.app.stat().st_size, args.policy_limit, args.target), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
