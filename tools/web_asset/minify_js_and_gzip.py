#!/usr/bin/env python3
"""Minify one classic-script locale module and write deterministic gzip."""

import argparse
import gzip
from pathlib import Path

from minify_and_gzip import minify_javascript


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-gzip-bytes", required=True, type=positive_int)
    args = parser.parse_args()

    source = args.input.read_text(encoding="utf-8")
    minified = minify_javascript(source)
    compressed = gzip.compress(minified.encode("utf-8"), compresslevel=9, mtime=0)
    if len(compressed) > args.max_gzip_bytes:
        parser.error(
            f"locale gzip is {len(compressed)} bytes; budget is {args.max_gzip_bytes} bytes"
        )
    args.output.write_bytes(compressed)
    print(
        f"{args.input.name}: {len(source.encode('utf-8'))} source bytes -> "
        f"{len(compressed)} gzip bytes (budget {args.max_gzip_bytes})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
