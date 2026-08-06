#!/usr/bin/env python3
"""Minify the embedded dashboard's inline CSS/JS, then write deterministic gzip.

The editable HTML, CSS and JavaScript deliberately keep their explanatory comments.  Only the
firmware artefact is reduced.  The minifiers are vendored, syntax-preserving implementations so
the ESP-IDF build remains offline and does not acquire a Node toolchain.
"""

from __future__ import annotations

import argparse
import gzip
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))

import rcssmin  # noqa: E402  vendored beside this script
import rjsmin  # noqa: E402  vendored beside this script


_REGEX_PREFIX_WORDS = {
    "await", "case", "delete", "do", "else", "in", "instanceof", "new", "of",
    "return", "throw", "typeof", "void", "yield",
}


class TemplateProtector:
    """Hide complete template literals from rJSmin, which supports only unnested templates.

    This UI deliberately uses nested templates extensively.  Protecting the complete outer literal
    keeps both its raw text and every `${...}` expression byte-identical while rJSmin safely reduces
    the surrounding classic-script syntax.  The scanner understands strings, comments and regular
    expressions so braces/backticks inside them cannot terminate a template expression early.
    """

    def __init__(self, source: str):
        self.source = source
        self.literals: list[tuple[str, str]] = []
        self.prefix = "__DAIKIN_PROTECTED_TEMPLATE_"
        if self.prefix in source:
            raise ValueError("template-protection prefix occurs in JavaScript source")

    @staticmethod
    def _ident_start(char: str) -> bool:
        return char == "_" or char == "$" or char.isalpha()

    @classmethod
    def _ident_part(cls, char: str) -> bool:
        return cls._ident_start(char) or char.isdigit()

    def _quoted(self, pos: int, quote: str) -> int:
        pos += 1
        while pos < len(self.source):
            char = self.source[pos]
            if char == "\\":
                pos += 2
            elif char == quote:
                return pos + 1
            else:
                pos += 1
        raise ValueError(f"unterminated {quote} string while protecting templates")

    def _line_comment(self, pos: int) -> int:
        end = self.source.find("\n", pos + 2)
        return len(self.source) if end < 0 else end

    def _block_comment(self, pos: int) -> int:
        end = self.source.find("*/", pos + 2)
        if end < 0:
            raise ValueError("unterminated block comment while protecting templates")
        return end + 2

    def _regex(self, pos: int) -> int:
        pos += 1
        in_class = False
        while pos < len(self.source):
            char = self.source[pos]
            if char == "\\":
                pos += 2
                continue
            if char in "\r\n":
                raise ValueError("unterminated regular expression while protecting templates")
            if char == "[":
                in_class = True
            elif char == "]":
                in_class = False
            elif char == "/" and not in_class:
                pos += 1
                while pos < len(self.source) and self._ident_part(self.source[pos]):
                    pos += 1
                return pos
            pos += 1
        raise ValueError("unterminated regular expression while protecting templates")

    def _template(self, pos: int) -> int:
        pos += 1
        while pos < len(self.source):
            char = self.source[pos]
            if char == "\\":
                pos += 2
            elif char == "`":
                return pos + 1
            elif char == "$" and pos + 1 < len(self.source) and self.source[pos + 1] == "{":
                pos = self._expression(pos + 2)
            else:
                pos += 1
        raise ValueError("unterminated template literal")

    def _step(self, pos: int, can_start_regex: bool) -> tuple[int, bool]:
        char = self.source[pos]
        if char.isspace():
            return pos + 1, can_start_regex
        if char in "'\"":
            return self._quoted(pos, char), False
        if char == "`":
            return self._template(pos), False
        if char == "/" and pos + 1 < len(self.source):
            following = self.source[pos + 1]
            if following == "/":
                return self._line_comment(pos), can_start_regex
            if following == "*":
                return self._block_comment(pos), can_start_regex
            if can_start_regex:
                return self._regex(pos), False
            return pos + 1, True
        if self._ident_start(char):
            end = pos + 1
            while end < len(self.source) and self._ident_part(self.source[end]):
                end += 1
            return end, self.source[pos:end] in _REGEX_PREFIX_WORDS
        if char.isdigit():
            end = pos + 1
            while end < len(self.source) and (self.source[end].isalnum() or self.source[end] in "._"):
                end += 1
            return end, False
        if self.source.startswith("++", pos) or self.source.startswith("--", pos):
            return pos + 2, False
        if char in ")]":
            return pos + 1, False
        if char == ".":
            return pos + 1, False
        if char in "([{,;:=!?&|+-*%~^<>":
            return pos + 1, True
        return pos + 1, False

    def _expression(self, pos: int) -> int:
        depth = 1
        can_start_regex = True
        while pos < len(self.source):
            char = self.source[pos]
            if char == "{":
                depth += 1
                pos += 1
                can_start_regex = True
            elif char == "}":
                depth -= 1
                pos += 1
                if depth == 0:
                    return pos
                can_start_regex = False
            else:
                pos, can_start_regex = self._step(pos, can_start_regex)
        raise ValueError("unterminated ${...} template expression")

    def protect(self) -> str:
        pieces: list[str] = []
        last = 0
        pos = 0
        can_start_regex = True
        while pos < len(self.source):
            if self.source[pos] == "`":
                end = self._template(pos)
                placeholder = f"{self.prefix}{len(self.literals):06d}__"
                pieces.extend((self.source[last:pos], placeholder))
                self.literals.append((placeholder, self.source[pos:end]))
                pos = end
                last = end
                can_start_regex = False
            else:
                pos, can_start_regex = self._step(pos, can_start_regex)
        pieces.append(self.source[last:])
        return "".join(pieces)

    def restore(self, source: str) -> str:
        for placeholder, literal in self.literals:
            if source.count(placeholder) != 1:
                raise ValueError(f"minifier changed protected template placeholder {placeholder}")
            source = source.replace(placeholder, literal)
        return source


