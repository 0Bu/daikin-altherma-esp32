#!/usr/bin/env python3
"""Fail when an sdkconfig.defaults assignment did not land in generated sdkconfig."""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
import tempfile


ASSIGNMENT = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=(.*)$")
NOT_SET = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")


class ConfigError(ValueError):
    pass


def parse_config(path: pathlib.Path, *, defaults: bool) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or (line.startswith("#") and not NOT_SET.fullmatch(line)):
            continue
        match = ASSIGNMENT.fullmatch(line)
        if match:
            key, value = match.groups()
        else:
            match = NOT_SET.fullmatch(line)
            if match and not defaults:
                key, value = match.group(1), "n"
            elif line.startswith("CONFIG_"):
                raise ConfigError(f"{path}:{line_no}: malformed CONFIG assignment: {line}")
            else:
                continue
        if key in values:
            raise ConfigError(f"{path}:{line_no}: duplicate assignment for {key}")
        values[key] = value
    return values


def check(defaults_path: pathlib.Path, generated_path: pathlib.Path) -> list[str]:
    defaults = parse_config(defaults_path, defaults=True)
    generated = parse_config(generated_path, defaults=False)
    errors: list[str] = []
    for key, expected in defaults.items():
        actual = generated.get(key)
        if actual is None:
            errors.append(f"{key}: missing from generated sdkconfig (default was {expected})")
        elif actual != expected:
            errors.append(f"{key}: generated {actual}, expected {expected}")
    return errors


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = pathlib.Path(temp_dir)
        defaults = root / "sdkconfig.defaults"
        generated = root / "sdkconfig"

        defaults.write_text('CONFIG_TARGET="esp32s3"\nCONFIG_FEATURE=y\nCONFIG_OFF=n\n', encoding="utf-8")
        generated.write_text(
            'CONFIG_TARGET="esp32s3"\nCONFIG_FEATURE=y\n# CONFIG_OFF is not set\n',
            encoding="utf-8",
        )
        assert check(defaults, generated) == []

        generated.write_text('CONFIG_TARGET="esp32s3"\nCONFIG_FEATURE=n\n', encoding="utf-8")
        errors = check(defaults, generated)
        assert any("CONFIG_FEATURE: generated n, expected y" in error for error in errors)
        assert any("CONFIG_OFF: missing" in error for error in errors)

        defaults.write_text("CONFIG_DUP=y\nCONFIG_DUP=n\n", encoding="utf-8")
        try:
            check(defaults, generated)
        except ConfigError as error:
            assert "duplicate assignment for CONFIG_DUP" in str(error)
        else:
            raise AssertionError("duplicate defaults assignment was accepted")

        defaults.write_text("CONFIG_BROKEN y\n", encoding="utf-8")
        try:
            check(defaults, generated)
        except ConfigError as error:
            assert "malformed CONFIG assignment" in str(error)
        else:
            raise AssertionError("malformed defaults assignment was accepted")

    print("sdkconfig-defaults checker self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("defaults", nargs="?", type=pathlib.Path)
    parser.add_argument("generated", nargs="?", type=pathlib.Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if args.defaults is None or args.generated is None:
        parser.error("defaults and generated paths are required unless --self-test is used")

    try:
        errors = check(args.defaults, args.generated)
    except (ConfigError, OSError) as error:
        print(error, file=sys.stderr)
        return 2
    if errors:
        print(f"sdkconfig defaults drift: {len(errors)} assignment(s) did not land:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    count = len(parse_config(args.defaults, defaults=True))
    print(f"sdkconfig defaults: PASS ({count} assignments match generated sdkconfig)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
