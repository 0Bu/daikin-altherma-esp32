#!/usr/bin/env python3
"""Validate a maintainer's local check result without executing any PR source."""

from datetime import datetime, timezone
import json
from pathlib import Path
from functools import partial
import re
import subprocess
import sys
import time


REPO = "0Bu/daikin-altherma-esp32"
MAINTAINER_ID = 4757856
PREFIX = "daikin-local-release-checks "
MAX_AGE = 86400
COMMENTS_PER_PAGE = 10
VERIFY_TIMEOUT_S = 90
SHA = re.compile(r"[0-9a-f]{40}")


class ProofError(ValueError):
    pass


def api(path, *, local=False, deadline=None):
    if local:
        client = str(Path(__file__).resolve().parents[2] / "scripts/gh-with-git-credentials.sh")
    else:
        client = "gh"
    timeout = min(20, deadline - time.monotonic()) if deadline is not None else 20
    if timeout <= 0:
        raise ProofError("GitHub evidence lookup exceeded its deadline")
    result = subprocess.run([client, "api", "--hostname", "github.com", "--method", "GET",
                             f"repos/{REPO}/{path}"],
                            capture_output=True, check=True, timeout=timeout)
    if len(result.stdout) > 4 * 1024 * 1024:
        raise ProofError("GitHub metadata exceeds the verification limit")
    return json.loads(result.stdout)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def unique_items(items):
    obj = dict(items)
    if len(obj) != len(items):
        raise ProofError("duplicate proof fields")
    return obj