def minify_javascript(source: str) -> str:
    protector = TemplateProtector(source)
    protected = protector.protect()
    reduced = rjsmin.jsmin(protected, keep_bang_comments=True)
    return protector.restore(reduced)


def replace_exactly_one(page: str, start: str, end: str, transform, label: str) -> str:
    """Transform one inline asset and fail closed if the assembled page shape drifts."""
    if page.count(start) != 1 or page.count(end) != 1:
        raise ValueError(f"expected exactly one {label} block")
    begin = page.index(start) + len(start)
    finish = page.index(end, begin)
    return page[:begin] + transform(page[begin:finish]) + page[finish:]


def minify_page(page: str) -> str:
    page = replace_exactly_one(
        page,
        "<style>",
        "</style>",
        lambda css: rcssmin.cssmin(css, keep_bang_comments=True),
        "inline style",
    )
    return replace_exactly_one(
        page,
        "<script>",
        "</script>",
        minify_javascript,
        "inline script",
    )


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--html-output", type=Path)
    parser.add_argument("--max-gzip-bytes", required=True, type=positive_int)
    args = parser.parse_args()

    source = args.input.read_text(encoding="utf-8")
    minified = minify_page(source)
    compressed = gzip.compress(minified.encode("utf-8"), compresslevel=9, mtime=0)

    if len(compressed) > args.max_gzip_bytes:
        print(
            f"dashboard gzip is {len(compressed)} bytes; budget is {args.max_gzip_bytes} bytes",
            file=sys.stderr,
        )
        return 2

    args.output.write_bytes(compressed)
    if args.html_output:
        args.html_output.write_text(minified, encoding="utf-8")
    print(
        f"dashboard: {len(source)} source -> {len(minified)} minified -> "
        f"{len(compressed)} gzip bytes (budget {args.max_gzip_bytes})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
