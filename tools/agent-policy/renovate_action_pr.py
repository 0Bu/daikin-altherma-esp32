#!/usr/bin/env python3
"""Recognize the one Renovate PR class that may use review-record-free automerge.

The exception requires the current same-repository Renovate branch and commit identity, Renovate's
generated body, one commit, and one complete patch from the immutable head-commit API that changes
only the fully pinned Renovate runner line in its workflow. Anything else is ordinary review work.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any


SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
WORKFLOW_FILES = {
    ".github/workflows/renovate.yaml",
}
RENOVATE_BRANCH_RE = re.compile(r"^renovate/[A-Za-z0-9][A-Za-z0-9._/-]*$")
ACTION_PIN_RE = re.compile(
    r"^(?P<prefix>[ \t]*(?:-[ \t]+)?uses:[ \t]+)"
    r"(?P<action>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)@"
    r"(?P<digest>[0-9a-f]{40})"
    r"(?P<comment>[ \t]+#[ \t]+v[0-9]+(?:\.[0-9]+){0,3}"
    r"(?:[-+][0-9A-Za-z.-]+)?)"
    r"[ \t]*$"
)


def _plain_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _load(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _repo_name(value: Any) -> str:
    return value.get("full_name", "") if isinstance(value, dict) else ""


def _patch_replacements(patch: str) -> tuple[list[tuple[str, str]], str | None]:
    replacements: list[tuple[str, str]] = []
    removed: list[str] = []
    added: list[str] = []
    in_hunk = False

    def finish_hunk() -> str | None:
        if len(removed) != len(added) or not removed:
            return "each patch hunk must replace the same non-zero number of lines"
        replacements.extend(zip(removed, added, strict=True))
        removed.clear()
        added.clear()
        return None

    for line in patch.splitlines():
        if line.startswith("@@"):
            if in_hunk:
                error = finish_hunk()
                if error:
                    return [], error
            in_hunk = True
            continue
        if not in_hunk:
            return [], "patch content appeared before its first hunk"
        if line.startswith("-"):
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append(line[1:])
        elif line.startswith(" "):
            continue
        else:
            return [], "patch contains a non-context line that is not an addition or deletion"

    if not in_hunk:
        return [], "patch has no hunks"
    error = finish_hunk()
    if error:
        return [], error
    return replacements, None


def classify(
    pr: Any,
    commit: Any,
    pages: Any,
    expected_repository: str,
    expected_head: str,
) -> tuple[bool, str]:
    """Return whether authenticated GitHub records prove the narrow exception."""

    expected_head = expected_head.lower()
    if not REPOSITORY_RE.fullmatch(expected_repository):
        return False, "expected repository is malformed"
    if not SHA_RE.fullmatch(expected_head):
        return False, "expected head SHA is malformed"
    if not isinstance(pr, dict) or not isinstance(commit, dict):
        return False, "PR or commit metadata is not an object"
    if pr.get("state") != "open" or pr.get("draft") is not False:
        return False, "PR is not open and ready"
    head = pr.get("head")
    base = pr.get("base")
    if not isinstance(head, dict) or not isinstance(base, dict):
        return False, "PR head or base metadata is missing"
    if base.get("ref") != "main":
        return False, "PR does not target main"
    if str(head.get("sha", "")).lower() != expected_head:
        return False, "PR metadata does not match the checked head"
    branch = head.get("ref")
    if not isinstance(branch, str) or not RENOVATE_BRANCH_RE.fullmatch(branch):
        return False, "PR head is not a Renovate branch"
    if any(part in {"", ".", ".."} for part in branch.split("/")):
        return False, "PR head contains an unsafe branch component"
    if _repo_name(head.get("repo")).lower() != expected_repository.lower():
        return False, "PR head is not in the protected repository"
    if _repo_name(base.get("repo")).lower() != expected_repository.lower():
        return False, "PR base is not the protected repository"
    owner = expected_repository.split("/", 1)[0]
    user = pr.get("user")
    if not isinstance(user, dict) or str(user.get("login", "")).lower() != owner.lower():
        return False, "PR creator is not the configured Renovate PAT owner"
    commits = pr.get("commits")
    if not _plain_int(commits) or commits != 1:
        return False, "Renovate exception requires exactly one commit"
    changed_files = pr.get("changed_files")
    if not _plain_int(changed_files) or not 1 <= changed_files <= 50:
        return False, "changed-file count is outside the bounded exception"
    body = pr.get("body")
    if not isinstance(body, str) or (
        "This PR has been generated by [Mend Renovate CLI]" not in body
        or "<!--renovate-debug:" not in body
    ):
        return False, "PR body is not Renovate-generated"

    if str(commit.get("sha", "")).lower() != expected_head:
        return False, "commit metadata does not match the checked head"
    git_commit = commit.get("commit")
    if not isinstance(git_commit, dict):
        return False, "commit signature metadata is missing"
    for role in ("author", "committer"):
        actor = commit.get(role)
        if not isinstance(actor, dict) or actor.get("login") != "renovate-bot":
            return False, f"commit {role} is not the configured Renovate identity"
        signature = git_commit.get(role)
        if not isinstance(signature, dict) or (
            signature.get("name") != "Renovate Bot"
            or signature.get("email") != "renovate@whitesourcesoftware.com"
        ):
            return False, f"commit {role} signature metadata is not Renovate's"
    parents = commit.get("parents")
    if not isinstance(parents, list) or len(parents) != 1:
        return False, "Renovate exception requires a single-parent commit"
    parent_sha = parents[0].get("sha") if isinstance(parents[0], dict) else None
    if not isinstance(parent_sha, str) or not SHA_RE.fullmatch(parent_sha.lower()):
        return False, "commit parent metadata is malformed"

    if not isinstance(pages, list) or not pages:
        return False, "head-commit file response is not the expected paginated array"
    records: list[Any] = []
    for page in pages:
        if not isinstance(page, dict):
            return False, "head-commit file response contains a non-object page"
        if str(page.get("sha", "")).lower() != expected_head:
            return False, "head-commit patch page is not bound to the checked head"
        page_files = page.get("files")
        if not isinstance(page_files, list):
            return False, "head-commit patch page has no complete file array"
        records.extend(page_files)
    if len(records) != changed_files:
        return False, "head-commit file response does not match changed_files metadata"

    replacement_count = 0
    for record in records:
        if not isinstance(record, dict):
            return False, "head-commit file response contains a non-object record"
        filename = record.get("filename")
        if not isinstance(filename, str) or filename not in WORKFLOW_FILES:
            return False, "change is outside the reviewed GitHub Actions workflow allowlist"
        if record.get("status") != "modified" or record.get("previous_filename") is not None:
            return False, "workflow was added, deleted, or renamed"
        additions = record.get("additions")
        deletions = record.get("deletions")
        changes = record.get("changes")
        if not all(_plain_int(value) for value in (additions, deletions, changes)):
            return False, "workflow change counts are malformed"
        if additions < 1 or additions != deletions or changes != additions + deletions:
            return False, "workflow change is not a like-for-like line replacement"
        patch = record.get("patch")
        if not isinstance(patch, str) or not patch:
            return False, "workflow patch is missing or truncated"
        replacements, error = _patch_replacements(patch)
        if error:
            return False, error
        if len(replacements) != additions:
            return False, "patch line count does not match GitHub metadata"
        for old_line, new_line in replacements:
            old_match = ACTION_PIN_RE.fullmatch(old_line)
            new_match = ACTION_PIN_RE.fullmatch(new_line)
            if not old_match or not new_match:
                return False, "patch changes something other than a fully pinned action line"
            if old_match.group("prefix") != new_match.group("prefix"):
                return False, "action line structure changed"
            if old_match.group("action") != new_match.group("action"):
                return False, "action identity changed"
            if old_match.group("action") != "renovatebot/github-action":
                return False, "changed action is not the Renovate runner"
            if old_match.group("digest") == new_match.group("digest"):
                return False, "action digest did not change"
        replacement_count += len(replacements)

    if replacement_count != 1:
        return False, "Renovate runner exception requires exactly one pin-line replacement"
    return True, f"verified {replacement_count} GitHub Action digest replacement(s)"


def main() -> int:
    if len(sys.argv) != 6:
        print(
            "usage: renovate_action_pr.py <pr.json> <commit.json> <head-commit-pages.json> "
            "<owner/repo> <head-sha>",
            file=sys.stderr,
        )
        return 1
    try:
        pr = _load(sys.argv[1])
        commit = _load(sys.argv[2])
        pages = _load(sys.argv[3])
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"not eligible: authenticated metadata is unreadable or invalid: {exc}")
        return 1
    eligible, reason = classify(pr, commit, pages, sys.argv[4], sys.argv[5])
    print(("eligible: " if eligible else "not eligible: ") + reason)
    return 0 if eligible else 1


if __name__ == "__main__":
    raise SystemExit(main())