def require_receipt(number, head, tree, base, *, boundary, query=api):
    # Limit each response and stop as soon as a matching receipt is found.
    since = datetime.fromtimestamp(boundary - MAX_AGE, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    page_number = 1
    while True:
        comments = query(f"issues/{number}/comments?since={since}&per_page={COMMENTS_PER_PAGE}&page={page_number}")
        if not isinstance(comments, list) or len(comments) > COMMENTS_PER_PAGE:
            raise ProofError("invalid GitHub issue comment page")
        for item in comments:
            body = item.get("body") or ""
            if (item.get("user", {}).get("id") != MAINTAINER_ID or item.get("performed_via_github_app")
                    or not body.startswith(PREFIX) or len(body) > 1024):
                continue
            try:
                created = timestamp(item["created_at"])
                updated = timestamp(item["updated_at"])
                receipt = json.loads(body[len(PREFIX):], object_pairs_hook=unique_items)
            except (ValueError, KeyError, AttributeError, TypeError):
                continue
            if not boundary - MAX_AGE <= created == updated <= boundary:
                continue
            if (not isinstance(receipt, dict) or type(receipt.get("schema")) is not int
                    or receipt["schema"] != 1 or receipt.get("repo") != REPO
                    or (receipt.get("head"), receipt.get("tree"), receipt.get("base")) != (head, tree, base)):
                continue
            if type(receipt.get("finished_at")) is not int or not boundary - MAX_AGE <= receipt["finished_at"] <= created:
                continue
            return receipt
        if len(comments) < COMMENTS_PER_PAGE:
            raise ProofError("missing exact local check receipt from the maintainer")
        page_number += 1


def commit(path, query):
    sha = query(path)["object"]["sha"]
    if not SHA.fullmatch(sha):
        raise ProofError("invalid GitHub ref object")
    return sha


def verify_pr(number, head, query=api):
    pr = query(f"pulls/{number}")
    if (not pr.get("state") == "open" or pr["base"]["ref"] != "main"
            or pr["base"]["repo"]["full_name"] != REPO or pr["head"]["sha"] != head):
        raise ProofError("PR does not match the current open head")
    # For a mergeable open PR, GitHub returns the test merge commit in the PR response.
    tested = pr.get("merge_commit_sha")
    if pr.get("mergeable") is not True or not isinstance(tested, str) or not SHA.fullmatch(tested):
        raise ProofError("GitHub has no mergeable test commit for this PR")
    base = commit("git/ref/heads/main", query)
    detail = query(f"git/commits/{tested}")
    if [row["sha"] for row in detail["parents"]] != [base, head] or detail["sha"] != tested:
        raise ProofError("PR merge tree is stale")
    tree = detail["tree"]["sha"]
    if not SHA.fullmatch(tree):
        raise ProofError("invalid PR tree")
    return require_receipt(number, head, tree, base, boundary=datetime.now().timestamp(), query=query)


def landed_pull(target, query):
    prs = query(f"commits/{target}/pulls?per_page=100")
    matches = [pr for pr in prs if pr.get("merge_commit_sha") == target and pr.get("merged_at")
               and pr["base"]["ref"] == "main" and pr["base"]["repo"]["full_name"] == REPO]
    if len(matches) != 1:
        raise ProofError("published commit does not have one matching merged PR")
    return matches[0]


def pin_only_replacement(pr, target, query):
    head = pr["head"]
    if not (head.get("ref", "").startswith("renovate/")
            and (head.get("repo") or {}).get("full_name") == REPO):
        return False
    details = query(f"pulls/{pr['number']}")
    if (details.get("merge_commit_sha") != target or details["head"]["sha"] != head["sha"]
            or details.get("commits") != 1 or details.get("changed_files") != 1):
        return False
    policy_dir = Path(__file__).resolve().parents[1] / "agent-policy"
    sys.path.insert(0, str(policy_dir))
    from renovate_action_pr import _patch_replacements, classify

    original = query(f"commits/{head['sha']}")
    if not classify({**details, "state": "open"}, original, [original], REPO, head["sha"])[0]:
        return False
    actual = query(f"commits/{target}")
    # Match the landed patch to the attested change, ignoring per-commit links.
    files = actual.get("files")
    if actual.get("sha") != target or not isinstance(files, list) or len(files) != 1:
        return False
    landed_file = files[0]
    attested = original["files"][0]
    fields = ("filename", "status", "previous_filename", "additions", "deletions", "changes")
    if (not all(landed_file.get(field) == attested.get(field) for field in fields)
            or not isinstance(landed_file.get("patch"), str)):
        return False
    replacements, error = _patch_replacements(landed_file["patch"])
    return error is None and replacements == _patch_replacements(attested["patch"])[0]


def verify_landed(target, query=api):
    pr = landed_pull(target, query)
    landed = query(f"git/commits/{target}")
    parents = [row["sha"] for row in landed["parents"]]
    if landed["sha"] != target or len(parents) != 1:
        raise ProofError("published commit is not a single squash merge")
    tree = landed["tree"]["sha"]
    head = pr["head"]["sha"]
    if not all(SHA.fullmatch(value) for value in (tree, parents[0], head)):
        raise ProofError("invalid landed Git identity")
    if pin_only_replacement(pr, target, query):
        # The independently attested runner update changes only its own workflow.
        # Reuse the preceding firmware evidence, with every intervening pin re-attested.
        return verify_landed(parents[0], query)
    return require_receipt(pr["number"], head, tree, parents[0],
                           boundary=timestamp(pr["merged_at"]), query=query)


def main():
    deadline = time.monotonic() + VERIFY_TIMEOUT_S
    if (len(sys.argv) == 4 and sys.argv[1] in {"pr", "local-pr"}
            and sys.argv[2].isdigit() and SHA.fullmatch(sys.argv[3])):
        verify_pr(int(sys.argv[2]), sys.argv[3], query=partial(api, local=sys.argv[1] == "local-pr",
                                                             deadline=deadline))
    elif len(sys.argv) == 3 and sys.argv[1] == "landed" and SHA.fullmatch(sys.argv[2]):
        verify_landed(sys.argv[2], query=partial(api, deadline=deadline))
    else:
        raise ProofError("invalid receipt verification arguments")
    print("Local release proof verified.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        reason = str(error) if isinstance(error, ProofError) else type(error).__name__
        sys.exit(f"Local release proof rejected: {reason}")
