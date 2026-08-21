#!/usr/bin/env python3
"""Generate the public, version-bound changelog.json beside one OTA feed.

Only explicitly classified commit subjects are published.  This matters even for a private
repository: GitHub Pages and therefore changelog.json are public by project policy. Commit bodies,
authors and repository metadata never enter this document; the selected normalized subjects are
themselves public text and are screened for obvious Git/issue references.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


MAX_CHANGELOG_BYTES = 960
MAX_DOCUMENT_BYTES = 1025
MAX_ITEM_CHARS = 180
MAX_ITEMS = 12
PUBLIC_TYPES = {"feat", "fix", "perf", "refactor", "revert"}
CONVENTIONAL = re.compile(r"^([a-z]+)(?:\([^)]*\))?(!)?:\s*(.+)$", re.IGNORECASE)
PR_SUFFIX = re.compile(r"\s+\(#\d+\)$")
PRIVATE_REFERENCE = re.compile(
    r"(?:\brefs/(?:heads|tags)/\S+|\borigin/\S+|(?<![\w])#\d+\b|\b[0-9a-f]{7,40}\b)",
    re.IGNORECASE,
)
STRICT_VERSION = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+-]{0,30}$")
STRICT_SHA = re.compile(r"^[0-9a-f]{40}$")


class ChangelogError(RuntimeError):
    pass


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace",
    )
    if check and result.returncode != 0:
        raise ChangelogError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip() if result.returncode == 0 else ""


def read_json_at(ref: str, path: str) -> dict[str, Any] | None:
    raw = git("show", f"{ref}:{path}", check=False)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def normalize_subject(subject: str) -> str | None:
    subject = " ".join(subject.strip().split())
    if not subject or subject.startswith("Merge "):
        return None
    match = CONVENTIONAL.match(subject)
    if not match or match.group(1).lower() not in PUBLIC_TYPES:
        return None
    subject = match.group(3)
    subject = PR_SUFFIX.sub("", subject).strip()
    if not subject or PRIVATE_REFERENCE.search(subject):
        return None
    if len(subject) > MAX_ITEM_CHARS:
        subject = subject[: MAX_ITEM_CHARS - 1].rstrip() + "…"
    return subject[0].upper() + subject[1:]


def encoded_document_size(version: str, changelog: str) -> int:
    payload = json.dumps(
        {"version": version, "changelog": changelog},
        ensure_ascii=False, separators=(",", ":"),
    ) + "\n"
    return len(payload.encode("utf-8"))


def notes_fit(version: str, text: str) -> bool:
    return (bool(text) and len(text.encode("utf-8")) <= MAX_CHANGELOG_BYTES and
            encoded_document_size(version, text) <= MAX_DOCUMENT_BYTES)


def fit_notes(subjects: list[str], version: str) -> str:
    notes: list[str] = []
    omitted = max(0, len(subjects) - MAX_ITEMS)
    for subject in subjects[:MAX_ITEMS]:
        candidate = "\n".join([*notes, subject])
        if notes_fit(version, candidate):
            notes.append(subject)
        else:
            omitted += 1

    if not notes:
        notes = ["Maintenance and reliability improvements."]
    if omitted:
        tail = f"And {omitted} more user-facing change{'s' if omitted != 1 else ''}."
        while notes and not notes_fit(version, "\n".join([*notes, tail])):
            notes.pop()
            omitted += 1
            tail = f"And {omitted} more user-facing changes."
        notes.append(tail)
    text = "\n".join(notes)
    if not notes_fit(version, text):
        raise ChangelogError("generated changelog exceeds the firmware text/document budget")
    return text


def previous_source(channel: str, source_sha: str, published_ref: str) -> str | None:
    manifest_path = "dev/manifest.json" if channel == "dev" else "manifest.json"
    manifest = read_json_at(published_ref, manifest_path)
    provenance = manifest.get("provenance") if manifest else None
    prior = provenance.get("source_sha") if isinstance(provenance, dict) else None
    if isinstance(prior, str) and STRICT_SHA.fullmatch(prior):
        return prior

    # First publication of a feed: use the last release tag before this source when possible.  With
    # no tag, one parent keeps the first document useful without pretending to reconstruct history
    # the checkout does not contain.
    parent = git("rev-parse", f"{source_sha}^", check=False)
    if not parent:
        return None
    tag = git("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", parent, check=False)
    return git("rev-parse", f"{tag}^{{commit}}") if tag else parent


def build(channel: str, version: str, source_sha: str, published_ref: str) -> dict[str, str]:
    resolved = git("rev-parse", f"{source_sha}^{{commit}}")
    if resolved != source_sha:
        raise ChangelogError(f"source SHA resolves to {resolved}, expected {source_sha}")

    prior = previous_source(channel, source_sha, published_ref)
    changelog_path = "dev/changelog.json" if channel == "dev" else "changelog.json"
    if prior == source_sha:
        existing = read_json_at(published_ref, changelog_path)
        if existing and existing.get("version") == version and isinstance(existing.get("changelog"), str):
            text = existing["changelog"]
            if notes_fit(version, text):
                return {"version": version, "changelog": text}
        raise ChangelogError("same-source release resume has no reusable matching changelog")

    if prior:
        # merge-base --is-ancestor is silent on both success and failure, so the exit status is the
        # answer. Divergent feed history fails closed instead of silently publishing unrelated notes.
        ancestry = subprocess.run(["git", "merge-base", "--is-ancestor", prior, source_sha], check=False)
        if ancestry.returncode != 0:
            raise ChangelogError(f"published source {prior} is not an ancestor of {source_sha}")
        raw_subjects = git("log", "--first-parent", "--format=%s", f"{prior}..{source_sha}").splitlines()
    else:
        raw_subjects = [git("show", "-s", "--format=%s", source_sha)]
    subjects = [note for raw in raw_subjects if (note := normalize_subject(raw))]
    return {"version": version, "changelog": fit_notes(subjects, version)}


def self_test() -> None:
    assert normalize_subject("feat(ui): add OTA notes (#12)") == "Add OTA notes"
    assert normalize_subject("fix!: prevent reboot loop") == "Prevent reboot loop"
    assert normalize_subject("chore(repo): shuffle files") is None
    assert normalize_subject("Add an unclassified internal change") is None
    assert normalize_subject("Merge branch 'main'") is None
    assert normalize_subject("fix: retain issue #441 details") is None
    assert normalize_subject("fix: pin deadbeef while testing") is None
    assert normalize_subject("fix: read refs/heads/private") is None
    assert fit_notes([], "1.2.3") == "Maintenance and reliability improvements."
    crowded = fit_notes(["Ä" * MAX_ITEM_CHARS] * 20, "1.2.3-dev.4")
    assert len(crowded.encode("utf-8")) <= MAX_CHANGELOG_BYTES
    assert encoded_document_size("1.2.3-dev.4", crowded) <= MAX_DOCUMENT_BYTES
    assert "more user-facing changes" in crowded
    encoded = json.dumps({"version": "1.2.3-dev.4", "changelog": "Quote \" and ä\nNext"},
                         ensure_ascii=False, separators=(",", ":"))
    assert "\\u" not in encoded and "\\n" in encoded and "ä" in encoded
    print("OTA changelog generator: normalization, public-field and byte-budget checks passed")


def validate_document(path: Path, version: str) -> None:
    raw = path.read_bytes()
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise ChangelogError("document exceeds firmware fetch budget")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ChangelogError(f"document is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict) or value.get("version") != version:
        raise ChangelogError("document version does not match the built firmware")
    text = value.get("changelog")
    if not isinstance(text, str) or not text or len(text.encode("utf-8")) > MAX_CHANGELOG_BYTES:
        raise ChangelogError("document has no bounded changelog string")
    if any(ord(char) < 0x20 and char not in "\n\t" for char in text):
        raise ChangelogError("changelog contains unsupported control characters")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=("release", "dev"))
    parser.add_argument("--version")
    parser.add_argument("--source-sha")
    parser.add_argument("--published-ref", default="FETCH_HEAD")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.validate:
        if not args.version or not STRICT_VERSION.fullmatch(args.version):
            parser.error("--validate requires a compact --version")
        try:
            validate_document(args.validate, args.version)
        except (ChangelogError, OSError) as exc:
            print(f"generate-ota-changelog: {exc}", file=sys.stderr)
            return 1
        print(f"validated OTA changelog for {args.version}: {args.validate}")
        return 0
    if not all((args.channel, args.version, args.source_sha, args.output)):
        parser.error("--channel, --version, --source-sha and --output are required")
    if not STRICT_VERSION.fullmatch(args.version):
        parser.error("--version must be a compact firmware version")
    if not STRICT_SHA.fullmatch(args.source_sha):
        parser.error("--source-sha must be a lowercase 40-character Git SHA")
    try:
        document = build(args.channel, args.version, args.source_sha, args.published_ref)
    except ChangelogError as exc:
        print(f"generate-ota-changelog: {exc}", file=sys.stderr)
        return 1
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
    if len(payload.encode("utf-8")) > MAX_DOCUMENT_BYTES:
        print("generate-ota-changelog: document exceeds firmware fetch budget", file=sys.stderr)
        return 1
    args.output.write_text(payload, encoding="utf-8")
    print(f"generated {args.channel} changelog for {args.version}: "
          f"{len(document['changelog'].splitlines())} item(s), {len(payload.encode('utf-8'))} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
