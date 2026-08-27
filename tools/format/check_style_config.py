#!/usr/bin/env python3
"""Fail closed when the repository clang-format authority changes unnoticed."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


# This binds the exact reviewed repository style file. An intentional style change must update this
# digest in the same review, which makes a formatter-disabling change visible even when no C/C++
# line changed and the changed-line formatter would otherwise have zero inputs.
EXPECTED_SHA256 = "ff0b8319cd16b413dfaa388b822b471ae2de5dd3656ed8816a5bbe5fe634dcab"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()

    try:
        payload = args.config.read_bytes()
    except OSError as exc:
        print(f"format style contract: cannot read {args.config}: {exc}")
        return 2

    observed = hashlib.sha256(payload).hexdigest()
    if observed != EXPECTED_SHA256:
        print(
            "format style contract: .clang-format differs from the reviewed configuration "
            f"(expected {EXPECTED_SHA256}, got {observed})"
        )
        print(
            "format style contract: review the complete style change and update "
            "EXPECTED_SHA256 only in that same change"
        )
        return 1

    print(f"format style contract: reviewed .clang-format {observed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
